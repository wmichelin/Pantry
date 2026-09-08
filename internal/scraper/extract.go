package scraper

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/PuerkitoBio/goquery"
	"github.com/wmichelin/Pantry/internal/pantry"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

const jsWhitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

// The legacy patterns use JavaScript /i without /u: ASCII letters fold, but
// Kelvin sign and long s must not acquire ASCII matches. Preserve byte offsets
// by folding only ASCII in the searched input, then slice the original text.
type legacyPattern struct {
	re          *regexp.Regexp
	insensitive bool
}

func legacyRE(pattern string) legacyPattern {
	insensitive := strings.HasPrefix(pattern, "(?i)") || strings.HasPrefix(pattern, "(?is)")
	pattern = strings.TrimPrefix(pattern, "(?i)")
	pattern = strings.ReplaceAll(pattern, "(?is)", "(?s)")
	space := regexp.QuoteMeta(jsWhitespace)
	pattern = strings.ReplaceAll(pattern, `[\s-]`, "["+space+`\-]`)
	pattern = strings.ReplaceAll(pattern, `\s`, "["+space+"]")
	return legacyPattern{regexp.MustCompile(pattern), insensitive}
}

func (p legacyPattern) input(value string) string {
	if !p.insensitive {
		return value
	}
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return r
	}, value)
}
func (p legacyPattern) MatchString(value string) bool { return p.re.MatchString(p.input(value)) }
func (p legacyPattern) FindStringIndex(value string) []int {
	return p.re.FindStringIndex(p.input(value))
}
func (p legacyPattern) FindAllStringIndex(value string, n int) [][]int {
	return p.re.FindAllStringIndex(p.input(value), n)
}
func (p legacyPattern) FindString(value string) string {
	m := p.FindStringIndex(value)
	if m == nil {
		return ""
	}
	return value[m[0]:m[1]]
}
func (p legacyPattern) FindStringSubmatch(value string) []string {
	m := p.re.FindStringSubmatchIndex(p.input(value))
	if m == nil {
		return nil
	}
	result := make([]string, len(m)/2)
	for i := range result {
		if m[2*i] >= 0 {
			result[i] = value[m[2*i]:m[2*i+1]]
		}
	}
	return result
}
func (p legacyPattern) ReplaceAllString(value, replacement string) string {
	var result strings.Builder
	last := 0
	for _, m := range p.re.FindAllStringSubmatchIndex(p.input(value), -1) {
		result.WriteString(value[last:m[0]])
		result.Write(p.re.ExpandString(nil, replacement, value, m))
		last = m[1]
	}
	result.WriteString(value[last:])
	return result.String()
}

var (
	blockTagPattern = legacyRE(`(?is)</?(?:div|p|li|ul|ol|h[1-6]|br|section|article|header|footer)\b[^>]*>`)
	anyTagPattern   = legacyRE(`(?s)<[^>]+>`)
	horizontalSpace = legacyRE(`[ \t]+`)
	lineIndent      = legacyRE(`\n[ \t]*`)
	manyLines       = legacyRE(`\n{3,}`)
	ingredientHead  = legacyRE(`(?i)\bingredients?\b`)
	directionHead   = legacyRE(`(?i)\b(?:directions?|instructions?|method|how to make|preparation)\b`)
	noteHead        = legacyRE(`(?i)\b(?:notes?|tips?|variations?)\b`)
	sectionHead     = legacyRE(`(?i)^(?:ingredients?|directions?|instructions?)\b`)
	numberedLine    = legacyRE(`^\d+[.)]\s+`)
	servingsPattern = legacyRE(`(?i)servings?:?\s*(\d+)`)
	digitsPattern   = legacyRE(`\d+`)
	hoursPattern    = legacyRE(`(\d+)H`)
	minutesPattern  = legacyRE(`(\d+)M`)
	decimalEntity   = legacyRE(`&#(\d+);`)
	pseudoText      = legacyRE(`(?s)['"]text['"]\s*:\s*['"](.+)`)
	pseudoTail      = legacyRE(`['"]\s*[,}]?\s*$`)
	dashPrefix      = legacyRE(`^[-•*]\s*`)
)

type tagRule struct {
	pattern legacyPattern
	tag     string
}

