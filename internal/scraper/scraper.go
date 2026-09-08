package scraper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wmichelin/Pantry/internal/pantry"
)

const (
	operationTimeout       = 42 * time.Second
	maxOutboundRequests    = 300
	maxCumulativeBytes     = 32 << 20
	maxDiscoveredBoardURLs = 500
	maxBoardRecipes        = 250
	boardBatchSize         = 10
	maxPinterestPages      = 15
	maxRecipeOutputBytes   = 256 << 10
	maxBoardOutputBytes    = 4 << 20
	maxRecipeValues        = 500
	maxRecipeValueBytes    = 32 << 10
)

var errScrapeBudget = errors.New("scrape safety budget exhausted")

type fetchBudgetContextKey struct{}

type fetchBudget interface {
	beforeRequest() error
	consumeBytes(int) error
	err() error
}

func withFetchBudget(ctx context.Context, budget fetchBudget) context.Context {
	return context.WithValue(ctx, fetchBudgetContextKey{}, budget)
}

func fetchBudgetFromContext(ctx context.Context) fetchBudget {
	budget, _ := ctx.Value(fetchBudgetContextKey{}).(fetchBudget)
	return budget
}

type fetchBudgetAware interface{ usesRequestBudget() }

func budgetBeforeRequest(ctx context.Context) error {
	if budget := fetchBudgetFromContext(ctx); budget != nil {
		return budget.beforeRequest()
	}
	return nil
}

func budgetResponseReader(ctx context.Context, reader io.Reader) io.Reader {
	budget := fetchBudgetFromContext(ctx)
	if budget == nil {
		return reader
	}
	return &meteredResponseReader{next: reader, budget: budget}
}

type meteredResponseReader struct {
	next   io.Reader
	budget fetchBudget
}

func (reader *meteredResponseReader) Read(buffer []byte) (int, error) {
	count, err := reader.next.Read(buffer)
	if count > 0 {
		if budgetErr := reader.budget.consumeBytes(count); budgetErr != nil {
			return 0, budgetErr
		}
	}
	return count, err
}

const browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

type Scraper struct {
	fetcher Fetcher
	limiter *scrapeLimiter
	slots   chan struct{}
	now     func() time.Time
}

func New(deniedHosts ...string) (*Scraper, error) {
	fetcher, err := NewSafeFetcher(deniedHosts...)
	if err != nil {
		return nil, err
	}
	return NewWithFetcher(fetcher), nil
}

func NewWithFetcher(fetcher Fetcher) *Scraper {
	return &Scraper{fetcher: fetcher, limiter: newScrapeLimiter(), slots: make(chan struct{}, 4), now: time.Now}
}

func (scraper *Scraper) Scrape(ctx context.Context, subject, householdID, rawURL string) (*pantry.ScrapeResult, error) {
	finish, err := scraper.limiter.begin(subject)
	if err != nil {
		return nil, err
	}
	defer finish()
	operationContext, timeoutCancel := context.WithTimeout(ctx, operationTimeout)
	defer timeoutCancel()
	select {
	case scraper.slots <- struct{}{}:
		defer func() { <-scraper.slots }()
	default:
		return nil, pantry.ErrScrapeBusy
	}
	operationContext, budgetCancel := context.WithCancel(operationContext)
	defer budgetCancel()
	budget := newBudgetFetcher(scraper.fetcher, budgetCancel)
	switch detectURLType(rawURL) {
	case "pin":
		recipe, err := scraper.scrapePin(operationContext, budget, rawURL)
		if err != nil {
			return nil, err
		}
		return &pantry.ScrapeResult{Recipe: recipe}, nil
	case "board":
		board, err := scraper.scrapeBoard(operationContext, budget, rawURL)
		if err != nil {
			return nil, err
		}
		return &pantry.ScrapeResult{Board: board}, nil
	default:
		recipe, err := scraper.scrapeRecipeURL(operationContext, budget, rawURL, "url")
		if err != nil {
			return nil, err
		}
		return &pantry.ScrapeResult{Recipe: recipe}, nil
	}
}

