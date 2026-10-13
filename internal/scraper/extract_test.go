package scraper

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func TestLegacyEntityDecoding(t *testing.T) {
	for _, tc := range []struct{ name, input, want string }{
		{"ordered named replacements", "&amp;lt; &amp;quot; &amp;apos;", "< \" '"},
		{"decimal before named replacements", "&#38;lt; &amp;#65;", "< &#65;"},
		{"decimal uses JS code unit modulo", "&#128512; &#65536;", "\uf600 \x00"},
		{"surrogate entity pair", "&#55357;&#56832;", "😀"},
		{"lone surrogate UTF8 boundary", "&#55357;", "\ufffd"},
		{"named replacements only one pass each", "&amp;amp;lt;", "&amp;lt;"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := decodeEntities(tc.input); got != tc.want {
				t.Fatalf("want %q, got %q", tc.want, got)
			}
		})
	}
	if got := decodeArticleEntities("&#65; &apos; &amp;#39; &amp;lt;"); got != "&#65; &apos; ' <" {
		t.Fatalf("article-specific decoder changed: %q", got)
	}
	got, err := extractRecipeHTML(`<script type="application/ld+json">{"@type":"Recipe","name":"Entities","recipeIngredient":["&amp;lt; salt"],"recipeInstructions":["Use &amp;lt; heat","&#55357;&#56832;"]}</script>`, "https://example.com", "url")
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]string{"Use < heat", "😀"}, got.Instructions); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff([]string{"< salt"}, got.RawIngredients); diff != "" {
		t.Fatal(diff)
	}
}

func TestLegacyImageAndNumericServingsPresence(t *testing.T) {
	for _, tc := range []struct {
		raw     string
		present bool
		value   string
	}{
		{`null`, false, ""}, {`""`, false, ""}, {`[""]`, false, ""},
		{`{"url":""}`, true, ""}, {`{"contentUrl":""}`, true, ""},
		{`{"url":"","contentUrl":"fallback"}`, true, ""}, {`"photo"`, true, "photo"},
	} {
		node, err := decodeOrderedJSON([]byte(tc.raw))
		if err != nil {
			t.Fatal(err)
		}
		got := extractImage(node)
		if (got != nil) != tc.present || (got != nil && *got != tc.value) {
			t.Fatalf("image %s = %v", tc.raw, got)
		}
	}
	for _, tc := range []struct {
		raw     string
		present bool
		value   int32
	}{
		{`0`, false, 0}, {`0.0`, false, 0}, {`-0`, false, 0}, {`0e99`, false, 0},
		{`[0]`, true, 0}, {`"0 servings"`, true, 0}, {`1e3`, true, 1000},
		{`1e-7`, true, 1}, {`0.000001`, true, 0}, {`[[4,5]]`, true, 4},
		{`[]`, false, 0}, {`{}`, false, 0}, {`1e999`, false, 0},
	} {
		node, err := decodeOrderedJSON([]byte(tc.raw))
		if err != nil {
			t.Fatal(err)
		}
		got := parseServings(node)
		if (got != nil) != tc.present || (got != nil && *got != tc.value) {
			t.Fatalf("servings %s = %v; want present=%t value=%d", tc.raw, got, tc.present, tc.value)
		}
	}
}

func TestLegacyWhitespaceAndASCIICasePatterns(t *testing.T) {
	for _, separator := range []string{"\u00a0", "\u2003", "\ufeff", "\u2028"} {
		if diff := cmp.Diff([]string{"One Pot"}, suggestTags("ONE"+separator+"POT")); diff != "" {
			t.Fatalf("separator %q: %s", separator, diff)
		}
		if !numberedLine.MatchString("1." + separator + "Cook") {
			t.Fatalf("step whitespace %q not recognized", separator)
		}
	}
	for _, title := range []string{"ſoup", "no-Kook", "one\u0085pot"} {
		if tags := suggestTags(title); len(tags) != 0 {
			t.Fatalf("non-JS fold/whitespace %q acquired %v", title, tags)
		}
	}
	if got := blockTagPattern.ReplaceAllString("<DIV>Keep CASE</DIV>", "\n"); got != "\nKeep CASE\n" {
		t.Fatalf("case-preserving replacement: %q", got)
	}
}