var tagRules = []tagRule{
	{legacyRE(`(?i)sheet[\s-]pan`), "Sheet Pan"},
	{legacyRE(`(?i)slow[\s-]cooker|crock[\s-]pot`), "Crock Pot"},
	{legacyRE(`(?i)instant[\s-]pot|pressure[\s-]cook`), "Instant Pot"},
	{legacyRE(`(?i)one[\s-]pot|one[\s-]pan`), "One Pot"},
	{legacyRE(`(?i)\bsalad\b`), "Salad"},
	{legacyRE(`(?i)\bgrill(?:ed|ing)?\b|bbq|barbecue`), "Grill"},
	{legacyRE(`(?i)stir[\s-]fry|stir[\s-]fried`), "Stir Fry"},
	{legacyRE(`(?i)\bsoup\b|\bstew\b|\bchili\b|\bchilli\b`), "Soup / Stew"},
	{legacyRE(`(?i)no[\s-]bake|no[\s-]cook`), "No Cook"},
	{legacyRE(`(?i)\bcookies?\b|\bcake\b|\bcupcakes?\b|\bmuffins?\b|\bbrownies?\b|\bpies?\b|\bpastry\b|\bpastries\b|\bscones?\b|\bbread\b|\bbiscuits?\b|\btarts?\b|\bcobbler\b|\brolls?\b|\bdoughnuts?\b|\bdonuts?\b|\bmacarons?\b`), "Baking"},
}

func extractRecipeHTML(rawHTML, sourceURL, sourceType string) (pantry.ScrapedRecipe, error) {
	document, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return pantry.ScrapedRecipe{}, fmt.Errorf("parse recipe HTML: %w", err)
	}
	if recipe := extractJSONLD(document); recipe != nil {
		recipe.SourceURL = sourceURL
		recipe.SourceType = sourceType
		return *recipe, nil
	}
	if recipe := extractArticle(document); recipe != nil && (len(recipe.RawIngredients) > 0 || len(recipe.Instructions) > 0) {
		recipe.SourceURL = sourceURL
		recipe.SourceType = sourceType
		return *recipe, nil
	}
	title, exists := document.Find(`meta[property="og:title"]`).First().Attr("content")
	if !exists || title == "" {
		title = strings.Trim(document.Find("title").First().Text(), jsWhitespace)
	}
	if title == "" {
		title = "Untitled Recipe"
	}
	image, hasImage := document.Find(`meta[property="og:image"]`).First().Attr("content")
	return pantry.ScrapedRecipe{
		Title: title, SourceURL: sourceURL, SourceType: sourceType,
		ImageURL: optionalString(image, hasImage), RawIngredients: []string{}, Instructions: []string{},
		SuggestedTags: suggestTags(title),
	}, nil
}

func extractJSONLD(document *goquery.Document) *pantry.ScrapedRecipe {
	var found *jsonNode
	document.Find(`script[type="application/ld+json"]`).EachWithBreak(func(_ int, selection *goquery.Selection) bool {
		raw := selection.Text()
		node, err := decodeOrderedJSON([]byte(raw))
		if err != nil {
			return true
		}
		found = findRecipeNode(node)
		return found == nil
	})
	if found == nil {
		return nil
	}
	title := "Untitled Recipe"
	if value, ok := found.get("name").text(); ok {
		title = value
	}
	return &pantry.ScrapedRecipe{
		Title: title, ImageURL: extractImage(found.get("image")), Servings: parseServings(found.get("recipeYield")),
		PrepTimeMinutes: parseDuration(found.get("prepTime")), CookTimeMinutes: parseDuration(found.get("cookTime")),
		Instructions: extractInstructions(found.get("recipeInstructions")), RawIngredients: extractIngredients(found.get("recipeIngredient")),
		SuggestedTags: suggestTags(title),
	}
}

func findRecipeNode(node *jsonNode) *jsonNode {
	if node == nil {
		return nil
	}
	if node.array != nil {
		for _, child := range node.array {
			if recipe := findRecipeNode(child); recipe != nil {
				return recipe
			}
		}
		return nil
	}
	if node.object == nil {
		return nil
	}
	typeNode := node.get("@type")
	if value, ok := typeNode.text(); ok && value == "Recipe" {
		return node
	}
	if typeNode != nil && typeNode.array != nil {
		for _, value := range typeNode.array {
			if text, ok := value.text(); ok && text == "Recipe" {
				return node
			}
		}
	}
	graph := node.get("@graph")
	if graph != nil && graph.array != nil {
		return findRecipeNode(graph)
	}
	return nil
}

