package pantry

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// Single-ingredient compatibility parser. Array expansion/filtering is a separate
// import contract; catalog names deliberately do not split "salt and pepper".
type ParsedIngredient struct {
	Quantity  *float64 `json:"quantity"`
	Unit      *string  `json:"unit"`
	Name      string   `json:"name"`
	RawString string   `json:"raw_string"`
}
type ingredientPattern struct {
	re          *regexp.Regexp
	insensitive bool
}

func ingredientRE(pattern string) ingredientPattern {
	insensitive := strings.HasPrefix(pattern, "(?i)")
	pattern = strings.TrimPrefix(pattern, "(?i)")
	// RE2's \s is ASCII-only; JS \s includes these additional Unicode characters.
	pattern = strings.ReplaceAll(pattern, `\s`, "["+regexp.QuoteMeta(jsTrim)+"]")
	return ingredientPattern{regexp.MustCompile(pattern), insensitive}
}
func (p ingredientPattern) input(s string) string {
	if !p.insensitive {
		return s
	}
	// JS /i without /u does not fold Kelvin-sign/long-s into ASCII unit names.
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		return r
	}, s)
}
func (p ingredientPattern) match(s string) []string {
	indices := p.re.FindStringSubmatchIndex(p.input(s))
	if indices == nil {
		return nil
	}
	out := make([]string, len(indices)/2)
	for i := range out {
		if indices[2*i] >= 0 {
			out[i] = s[indices[2*i]:indices[2*i+1]]
		}
	}
	return out
}
func (p ingredientPattern) replace(s, replacement string) string {
	indices := p.re.FindAllStringSubmatchIndex(p.input(s), -1)
	if len(indices) == 0 {
		return s
	}
	var out strings.Builder
	last := 0
	for _, m := range indices {
		out.WriteString(s[last:m[0]])
		out.Write(p.re.ExpandString(nil, replacement, s, m))
		last = m[1]
	}
	out.WriteString(s[last:])
	return out.String()
}