type budgetFetcher struct {
	next      Fetcher
	cancel    context.CancelFunc
	mu        sync.Mutex
	attempts  int
	bytes     int
	exhausted bool
}

func newBudgetFetcher(next Fetcher, cancel context.CancelFunc) *budgetFetcher {
	return &budgetFetcher{next: next, cancel: cancel}
}

func (fetcher *budgetFetcher) Fetch(ctx context.Context, request FetchRequest) (FetchResponse, error) {
	if _, ok := fetcher.next.(fetchBudgetAware); ok {
		response, err := fetcher.next.Fetch(withFetchBudget(ctx, fetcher), request)
		if budgetErr := fetcher.err(); budgetErr != nil {
			return FetchResponse{}, budgetErr
		}
		return response, err
	}
	if err := fetcher.beforeRequest(); err != nil {
		return FetchResponse{}, err
	}
	response, err := fetcher.next.Fetch(ctx, request)
	if err != nil {
		if budgetErr := fetcher.err(); budgetErr != nil {
			return FetchResponse{}, budgetErr
		}
		return FetchResponse{}, err
	}
	if err := fetcher.consumeBytes(len(response.Body)); err != nil {
		return FetchResponse{}, err
	}
	return response, nil
}

func (fetcher *budgetFetcher) beforeRequest() error {
	fetcher.mu.Lock()
	if fetcher.exhausted || fetcher.attempts >= maxOutboundRequests {
		fetcher.exhausted = true
		fetcher.mu.Unlock()
		fetcher.cancel()
		return errScrapeBudget
	}
	fetcher.attempts++
	fetcher.mu.Unlock()
	return nil
}

func (fetcher *budgetFetcher) consumeBytes(count int) error {
	fetcher.mu.Lock()
	if fetcher.exhausted || count > maxCumulativeBytes-fetcher.bytes {
		fetcher.exhausted = true
		fetcher.mu.Unlock()
		fetcher.cancel()
		return errScrapeBudget
	}
	fetcher.bytes += count
	fetcher.mu.Unlock()
	return nil
}

func (fetcher *budgetFetcher) err() error {
	fetcher.mu.Lock()
	defer fetcher.mu.Unlock()
	if fetcher.exhausted {
		return errScrapeBudget
	}
	return nil
}

func (scraper *Scraper) scrapeRecipeURL(ctx context.Context, fetcher Fetcher, rawURL, sourceType string) (*pantry.ScrapedRecipe, error) {
	response, err := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: rawURL, Headers: htmlHeaders(browserUserAgent)})
	if err != nil {
		return nil, err
	}
	if response.Status < 200 || response.Status >= 300 {
		return nil, fmt.Errorf("recipe site returned HTTP %d", response.Status)
	}
	recipe, err := extractRecipeHTML(string(response.Body), rawURL, sourceType)
	if err != nil {
		return nil, err
	}
	if err := validateRecipeOutput(recipe); err != nil {
		return nil, err
	}
	return &recipe, nil
}

func (scraper *Scraper) scrapePin(ctx context.Context, fetcher Fetcher, rawURL string) (*pantry.ScrapedRecipe, error) {
	response, err := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: rawURL, Headers: htmlHeaders(browserUserAgent)})
	if err != nil {
		return nil, err
	}
	if response.Status < 200 || response.Status >= 300 {
		return nil, fmt.Errorf("Pinterest returned HTTP %d", response.Status)
	}
	html := string(response.Body)
	source := pinSource(html)
	if source == "" {
		recipe := pinPlaceholder(html, rawURL)
		if err := validateRecipeOutput(recipe); err != nil {
			return nil, err
		}
		return &recipe, nil
	}
	return scraper.scrapeRecipeURL(ctx, fetcher, source, "pinterest_pin")
}