func TestLegacyUTF16ArticleLimits(t *testing.T) {
	if jsLength("a😀米") != 4 || jsSlice("a😀米", 1, 3) != "😀" || jsSlice("a😀米", 0, 2) != "a\ufffd" {
		t.Fatal("UTF16 length/slice mismatch")
	}
	got, err := extractRecipeHTML(`<article><h2>Ingredients</h2><p>胡椒</p><p>味噌調味</p><p>`+strings.Repeat("米", 299)+`</p><p>`+strings.Repeat("米", 300)+`</p><h2>Directions</h2><p>1. `+strings.Repeat("米", 5100)+`</p></article>`, "https://example.com", "url")
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]string{"味噌調味", strings.Repeat("米", 299)}, got.RawIngredients); diff != "" {
		t.Fatal(diff)
	}
	if len(got.Instructions) != 1 || got.Instructions[0] != strings.Repeat("米", 5000-len("Directions\n\n1. ")) || !utf8.ValidString(got.Instructions[0]) {
		t.Fatalf("UTF16 instruction cutoff: %d instructions, length %d", len(got.Instructions), len(strings.Join(got.Instructions, "")))
	}
}

func TestOrderedJSONLastDuplicateKeepsOriginalPosition(t *testing.T) {
	node, err := decodeOrderedJSON([]byte(`{"first":{"link":"https://old.example"},"second":{"link":"https://second.example"},"first":{"link":"https://new.example"},"2":{"link":"https://integer.example"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]string{"https://integer.example", "https://new.example", "https://second.example"}, collectPinLinks(node)); diff != "" {
		t.Fatal(diff)
	}
	got, err := extractRecipeHTML(`<script type="application/ld+json">{"@type":"Thing","@type":"Recipe","name":"First","name":"Last"}</script>`, "https://example.com", "url")
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Last" {
		t.Fatalf("last JSON property was not retained: %q", got.Title)
	}
}

func TestExtractJSONLDLegacyShape(t *testing.T) {
	html := `<html><head><script type="application/ld+json">not-json</script><script type="application/ld+json">{
  "@context":"https://schema.org","@graph":[{"@type":"Thing"},{"@type":["Thing","Recipe"],
  "name":"One-Pot Cake &amp; Soup","image":[{"url":"https://images.example/first"},"https://images.example/second"],
  "recipeYield":"0 servings","prepTime":"PT1H30M","cookTime":"PT0M",
  "recipeIngredient":["  Salt &amp; Pepper  ","salt &amp; pepper",7,"Crème"],
  "recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":" Mix &amp; stir "}]},"{'@type': 'HowToStep', 'text': 'Bake &quot;now&quot;.'}"]}]}