func extractImage(node *jsonNode) *string {
	if value, ok := node.text(); ok {
		if value == "" {
			return nil
		}
		return &value
	}
	if node == nil {
		return nil
	}
	if node.array != nil {
		if len(node.array) == 0 {
			return nil
		}
		return extractImage(node.array[0])
	}
	if node.object != nil {
		if value, ok := node.get("url").text(); ok {
			return &value
		}
		if value, ok := node.get("contentUrl").text(); ok {
			return &value
		}
	}
	return nil
}

func extractInstructions(node *jsonNode) []string {
	if node == nil || node.null {
		return []string{}
	}
	items := node.array
	if items == nil {
		items = []*jsonNode{node}
	}
	result := make([]string, 0)
	for _, item := range items {
		if text, ok := item.text(); ok {
			trimmed := strings.Trim(text, jsWhitespace)
			if strings.HasPrefix(trimmed, "{") && (strings.Contains(trimmed, "'text'") || strings.Contains(trimmed, `"text"`)) {
				if match := pseudoText.FindStringSubmatch(trimmed); match != nil {
					value := strings.Trim(pseudoTail.ReplaceAllString(match[1], ""), jsWhitespace)
					if value != "" {
						result = append(result, decodeEntities(value))
						continue
					}
				}
			}
			if trimmed != "" {
				result = append(result, decodeEntities(trimmed))
			}
			continue
		}
		if item == nil || item.object == nil {
			continue
		}
		if kind, ok := item.get("@type").text(); ok && kind == "HowToSection" {
			if children := item.get("itemListElement"); children != nil && children.array != nil {
				result = append(result, extractInstructions(children)...)
				continue
			}
		}
		text, ok := item.get("text").text()
		if !ok {
			text, ok = item.get("name").text()
		}
		if ok && text != "" {
			result = append(result, decodeEntities(strings.Trim(text, jsWhitespace)))
		}
	}
	return result
}

func extractIngredients(node *jsonNode) []string {
	if node == nil || node.array == nil {
		return []string{}
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, len(node.array))
	for _, item := range node.array {
		text, ok := item.text()
		if !ok {
			continue
		}
		text = decodeEntities(strings.Trim(text, jsWhitespace))
		if text == "" {
			continue
		}
		key := cases.Lower(language.Und).String(text)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, text)
	}
	return result
}

func parseServings(node *jsonNode) *int32 {
	if node == nil || node.null || (node.string != nil && *node.string == "") || (node.boolean != nil && !*node.boolean) {
		return nil
	}
	if node.number != "" {
		number, _ := strconv.ParseFloat(node.number.String(), 64)
		if number == 0 {
			return nil
		}
	}
	raw := jsValueString(node)
	if node.array != nil {
		if len(node.array) == 0 {
			return nil
		}
		raw = jsValueString(node.array[0])
	}
	match := digitsPattern.FindString(raw)
	if match == "" {
		return nil
	}
	value, err := strconv.ParseInt(match, 10, 32)
	if err != nil {
		return nil
	}
	parsed := int32(value)
	return &parsed
}

func parseDuration(node *jsonNode) *int32 {
	raw, ok := node.text()
	if !ok || raw == "" {
		return nil
	}
	value := float64(0)
	if match := hoursPattern.FindStringSubmatch(raw); match != nil {
		hours, _ := strconv.ParseFloat(match[1], 64)
		value += hours * 60
	}
	if match := minutesPattern.FindStringSubmatch(raw); match != nil {
		minutes, _ := strconv.ParseFloat(match[1], 64)
		value += minutes
	}
	if value <= 0 || value > math.MaxInt32 {
		return nil
	}
	parsed := int32(value)
	return &parsed
}