func (scraper *Scraper) scrapeBoard(ctx context.Context, fetcher *budgetFetcher, boardURL string) (*pantry.ScrapedBoard, error) {
	crawlerResponse, crawlerErr := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: boardURL, Headers: htmlHeaders("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")})
	crawlerHTML := ""
	if crawlerErr == nil && crawlerResponse.Status >= 200 && crawlerResponse.Status < 300 {
		crawlerHTML = string(crawlerResponse.Body)
	}
	browserResponse, err := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: boardURL, Headers: htmlHeaders(browserUserAgent)})
	if err != nil {
		return nil, err
	}
	if browserResponse.Status < 200 || browserResponse.Status >= 300 {
		return nil, fmt.Errorf("Pinterest returned HTTP %d", browserResponse.Status)
	}
	browserHTML := string(browserResponse.Body)
	urls := appendUnique(crawlerLinks(crawlerHTML), collectPinLinks(parseSSRJSON(browserHTML)))
	if len(urls) > maxDiscoveredBoardURLs {
		urls = urls[:maxDiscoveredBoardURLs]
	}
	cookies, csrf, appVersion := pinterestSession(browserResponse.Headers, browserHTML)
	ssr := parseSSRJSON(browserHTML)
	boardID, bookmark := findBoardID(ssr), findBookmark(ssr)
	if boardID != "" && bookmark != "" && csrf != "" {
		boardPath, pathErr := url.Parse(boardURL)
		if pathErr == nil {
			path := strings.TrimSuffix(boardPath.Path, "/") + "/"
			for page := 0; page < maxPinterestPages && bookmark != "" && bookmark != "-end-" && len(urls) < maxDiscoveredBoardURLs; page++ {
				feed, feedErr := scraper.fetchPinterestPage(ctx, fetcher, path, boardURL, boardID, bookmark, cookies, csrf, appVersion)
				if feedErr != nil {
					break
				}
				node, decodeErr := decodeOrderedJSON(feed)
				if decodeErr != nil {
					break
				}
				urls = appendUnique(urls, collectPinLinks(node))
				if len(urls) > maxDiscoveredBoardURLs {
					urls = urls[:maxDiscoveredBoardURLs]
				}
				if direct, present := directBookmark(node); present {
					bookmark = direct
				} else {
					bookmark = findBookmark(node)
				}
			}
		}
	}
	totalFound := len(urls)
	limited := urls
	if len(limited) > maxBoardRecipes {
		limited = limited[:maxBoardRecipes]
	}
	recipes := make([]pantry.ScrapedRecipe, 0, len(limited))
	outputBytes := 0
	for start := 0; start < len(limited); start += boardBatchSize {
		end := start + boardBatchSize
		if end > len(limited) {
			end = len(limited)
		}
		batch := limited[start:end]
		results := make([]*pantry.ScrapedRecipe, len(batch))
		var wait sync.WaitGroup
		for index, recipeURL := range batch {
			wait.Add(1)
			go func(index int, recipeURL string) {
				defer wait.Done()
				recipe, recipeErr := scraper.scrapeRecipeURL(ctx, fetcher, recipeURL, "url")
				if recipeErr == nil {
					results[index] = recipe
				}
			}(index, recipeURL)
		}
		wait.Wait()
		if err := fetcher.err(); err != nil {
			return nil, err
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for _, recipe := range results {
			if recipe == nil {
				continue
			}
			size := recipeOutputBytes(*recipe)
			if size > maxBoardOutputBytes-outputBytes {
				return nil, errors.New("scraped board output exceeds safe size")
			}
			outputBytes += size
			recipes = append(recipes, *recipe)
		}
	}
	return &pantry.ScrapedBoard{Recipes: recipes, TotalFound: int32(totalFound)}, nil
}