</script></head><body><article>ignored fallback</article></body></html>`
	zero := int32(0)
	ninety := int32(90)
	image := "https://images.example/first"
	want := pantry.ScrapedRecipe{
		Title: "One-Pot Cake &amp; Soup", SourceURL: "https://recipes.example/a", SourceType: "url", ImageURL: &image,
		Servings: &zero, PrepTimeMinutes: &ninety, Instructions: []string{"Mix & stir", `Bake "now".`},
		RawIngredients: []string{"Salt & Pepper", "Crème"}, SuggestedTags: []string{"One Pot", "Soup / Stew", "Baking"},
	}
	got, err := extractRecipeHTML(html, want.SourceURL, want.SourceType)
	if err != nil {
		t.Fatal(err)
	}
	// Preserve the legacy title's undecoded JSON-LD entity text and fixed tag order.
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("JSON-LD mismatch (-want +got):\n%s", diff)
	}
}

func TestJSONLDRecipePrecedenceAndPresence(t *testing.T) {
	html := `<script type="application/ld+json">[{"@type":"Recipe","name":"","recipeYield":0,"prepTime":"pt2h","recipeIngredient":[],"recipeInstructions":[]},{"@type":"Recipe","name":"second"}]</script><meta property="og:title" content="fallback">`
	got, err := extractRecipeHTML(html, "https://example.com", "url")
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "" || got.Servings != nil || got.PrepTimeMinutes != nil || len(got.RawIngredients) != 0 {
		t.Fatalf("first empty Recipe did not suppress fallback: %#v", got)
	}
}

func TestArticleAndOpenGraphFallbacks(t *testing.T) {
	padding := "This introduction exists only to exceed the selector threshold. " + string(make([]byte, 250))
	padding = replaceNUL(padding)
	html := `<html><head><meta property="og:title" content="Sheet Pan Salad &amp; More"><meta property="og:image" content="https://images.example/a"></head><body><article>` + padding + `<h2>Ingredients</h2><p>• 2 cups Rice</p><p>2 cups rice</p><p>- Salt</p><h2>Directions</h2><p>1. Mix everything well.</p><p>2) Bake it until done.</p><h2>Notes</h2><p>3. Ignore this.</p></article></body></html>`
	got, err := extractRecipeHTML(html, "https://example.com/article", "url")
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]string{"2 cups Rice", "Salt"}, got.RawIngredients); diff != "" {
		t.Fatalf("ingredients mismatch: %s", diff)
	}
	if diff := cmp.Diff([]string{"Mix everything well.", "Bake it until done."}, got.Instructions); diff != "" {
		t.Fatalf("instructions mismatch: %s", diff)
	}
	if got.Title != "Sheet Pan Salad & More" || cmp.Diff([]string{"Sheet Pan", "Salad"}, got.SuggestedTags) != "" {
		t.Fatalf("article metadata mismatch: %#v", got)
	}

	fallback, err := extractRecipeHTML(`<title>  Plain title  </title><meta property="og:image" content="">`, "https://example.com/plain", "url")
	if err != nil {
		t.Fatal(err)
	}
	if fallback.Title != "Plain title" || fallback.ImageURL == nil || *fallback.ImageURL != "" || len(fallback.RawIngredients) != 0 {
		t.Fatalf("Open Graph fallback mismatch: %#v", fallback)
	}
}

func TestPinterestOrderedDiscoveryAndPlaceholder(t *testing.T) {
	node, err := decodeOrderedJSON([]byte(`{"later":{"link":"https://b.example"},"10":{"link":"https://ten.example"},"2":{"link":"https://two.example"},"ad":{"link":"https://doubleclick.net/x"},"promoted":{"is_promoted":true,"link":"https://skip.example","child":{"link":"https://child.example"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"https://two.example", "https://ten.example", "https://b.example", "https://child.example"}
	if diff := cmp.Diff(want, collectPinLinks(node)); diff != "" {
		t.Fatalf("ordered links mismatch (-want +got):\n%s", diff)
	}
	pinHTML := `<html><head><meta property="og:title" content="Pin title"><meta property="og:image" content="https://ignored.example/image"></head></html>`
	placeholder := pinPlaceholder(pinHTML, "https://pin.it/example")
	if placeholder.Title != "Pin title" || placeholder.ImageURL != nil || placeholder.SourceType != "pinterest_pin" || len(placeholder.RawIngredients) != 0 {
		t.Fatalf("pin placeholder mismatch: %#v", placeholder)
	}
	withSource := `<script id="__PWS_INITIAL_PROPS__">{"9":{"link":"https://nine.example"},"1":{"link":"https://one.example"}}</script>`
	if got := pinSource(withSource); got != "https://one.example" {
		t.Fatalf("ordered pin source = %q", got)
	}
}

func replaceNUL(value string) string {
	result := []byte(value)
	for index := range result {
		if result[index] == 0 {
			result[index] = 'x'
		}
	}
	return string(result)
}