func extractArticle(document *goquery.Document) *pantry.ScrapedRecipe {
	selectors := []string{".article-body", "article", "main", ".entry-content", ".post-content", ".recipe-content", "#content"}
	rawHTML := ""
	for _, selector := range selectors {
		candidate, err := document.Find(selector).First().Html()
		if err == nil && jsLength(candidate) > 300 {
			rawHTML = candidate
			break
		}
	}
	if rawHTML == "" {
		rawHTML, _ = document.Find("body").First().Html()
	}
	if rawHTML == "" {
		return nil
	}
	text := blockTagPattern.ReplaceAllString(rawHTML, "\n")
	text = anyTagPattern.ReplaceAllString(text, " ")
	text = decodeArticleEntities(text)
	text = horizontalSpace.ReplaceAllString(text, " ")
	text = lineIndent.ReplaceAllString(text, "\n")
	text = manyLines.ReplaceAllString(text, "\n\n")
	text = strings.Trim(text, jsWhitespace)
	ingredientLocation := ingredientHead.FindStringIndex(text)
	if ingredientLocation == nil {
		return nil
	}
	ingredientIndex := jsLength(text[:ingredientLocation[0]])
	afterOffset := ingredientIndex + 11
	if afterOffset > jsLength(text) {
		afterOffset = jsLength(text)
	}
	directionIndex := -1
	afterText := jsSlice(text, afterOffset, jsLength(text))
	if relative := directionHead.FindStringIndex(afterText); relative != nil {
		directionIndex = afterOffset + jsLength(afterText[:relative[0]])
	}
	ingredientEnd := ingredientIndex + 1500
	if ingredientEnd > jsLength(text) {
		ingredientEnd = jsLength(text)
	}
	if directionIndex > ingredientIndex {
		ingredientEnd = directionIndex
	}
	ingredientText := jsSlice(text, ingredientIndex, ingredientEnd)
	rawIngredients := make([]string, 0)
	for _, line := range strings.Split(ingredientText, "\n") {
		line = strings.Trim(dashPrefix.ReplaceAllString(line, ""), jsWhitespace)
		if jsLength(line) > 3 && jsLength(line) < 300 && !sectionHead.MatchString(line) {
			rawIngredients = append(rawIngredients, line)
		}
	}
	if len(rawIngredients) == 0 {
		if firstDash := strings.Index(ingredientText, "- "); firstDash >= 0 {
			for _, value := range strings.Split(ingredientText[firstDash:], "- ") {
				value = strings.Trim(value, jsWhitespace)
				if jsLength(value) > 3 && jsLength(value) < 300 {
					rawIngredients = append(rawIngredients, value)
				}
			}
		}
	}
	rawIngredients = uniqueFold(rawIngredients)
	if len(rawIngredients) == 0 {
		return nil
	}
	instructions := []string{}
	if directionIndex >= 0 {
		directionEnd := directionIndex + 5000
		if directionEnd > jsLength(text) {
			directionEnd = jsLength(text)
		}
		if note := noteHead.FindStringIndex(text); note != nil && jsLength(text[:note[0]]) > directionIndex {
			directionEnd = jsLength(text[:note[0]])
		}
		directionText := jsSlice(text, directionIndex, directionEnd)
		for _, line := range strings.Split(directionText, "\n") {
			line = strings.Trim(line, jsWhitespace)
			if numberedLine.MatchString(line) {
				instructions = append(instructions, strings.Trim(numberedLine.ReplaceAllString(line, ""), jsWhitespace))
			}
		}
		if len(instructions) == 0 {
			instructions = continuousSteps(directionText)
		}
	}
	title, exists := document.Find(`meta[property="og:title"]`).First().Attr("content")
	if !exists || title == "" {
		title = strings.Trim(document.Find("title").First().Text(), jsWhitespace)
	}
	if title == "" {
		title = "Untitled Recipe"
	}
	title = decodeEntities(title)
	image, hasImage := document.Find(`meta[property="og:image"]`).First().Attr("content")
	recipe := &pantry.ScrapedRecipe{Title: title, ImageURL: optionalString(image, hasImage), RawIngredients: rawIngredients, Instructions: instructions, SuggestedTags: suggestTags(title)}
	if match := servingsPattern.FindStringSubmatch(text); match != nil {
		value, _ := strconv.ParseInt(match[1], 10, 32)
		parsed := int32(value)
		recipe.Servings = &parsed
	}
	return recipe
}

