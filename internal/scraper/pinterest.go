package scraper

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/wmichelin/Pantry/internal/pantry"
)

var (
	initialPropsPattern = regexp.MustCompile(`(?s)<script\s+id="__PWS_INITIAL_PROPS__"[^>]*>(.*?)</script>`)
	csrfMetaPattern     = regexp.MustCompile(`name="csrfmiddlewaretoken"[^>]*value="([^"]+)"`)
	csrfJSONPattern     = regexp.MustCompile(`"csrftoken"\s*:\s*"([^"]+)"`)
	appVersionJSON      = regexp.MustCompile(`"app_version"\s*:\s*"([^"]+)"`)
	appVersionJS        = regexp.MustCompile(`appVersion['"]\s*:\s*['"]([^'"]+)`)
	appVersionQuery     = regexp.MustCompile(`client_version=([^&"]+)`)
)

func detectURLType(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "recipe"
	}
	host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
	if host == "pin.it" {
		return "pin"
	}
	if host == "pinterest.com" || host == "pinterest.co.uk" {
		parts := nonEmpty(strings.Split(parsed.Path, "/"))
		if len(parts) > 0 && parts[0] == "pin" {
			return "pin"
		}
		if len(parts) >= 2 {
			return "board"
		}
	}
	return "recipe"
}

func parseSSRJSON(rawHTML string) *jsonNode {
	if match := initialPropsPattern.FindStringSubmatch(rawHTML); match != nil {
		if node, err := decodeOrderedJSON([]byte(match[1])); err == nil {
			return node
		}
	}
	marker := strings.Index(rawHTML, "window.__PWS_DATA__")
	if marker < 0 {
		return nil
	}
	brace := strings.Index(rawHTML[marker:], "{")
	if brace < 0 {
		return nil
	}
	brace += marker
	depth := 0
	for index := brace; index < len(rawHTML); index++ {
		switch rawHTML[index] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				node, err := decodeOrderedJSON([]byte(rawHTML[brace : index+1]))
				if err == nil {
					return node
				}
				return nil
			}
		}
	}
	return nil
}

func crawlerLinks(rawHTML string) []string {
	if rawHTML == "" {
		return []string{}
	}
	document, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return []string{}
	}
	seen := make(map[string]struct{})
	links := make([]string, 0)
	document.Find("a[href]").Each(func(_ int, selection *goquery.Selection) {
		href, _ := selection.Attr("href")
		if !strings.HasPrefix(href, "http") || strings.Contains(href, "pinterest.com") || strings.Contains(href, "pinterest.co") {
			return
		}
		if _, exists := seen[href]; exists {
			return
		}
		seen[href] = struct{}{}
		links = append(links, href)
	})
	if node := parseSSRJSON(rawHTML); node != nil {
		links = appendUnique(links, collectPinLinks(node))
	}
	return links
}

func collectPinLinks(node *jsonNode) []string {
	seen := make(map[string]struct{})
	return collectPinLinksInto(node, seen)
}

func collectPinLinksInto(node *jsonNode, seen map[string]struct{}) []string {
	if node == nil {
		return nil
	}
	if node.array != nil {
		result := []string{}
		for _, child := range node.array {
			result = append(result, collectPinLinksInto(child, seen)...)
		}
		return result
	}
	if node.object == nil {
		return nil
	}
	result := []string{}
	if link, ok := node.get("link").text(); ok && strings.HasPrefix(link, "http") && !strings.Contains(link, "pinterest.com") {
		if _, exists := seen[link]; !exists && !promotedPin(node) && !adURL(link) {
			seen[link] = struct{}{}
			result = append(result, link)
		}
	}
	for _, child := range node.objectValues() {
		result = append(result, collectPinLinksInto(child, seen)...)
	}
	return result
}

func promotedPin(node *jsonNode) bool {
	for _, key := range []string{"is_promoted", "promoted"} {
		if value := node.get(key); value != nil && value.boolean != nil && *value.boolean {
			return true
		}
	}
	if value := node.get("ad_match_reason"); value != nil && !value.null {
		return true
	}
	if value, ok := node.get("type").text(); ok && value == "promotedPin" {
		return true
	}
	if _, ok := node.get("promotion_id").text(); ok {
		return true
	}
	return false
}

func adURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	adHosts := map[string]struct{}{"googleadservices.com": {}, "doubleclick.net": {}, "ad.doubleclick.net": {}, "ads.pinterest.com": {}, "click.linksynergy.com": {}}
	_, exact := adHosts[host]
	return exact || strings.Contains(host, ".ads.") || strings.Contains(host, "tracking.")
}