var ingredientUnits = func() []string {
	units := strings.Split("cup|cups|c|tablespoon|tablespoons|tbsp|tbs|teaspoon|teaspoons|tsp|fluid ounce|fluid ounces|fl oz|pint|pints|pt|quart|quarts|qt|gallon|gallons|gal|milliliter|milliliters|ml|liter|liters|l|ounce|ounces|oz|pound|pounds|lb|lbs|gram|grams|g|kilogram|kilograms|kg|clove|cloves|can|cans|jar|jars|package|packages|pkg|slice|slices|piece|pieces|stalk|stalks|sprig|sprigs|bunch|bunches|head|heads|pinch|pinches|dash|dashes|handful|handfuls|strip|strips", "|")
	sort.SliceStable(units, func(i, j int) bool { return len(units[i]) > len(units[j]) })
	return units
}()
var (
	ingredientBullet      = ingredientRE(`^[-•–]\s*`)
	ingredientDual        = ingredientRE(`(?i)^(?:\d+(?:\.\d+)?\s*[-–]\s*)?\d+(?:\.\d+)?\s*(?:kg|g|mg|lb|lbs|oz|ml|l)\s*/\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:kg|g|mg|lb|lbs|oz|ml|l|tbsp|tbs|tsp|tablespoons?|teaspoons?|cups?)?\s+`)
	ingredientServing     = ingredientRE(`(?i)^for serving\s*:\s*`)
	ingredientTaste       = ingredientRE(`(?i)^to taste\s+`)
	ingredientDescription = ingredientRE(`\s+[–—]\s+[^\r\n\x{2028}\x{2029}]+$`)
	ingredientPackage     = ingredientRE(`(?i)\b(?:cans?|jars?)\s*\(\s*(?:\d+(?:\.\d+)?\s*-?\s*(?:oz|ounce)s?\s+)?([^)]+?)\s*\)`)
	ingredientComma       = ingredientRE(`\s*,\s*[^\r\n\x{2028}\x{2029}]*$`)
	ingredientParens      = ingredientRE(`\s*\([^()]*\)`)
	ingredientUnclosed    = ingredientRE(`\s*\([^)]*$`)
	ingredientSize        = ingredientRE(`(?i)\b\d+\s*-\s*(?:oz|ounce)s?\b\s*`)
	ingredientMixedDash   = ingredientRE(`^(\d+)-(\d+/\d+)(\s|$)`)
	ingredientSpaces      = ingredientRE(`\s{2,}`)
	ingredientUnitPrefix  = ingredientRE(`^(?:\.|\s)+`)
	ingredientOf          = ingredientRE(`(?i)^of\s+`)
	ingredientPrep        = ingredientRE(`(?i)\s*,\s*(minced|chopped|diced|sliced|grated|shredded|crushed|peeled|trimmed|halved|quartered|roughly|finely|thinly|coarsely|lightly|packed|fresh|frozen|thawed|drained|rinsed|cooked|softened|melted|room temperature|juiced|julienned|divided|optional|to taste|as needed|use more as needed|or more|or to taste|if desired|for garnish|for serving)[^\r\n\x{2028}\x{2029}]*$`)
	ingredientInverted    = ingredientRE(`(?i)\s*:\s*(?:to taste|\d+(?:/\d+)?(?:\.\d+)?(?:\s*[-–]\s*\d+(?:/\d+)?(?:\.\d+)?)?\s*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lb|lbs|pounds?|g|kg|ml|l)?)\s*$`)
	ingredientInch        = ingredientRE(`(?i)^(?:\d+(?:\.\d+)?\s+)?(?:\d+/\d+|[½⅓⅔¼¾⅛⅜⅝⅞])?-?\s*inch\s+piece\s+of\s+`)
	ingredientLeadingPrep = ingredientRE(`(?i)^(?:minced|beaten)\s+`)
	ingredientFiller      = ingredientRE(`(?i)^(?:additional|extra|optional)\s+`)
	ingredientPurpose     = ingredientRE(`(?i)\s+for\s+(?:topping|garnish|serving|sprinkling)\s*$`)
	ingredientFootnote    = ingredientRE(`\*+$`)
	ingredientCan         = ingredientRE(`(?i)^cans?$`)
	ingredientSection     = ingredientRE(`:$`)
	ingredientServingLine = ingredientRE(`(?i)^for serving\b`)
	ingredientCompound    = ingredientRE(`(?i)^([a-zA-Z][^,]*?)\s+(?:and|or)\s+([a-zA-Z][^\r\n\x{2028}\x{2029}]*)$`)
	ingredientQuantities  = []ingredientPattern{
		ingredientRE(`^(\d+/\d+)\s*[-–]\s*(\d+/\d+)\s+`),
		ingredientRE(`^(\d+/\d+)\s*[-–]\s*(\d+)\s+`),
		ingredientRE(`^([½⅓⅔¼¾⅛⅜⅝⅞])\s*[-–]\s*(\d+(?:/\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])\s+`),
		ingredientRE(`^(\d+\.\d+)\s*[-–]\s*(\d+(?:\.\d+)?)\s+`),
		ingredientRE(`(?i)^(\d+)\s*[-–]\s*(\d+)(kg|g|mg|lb|lbs|oz|ml|l)\b\s*`),
		ingredientRE(`^(\d+)\s*[-–]\s*(\d+)\s+`),
		ingredientRE(`^(\d+)\s+(\d+/\d+|[½⅓⅔¼¾⅛⅜⅝⅞])\s+`),
		ingredientRE(`^(\d+)([½⅓⅔¼¾⅛⅜⅝⅞])\s+`),
		ingredientRE(`^([½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:/\d+)?(?:\.\d+)?)\s+`),
		ingredientRE(`(?i)^(\d+(?:\.\d+)?)(kg|g|mg|lb|lbs|oz|ml|l)\b\s*`),
	}
)

// ParseIngredients preserves the legacy import-array contract. It intentionally
// differs from the catalog's single-ingredient parser: section/serving lines are
// removed, one alphabetic compound is expanded, and final names are lowercased.
func ParseIngredients(raws []string) []ParsedIngredient {
	parsed := make([]ParsedIngredient, 0, len(raws))
	for _, raw := range raws {
		stripped := strings.Trim(raw, jsTrim)
		stripped = ingredientBullet.replace(stripped, "")
		if ingredientSection.match(stripped) != nil || ingredientServingLine.match(stripped) != nil {
			continue
		}
		for _, expanded := range expandCompoundIngredient(raw) {
			ingredient := ParseIngredient(expanded)
			ingredient.Name = cases.Lower(language.Und).String(ingredient.Name)
			parsed = append(parsed, ingredient)
		}
	}
	return parsed
}