func continuousSteps(text string) []string {
	locations := legacyRE(`\d+\.\s+`).FindAllStringIndex(text, -1)
	result := make([]string, 0, len(locations))
	for index, location := range locations {
		end := len(text)
		if index+1 < len(locations) {
			end = locations[index+1][0]
		}
		value := strings.Trim(text[location[1]:end], jsWhitespace)
		if jsLength(value) > 5 {
			result = append(result, value)
		}
	}
	return result
}

func uniqueFold(values []string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0, len(values))
	for _, value := range values {
		key := cases.Lower(language.Und).String(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func suggestTags(title string) []string {
	result := make([]string, 0)
	for _, rule := range tagRules {
		if rule.pattern.MatchString(title) {
			result = append(result, rule.tag)
		}
	}
	return result
}

func decodeEntities(value string) string {
	// String.fromCharCode applies ToUint16 after JS parseInt. Accumulate code
	// units before decoding so adjacent surrogate entities can form a pair.
	units := make([]uint16, 0, len(value))
	last := 0
	for _, match := range decimalEntity.re.FindAllStringSubmatchIndex(value, -1) {
		units = append(units, utf16.Encode([]rune(value[last:match[0]]))...)
		code, _ := strconv.ParseFloat(value[match[2]:match[3]], 64)
		unit := uint16(0)
		if !math.IsInf(code, 0) && !math.IsNaN(code) {
			unit = uint16(math.Mod(code, 65536))
		}
		units = append(units, unit)
		last = match[1]
	}
	units = append(units, utf16.Encode([]rune(value[last:]))...)
	value = string(utf16.Decode(units))
	return replaceEntitiesInOrder(value, [][2]string{
		{"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"}, {"&quot;", `"`}, {"&apos;", "'"}, {"&nbsp;", " "},
	})
}

// Article body extraction has a smaller, differently ordered decoder than
// JSON-LD instructions. In particular it does not decode arbitrary decimals.
func decodeArticleEntities(value string) string {
	return replaceEntitiesInOrder(value, [][2]string{
		{"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"}, {"&nbsp;", " "}, {"&#39;", "'"}, {"&quot;", `"`},
	})
}

func replaceEntitiesInOrder(value string, replacements [][2]string) string {
	for _, replacement := range replacements {
		value = strings.ReplaceAll(value, replacement[0], replacement[1])
	}
	return value
}

func jsLength(value string) int {
	length := 0
	for _, r := range value {
		if r > 0xffff {
			length += 2
		} else {
			length++
		}
	}
	return length
}

func jsSlice(value string, start, end int) string {
	units := utf16.Encode([]rune(value))
	if start > len(units) {
		start = len(units)
	}
	if end > len(units) {
		end = len(units)
	}
	// JS can leave a lone surrogate at a slice/entity boundary. Protobuf strings
	// require UTF-8: normalize only that non-Unicode value to U+FFFD, like UTF-8
	// encoding a JS string, rather than returning invalid bytes or dropping text.
	return string(utf16.Decode(units[start:end]))
}

func jsValueString(node *jsonNode) string {
	if node == nil || node.null {
		return "null"
	}
	if node.string != nil {
		return *node.string
	}
	if node.boolean != nil {
		return strconv.FormatBool(*node.boolean)
	}
	if node.number != "" {
		number, _ := strconv.ParseFloat(node.number.String(), 64)
		if number == 0 {
			return "0"
		}
		if math.IsInf(number, 1) {
			return "Infinity"
		}
		if math.IsInf(number, -1) {
			return "-Infinity"
		}
		if math.Abs(number) >= 1e-6 && math.Abs(number) < 1e21 {
			return strconv.FormatFloat(number, 'f', -1, 64)
		}
		text := strconv.FormatFloat(number, 'e', -1, 64)
		parts := strings.Split(text, "e")
		exponent, _ := strconv.Atoi(parts[1])
		return parts[0] + "e" + fmt.Sprintf("%+d", exponent)
	}
	if node.array != nil {
		parts := make([]string, len(node.array))
		for i, child := range node.array {
			if child != nil && !child.null {
				parts[i] = jsValueString(child)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

func optionalString(value string, present bool) *string {
	if !present {
		return nil
	}
	return &value
}
