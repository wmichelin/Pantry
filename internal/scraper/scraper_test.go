package scraper

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/pantry"
)

type fetcherFunc func(context.Context, FetchRequest) (FetchResponse, error)

func (function fetcherFunc) Fetch(ctx context.Context, request FetchRequest) (FetchResponse, error) {
	return function(ctx, request)
}

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (function resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return function(ctx, host)
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (function roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestScrapeWebsitePinAndBoard(t *testing.T) {
	var mu sync.Mutex
	boardFetches := 0
	requests := []FetchRequest{}
	response := func(status int, body string) (FetchResponse, error) {
		return FetchResponse{Status: status, Headers: http.Header{}, Body: []byte(body)}, nil
	}
	fixture := fetcherFunc(func(_ context.Context, request FetchRequest) (FetchResponse, error) {
		mu.Lock()
		requests = append(requests, request)
		mu.Unlock()
		switch request.URL {
		case "https://recipes.example/single":
			return response(200, jsonLD("Single", "salt"))
		case "https://pin.it/abc":
			return response(200, `<script id="__PWS_INITIAL_PROPS__">{"pin":{"link":"https://recipes.example/pin-source"}}</script>`)
		case "https://recipes.example/pin-source":
			return response(200, jsonLD("Pin source", "pepper"))
		case "https://www.pinterest.com/user/board/":
			mu.Lock()
			boardFetches++
			call := boardFetches
			mu.Unlock()
			if call == 1 {
				return response(200, `<a href="https://recipes.example/a">A</a><a href="https://recipes.example/b">B</a>`)
			}
			headers := http.Header{"Set-Cookie": []string{"csrftoken=csrf-value; Secure", "session=pin-cookie; Secure"}}
			body := `<script id="__PWS_INITIAL_PROPS__">{"board":{"id":"board-id","name":"Board","url":"/user/board/","type":"board"},"bookmark":"bookmark-1","pins":[{"link":"https://recipes.example/b"},{"link":"https://recipes.example/c"}]}</script>`
			return FetchResponse{Status: 200, Headers: headers, Body: []byte(body)}, nil
		case "https://www.pinterest.com/resource/BoardFeedResource/get/":
			if request.Method != http.MethodPost || !strings.Contains(string(request.Body), "bookmark-1") || request.Headers.Get("Cookie") != "csrftoken=csrf-value; session=pin-cookie" {
				t.Fatalf("unexpected Pinterest POST: %#v", request)
			}
			return response(503, "retry")
		case "https://recipes.example/a":
			return response(200, jsonLD("A", "a ingredient"))
		case "https://recipes.example/b":
			return response(500, "failed")
		case "https://recipes.example/c":
			return response(200, jsonLD("C", "c ingredient"))
		case "https://recipes.example/d":
			return response(200, jsonLD("D", "d ingredient"))
		default:
			if strings.HasPrefix(request.URL, "https://www.pinterest.com/resource/BoardFeedResource/get/?") {
				return response(200, `{"resource_response":{"bookmark":"-end-","data":[{"link":"https://recipes.example/d"}]}}`)
			}
			return FetchResponse{}, errors.New("unexpected URL: " + request.URL)
		}
	})
	scraper := NewWithFetcher(fixture)
	single, err := scraper.Scrape(context.Background(), "single-user", "h", "https://recipes.example/single")
	if err != nil || single.Recipe == nil || single.Recipe.Title != "Single" || single.Recipe.SourceType != "url" {
		t.Fatalf("single result = %#v, %v", single, err)
	}
	pin, err := scraper.Scrape(context.Background(), "pin-user", "h", "https://pin.it/abc")
	if err != nil || pin.Recipe == nil || pin.Recipe.Title != "Pin source" || pin.Recipe.SourceType != "pinterest_pin" || pin.Recipe.SourceURL != "https://recipes.example/pin-source" {
		t.Fatalf("pin result = %#v, %v", pin, err)
	}
	board, err := scraper.Scrape(context.Background(), "board-user", "h", "https://www.pinterest.com/user/board/")
	if err != nil {
		t.Fatal(err)
	}
	titles := make([]string, len(board.Board.Recipes))
	for index, recipe := range board.Board.Recipes {
		titles[index] = recipe.Title
	}
	if diff := cmp.Diff([]string{"A", "C", "D"}, titles); diff != "" || board.Board.TotalFound != 4 {
		t.Fatalf("board mismatch (-want +got): %s, total=%d", diff, board.Board.TotalFound)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 11 {
		t.Fatalf("request count = %d, want 11", len(requests))
	}
}

func TestScrapeLimiterBusyAndRate(t *testing.T) {
	limiter := newScrapeLimiter()
	now := time.Unix(100, 0)
	limiter.now = func() time.Time { return now }
	finish, err := limiter.begin("user\x00household")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := limiter.begin("user\x00household"); !errors.Is(err, pantry.ErrScrapeBusy) {
		t.Fatalf("concurrent begin error = %v", err)
	}
	finish()
	for attempt := 1; attempt < 6; attempt++ {
		finish, err = limiter.begin("user\x00household")
		if err != nil {
			t.Fatalf("begin %d: %v", attempt, err)
		}
		finish()
	}
	if _, err := limiter.begin("user\x00household"); !errors.Is(err, pantry.ErrScrapeRateLimited) {
		t.Fatalf("rate error = %v", err)
	}
	now = now.Add(time.Minute + time.Nanosecond)
	finish, err = limiter.begin("user\x00household")
	if err != nil {
		t.Fatalf("rate window did not expire: %v", err)
	}
	finish()
}

func TestScrapeLimiterIsPerVerifiedSubjectAcrossHouseholds(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	fixture := fetcherFunc(func(ctx context.Context, _ FetchRequest) (FetchResponse, error) {
		once.Do(func() { close(started) })
		select {
		case <-release:
			return FetchResponse{Status: 200, Body: []byte(jsonLD("Recipe", "salt"))}, nil
		case <-ctx.Done():
			return FetchResponse{}, ctx.Err()
		}
	})
	scraper := NewWithFetcher(fixture)
	done := make(chan error, 1)
	go func() {
		_, err := scraper.Scrape(context.Background(), "same-user", "household-a", "https://recipe.example/a")
		done <- err
	}()
	<-started
	if _, err := scraper.Scrape(context.Background(), "same-user", "household-b", "https://recipe.example/b"); !errors.Is(err, pantry.ErrScrapeBusy) {
		t.Fatalf("second household bypassed per-account concurrency limit: %v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("first scrape failed: %v", err)
	}
}

func TestScrapeGlobalSlotsFailClosedWithoutStartingFetch(t *testing.T) {
	called := false
	scraper := NewWithFetcher(fetcherFunc(func(context.Context, FetchRequest) (FetchResponse, error) {
		called = true
		return FetchResponse{}, nil
	}))
	for index := 0; index < cap(scraper.slots); index++ {
		scraper.slots <- struct{}{}
	}
	defer func() {
		for index := 0; index < cap(scraper.slots); index++ {
			<-scraper.slots
		}
	}()
	if _, err := scraper.Scrape(context.Background(), "user", "household", "https://recipe.example/"); !errors.Is(err, pantry.ErrScrapeBusy) {
		t.Fatalf("full global capacity error = %v", err)
	}
	if called {
		t.Fatal("fetch began while global scrape capacity was full")
	}
}

func TestBudgetFetcherLatchesFakeFetcherLimits(t *testing.T) {
	for _, test := range []struct {
		name      string
		configure func(*budgetFetcher)
	}{
		{name: "request count", configure: func(budget *budgetFetcher) { budget.attempts = maxOutboundRequests }},
		{name: "response bytes", configure: func(budget *budgetFetcher) { budget.bytes = maxCumulativeBytes }},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			ctx, cancel := context.WithCancel(context.Background())
			budget := newBudgetFetcher(fetcherFunc(func(context.Context, FetchRequest) (FetchResponse, error) {
				calls++
				return FetchResponse{Status: 200, Body: []byte("x")}, nil
			}), cancel)
			test.configure(budget)
			for attempt := 0; attempt < 2; attempt++ {
				if _, err := budget.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: "https://recipe.example/"}); !errors.Is(err, errScrapeBudget) {
					t.Fatalf("attempt %d error = %v", attempt, err)
				}
			}
			if ctx.Err() == nil || calls > 1 {
				t.Fatalf("budget did not latch: canceled=%v calls=%d", ctx.Err(), calls)
			}
		})
	}
}