func findBoardID(node *jsonNode) string {
	if node == nil {
		return ""
	}
	if node.array != nil {
		for _, child := range node.array {
			if found := findBoardID(child); found != "" {
				return found
			}
		}
		return ""
	}
	if node.object == nil {
		return ""
	}
	id, hasID := node.get("id").text()
	boardURL, hasURL := node.get("url").text()
	_, hasName := node.get("name").text()
	typeName, _ := node.get("type").text()
	if hasID && hasURL && hasName && (typeName == "board" || len(nonEmpty(strings.Split(boardURL, "/"))) == 2) {
		return id
	}
	for _, child := range node.objectValues() {
		if found := findBoardID(child); found != "" {
			return found
		}
	}
	return ""
}

func findBookmark(node *jsonNode) string {
	if node == nil {
		return ""
	}
	if node.array != nil {
		for _, child := range node.array {
			if found := findBookmark(child); found != "" {
				return found
			}
		}
		return ""
	}
	if node.object == nil {
		return ""
	}
	for _, key := range []string{"nextBookmark", "bookmark"} {
		if value, ok := node.get(key).text(); ok && len(value) > 5 && value != "-end-" {
			return value
		}
	}
	if bookmarks := node.get("bookmarks"); bookmarks != nil && bookmarks.array != nil {
		for _, value := range bookmarks.array {
			if bookmark, ok := value.text(); ok && len(bookmark) > 5 && bookmark != "-end-" {
				return bookmark
			}
		}
	}
	for _, child := range node.objectValues() {
		if found := findBookmark(child); found != "" {
			return found
		}
	}
	return ""
}

func findFirstPinLink(node *jsonNode) string {
	if node == nil {
		return ""
	}
	if node.array != nil {
		for _, child := range node.array {
			if found := findFirstPinLink(child); found != "" {
				return found
			}
		}
		return ""
	}
	if node.object == nil {
		return ""
	}
	if link, ok := node.get("link").text(); ok && strings.HasPrefix(link, "http") && !strings.Contains(link, "pinterest.com") {
		return link
	}
	for _, child := range node.objectValues() {
		if found := findFirstPinLink(child); found != "" {
			return found
		}
	}
	return ""
}

func pinSource(rawHTML string) string {
	if match := initialPropsPattern.FindStringSubmatch(rawHTML); match != nil {
		if node, err := decodeOrderedJSON([]byte(match[1])); err == nil {
			if source := findFirstPinLink(node); source != "" {
				return source
			}
		}
	}
	document, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return ""
	}
	seeAlso, _ := document.Find(`meta[property="og:see_also"]`).First().Attr("content")
	if seeAlso != "" && !strings.Contains(seeAlso, "pinterest.com") {
		return seeAlso
	}
	return ""
}

func pinPlaceholder(rawHTML, sourceURL string) pantry.ScrapedRecipe {
	document, _ := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	title, exists := document.Find(`meta[property="og:title"]`).First().Attr("content")
	if !exists || title == "" {
		title = document.Find("title").First().Text()
	}
	if title == "" {
		title = "Pinterest Recipe"
	}
	return pantry.ScrapedRecipe{Title: title, SourceURL: sourceURL, SourceType: "pinterest_pin", RawIngredients: []string{}, Instructions: []string{}, SuggestedTags: []string{}}
}

func pinterestSession(headers http.Header, rawHTML string) (string, string, string) {
	cookies := make([]string, 0)
	for _, raw := range headers.Values("Set-Cookie") {
		if value := strings.TrimSpace(strings.SplitN(raw, ";", 2)[0]); value != "" {
			cookies = append(cookies, value)
		}
	}
	cookieHeader := strings.Join(cookies, "; ")
	csrf := ""
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie, "csrftoken=") {
			csrf = strings.TrimPrefix(cookie, "csrftoken=")
			break
		}
	}
	if csrf == "" {
		for _, pattern := range []*regexp.Regexp{csrfMetaPattern, csrfJSONPattern} {
			if match := pattern.FindStringSubmatch(rawHTML); match != nil {
				csrf = match[1]
				break
			}
		}
	}
	version := ""
	for _, pattern := range []*regexp.Regexp{appVersionJSON, appVersionJS, appVersionQuery} {
		if match := pattern.FindStringSubmatch(rawHTML); match != nil {
			version = match[1]
			break
		}
	}
	return cookieHeader, csrf, version
}

func appendUnique(current []string, values []string) []string {
	seen := make(map[string]struct{}, len(current)+len(values))
	for _, value := range current {
		seen[value] = struct{}{}
	}
	for _, value := range values {
		if _, exists := seen[value]; !exists {
			seen[value] = struct{}{}
			current = append(current, value)
		}
	}
	return current
}

func nonEmpty(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}