func expandCompoundIngredient(raw string) []string {
	stripped := strings.Trim(raw, jsTrim)
	stripped = ingredientBullet.replace(stripped, "")
	stripped = ingredientFiller.replace(stripped, "")
	stripped = ingredientPurpose.replace(stripped, "")
	stripped = ingredientDescription.replace(stripped, "")
	stripped = strings.Trim(stripped, jsTrim)
	if stripped == "" {
		return []string{raw}
	}
	if match := ingredientCompound.match(stripped); match != nil {
		return []string{strings.Trim(match[1], jsTrim), strings.Trim(match[2], jsTrim)}
	}
	return []string{stripped}
}

func ingredientFraction(s string) float64 {
	if v, ok := map[string]float64{"½": .5, "⅓": .333, "⅔": .667, "¼": .25, "¾": .75, "⅛": .125, "⅜": .375, "⅝": .625, "⅞": .875}[s]; ok {
		return v
	}
	if parts := strings.Split(s, "/"); len(parts) == 2 && !strings.Contains(parts[1], ".") {
		a, _ := strconv.ParseFloat(parts[0], 64)
		b, _ := strconv.ParseFloat(parts[1], 64)
		return a / b
	}
	// JS parseFloat consumes the numeric prefix even for malformed trailing text.
	prefix := regexp.MustCompile(`^\d+(?:\.\d+)?`).FindString(s)
	n, _ := strconv.ParseFloat(prefix, 64)
	return n
}
func ParseIngredient(raw string) ParsedIngredient {
	trim := func(s string) string { return strings.Trim(s, jsTrim) }
	s := trim(raw)
	for _, p := range []ingredientPattern{ingredientBullet, ingredientDual, ingredientServing, ingredientTaste, ingredientDescription} {
		s = p.replace(s, "")
	}
	packaged := ""
	if m := ingredientPackage.match(s); m != nil {
		packaged = trim(ingredientComma.replace(m[1], ""))
	}
	for {
		next := ingredientParens.replace(s, "")
		if next == s {
			break
		}
		s = next
	}
	s = ingredientUnclosed.replace(s, "")
	s = ingredientSize.replace(s, "")
	s = ingredientMixedDash.replace(s, "${1} ${2}${3}")
	s = trim(ingredientSpaces.replace(s, " "))
	out := ParsedIngredient{RawString: raw}
	for i, p := range ingredientQuantities {
		if m := p.match(s); m != nil {
			var quantity float64
			switch {
			case i <= 5:
				quantity = ingredientFraction(m[2])
				if i == 4 {
					u := strings.ToLower(m[3])
					out.Unit = &u
				}
			case i <= 7:
				quantity = ingredientFraction(m[1]) + ingredientFraction(m[2])
			default:
				quantity = ingredientFraction(m[1])
				if i == 9 {
					u := strings.ToLower(m[2])
					out.Unit = &u
				}
			}
			if i == 8 && math.IsNaN(quantity) {
				break // JS single-value branch leaves malformed fractions unconsumed.
			}
			out.Quantity = &quantity
			s = s[len(m[0]):]
			break
		}
	}
	if out.Unit == nil {
		lower := normalizeShoppingName(s)
		for _, u := range ingredientUnits {
			if strings.HasPrefix(lower, u) && (len(lower) == len(u) || lower[len(u)] == ' ' || lower[len(u)] == '.') {
				out.Unit = &u
				s = ingredientOf.replace(ingredientUnitPrefix.replace(string([]rune(s)[len(u):]), ""), "")
				break
			}
		}
	}
	name := s
	for _, p := range []ingredientPattern{ingredientPrep, ingredientInverted, ingredientInch, ingredientLeadingPrep, ingredientFiller, ingredientPurpose, ingredientFootnote} {
		name = trim(p.replace(name, ""))
	}
	if (name == "" || ingredientCan.match(name) != nil) && packaged != "" {
		name = packaged
	}
	if name == "" {
		name = trim(raw)
	}
	out.Name = name
	return out
}
func catalogName(raw string) (ShoppingCatalogSeed, bool) {
	name := ParseIngredient(raw).Name
	key := normalizeShoppingName(name)
	if key == "" || strings.HasSuffix(key, ":") {
		return ShoppingCatalogSeed{}, false
	}
	display := strings.Trim(name, jsTrim)
	if display == key {
		display = shoppingTitle(key)
	}
	return ShoppingCatalogSeed{NormalizedName: key, DisplayName: display}, true
}