func TestDirectBookmarkPreservesPresentEmptyValue(t *testing.T) {
	node, err := decodeOrderedJSON([]byte(`{"resource_response":{"bookmark":"","data":{"bookmark":"fallback"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	bookmark, present := directBookmark(node)
	if !present || bookmark != "" {
		t.Fatalf("present empty bookmark = %q, %t", bookmark, present)
	}
}

func TestSafeURLPolicyAndDialTimeRevalidation(t *testing.T) {
	public := []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}
	fetcher := safeTestFetcher("project.supabase.co")
	fetcher.resolver = resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host == "mixed.example" {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}, {IP: net.ParseIP("127.0.0.1")}}, nil
		}
		return public, nil
	})
	allowed, _ := url.Parse("https://recipes.example/path")
	if err := fetcher.validateURL(context.Background(), allowed); err != nil {
		t.Fatalf("public URL rejected: %v", err)
	}
	blocked := []string{
		"file:///etc/passwd", "http://user:pass@recipes.example/", "https://recipes.example:444/",
		"https://localhost/", "https://project.supabase.co/", "https://pantry-staging.waltermichelin.com/", "https://mixed.example/",
	}
	for _, raw := range blocked {
		parsed, _ := url.Parse(raw)
		if err := fetcher.validateURL(context.Background(), parsed); err == nil {
			t.Errorf("unsafe URL accepted: %s", raw)
		}
	}
	resolutions := 0
	fetcher.resolver = resolverFunc(func(_ context.Context, _ string) ([]net.IPAddr, error) {
		resolutions++
		if resolutions == 1 {
			return public, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("::ffff:127.0.0.1")}}, nil
	})
	fetcher.dial = func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("unsafe rebound address reached network dial")
		return nil, nil
	}
	if _, err := fetcher.dialContext(context.Background(), "tcp", "rebind.example:443"); err == nil {
		t.Fatal("DNS rebinding was accepted")
	}
	transport := fetcher.client.Transport.(*http.Transport)
	if transport.Proxy != nil {
		t.Fatal("environment proxy inheritance is enabled")
	}
}

func TestSafeFetcherRejectsDecodedOversizeBody(t *testing.T) {
	fetcher := safeTestFetcher()
	fetcher.resolver = resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
	fetcher.client = &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", maxResponseBytes+1)))}, nil
	})}
	_, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "https://recipes.example/"})
	if err == nil || !strings.Contains(err.Error(), "safe size") {
		t.Fatalf("oversize error = %v", err)
	}
}

func jsonLD(title, ingredient string) string {
	return `<script type="application/ld+json">{"@type":"Recipe","name":"` + title + `","recipeIngredient":["` + ingredient + `"],"recipeInstructions":["Cook."]}</script>`
}