func (scraper *Scraper) fetchPinterestPage(ctx context.Context, fetcher Fetcher, boardPath, boardURL, boardID, bookmark, cookies, csrf, appVersion string) ([]byte, error) {
	data := map[string]any{"options": map[string]any{
		"add_vase": true, "board_id": boardID, "board_url": boardPath, "field_set_key": "react_grid_pin",
		"filter_section_pins": false, "is_react": true, "page_size": 25, "prepend": false, "bookmarks": []string{bookmark},
	}, "context": map[string]any{}}
	dataJSON, _ := json.Marshal(data)
	body := url.Values{"source_url": []string{boardPath}, "data": []string{string(dataJSON)}}.Encode()
	headers := pinterestHeaders(boardURL, cookies, csrf, appVersion)
	headers.Set("Content-Type", "application/x-www-form-urlencoded")
	headers.Set("Origin", "https://www.pinterest.com")
	endpoint := "https://www.pinterest.com/resource/BoardFeedResource/get/"
	response, err := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodPost, URL: endpoint, Headers: headers, Body: []byte(body)})
	if err != nil {
		return nil, err
	}
	if response.Status >= 200 && response.Status < 300 {
		return response.Body, nil
	}
	query := url.Values{"source_url": []string{boardPath}, "data": []string{string(dataJSON)}, "_": []string{strconv.FormatInt(scraper.now().UnixMilli(), 10)}}
	headers.Del("Content-Type")
	headers.Del("Origin")
	response, err = fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: endpoint + "?" + query.Encode(), Headers: headers})
	if err != nil {
		return nil, err
	}
	if response.Status < 200 || response.Status >= 300 {
		return nil, fmt.Errorf("Pinterest feed returned HTTP %d", response.Status)
	}
	return response.Body, nil
}

func directBookmark(node *jsonNode) (string, bool) {
	resource := node.get("resource_response")
	if value, ok := resource.get("bookmark").text(); ok {
		return value, true
	}
	if value, ok := resource.get("nextBookmark").text(); ok {
		return value, true
	}
	resource = node.get("resource")
	options := resource.get("options")
	bookmarks := options.get("bookmarks")
	if bookmarks != nil && len(bookmarks.array) > 0 {
		if value, ok := bookmarks.array[0].text(); ok {
			return value, true
		}
	}
	return "", false
}

func htmlHeaders(userAgent string) http.Header {
	return http.Header{
		"User-Agent": []string{userAgent}, "Accept": []string{"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
		"Accept-Language": []string{"en-US,en;q=0.9"},
	}
}

func pinterestHeaders(referer, cookies, csrf, appVersion string) http.Header {
	if appVersion == "" {
		appVersion = "0"
	}
	return http.Header{
		"User-Agent": []string{browserUserAgent}, "Accept": []string{"application/json, text/javascript, */*, q=0.01"},
		"X-Requested-With": []string{"XMLHttpRequest"}, "X-CSRFToken": []string{csrf},
		"X-Pinterest-AppState": []string{"active"}, "X-Pinterest-Source": []string{"www"},
		"X-APP-VERSION": []string{appVersion}, "Cookie": []string{cookies}, "Referer": []string{referer},
	}
}

func validateRecipeOutput(recipe pantry.ScrapedRecipe) error {
	if len(recipe.SourceURL) > maxURLBytes || len(recipe.Title) > maxRecipeValueBytes || len(recipe.Instructions) > maxRecipeValues || len(recipe.RawIngredients) > maxRecipeValues || len(recipe.SuggestedTags) > maxRecipeValues {
		return errors.New("scraped recipe output exceeds safe size")
	}
	for _, values := range [][]string{recipe.Instructions, recipe.RawIngredients, recipe.SuggestedTags} {
		for _, value := range values {
			if len(value) > maxRecipeValueBytes {
				return errors.New("scraped recipe value exceeds safe size")
			}
		}
	}
	if recipeOutputBytes(recipe) > maxRecipeOutputBytes {
		return errors.New("scraped recipe output exceeds safe size")
	}
	return nil
}

func recipeOutputBytes(recipe pantry.ScrapedRecipe) int {
	size := len(recipe.Title) + len(recipe.SourceURL) + len(recipe.SourceType)
	for _, value := range []*string{recipe.ImageURL} {
		if value != nil {
			size += len(*value)
		}
	}
	for _, values := range [][]string{recipe.Instructions, recipe.RawIngredients, recipe.SuggestedTags} {
		for _, value := range values {
			size += len(value)
		}
	}
	return size
}
