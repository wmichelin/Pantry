package scraper

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func safeTestFetcher(deniedHosts ...string) *SafeFetcher {
	fetcher, err := newSafeFetcher(resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if ip := net.ParseIP(host); ip != nil {
			return []net.IPAddr{{IP: ip}}, nil
		}
		if host == "waltermichelin.com" || strings.HasSuffix(host, ".waltermichelin.com") || strings.HasSuffix(host, ".supabase.co") || host == "protected.example" {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.100")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	}), deniedHosts...)
	if err != nil {
		panic(err)
	}
	return fetcher
}

func TestSafeFetcherResolvesProtectedHostsAndFailsClosed(t *testing.T) {
	fetcher := safeTestFetcher("https://protected.example")
	fetcher.resolver = resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.100")}}, nil
	})
	fetcher.dial = func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("alias for a protected service reached dial")
		return nil, nil
	}
	if _, err := fetcher.dialContext(context.Background(), "tcp", "unrelated-alias.example:443"); err == nil {
		t.Fatal("protected host IP inventory was not applied to alias")
	}
	_, err := newSafeFetcher(resolverFunc(func(ctx context.Context, _ string) ([]net.IPAddr, error) {
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > perFetchTimeout {
			t.Error("protected inventory has no bounded deadline")
		}
		return nil, errors.New("DNS error containing secret-hostname")
	}), "protected.example")
	if err == nil || strings.Contains(err.Error(), "secret-hostname") {
		t.Fatalf("startup must fail with sanitized error: %v", err)
	}
}

type unreadRedirectBody struct{ closed bool }

func (*unreadRedirectBody) Read([]byte) (int, error) { panic("redirect body must not be drained") }
func (body *unreadRedirectBody) Close() error        { body.closed = true; return nil }

func TestSafeFetcherManualRedirectMethodsAndCredentialStripping(t *testing.T) {
	for _, status := range []int{301, 302, 303, 307, 308} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			fetcher := safeTestFetcher()
			redirectBody := &unreadRedirectBody{}
			calls := 0
			fetcher.client.Transport = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				if calls == 1 {
					if request.Header.Get("Cookie") != "session=private" || request.Method != http.MethodPost {
						t.Fatal("initial Pinterest request changed")
					}
					return &http.Response{StatusCode: status, Header: http.Header{"Location": []string{"https://second.example/recipe"}}, Body: redirectBody}, nil
				}
				if !redirectBody.closed {
					t.Fatal("previous hop body was not closed before redirect")
				}
				for _, header := range []string{"Cookie", "Authorization", "X-CSRFToken", "Origin", "Referer", "X-Private"} {
					if request.Header.Get(header) != "" {
						t.Errorf("redirect leaked %s", header)
					}
				}
				if request.Header.Get("User-Agent") != "Pantry test" {
					t.Error("safe redirect header lost")
				}
				body, _ := io.ReadAll(request.Body)
				if status == 307 || status == 308 {
					if request.Method != http.MethodPost || string(body) != "board=example" || request.Header.Get("Content-Type") == "" {
						t.Error("preserving redirect lost POST payload")
					}
				} else if request.Method != http.MethodGet || len(body) != 0 || request.Header.Get("Content-Type") != "" {
					t.Error("GET redirect retained POST payload")
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("recipe"))}, nil
			})
			response, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodPost, URL: "https://first.example/feed", Body: []byte("board=example"), Headers: http.Header{
				"Cookie": []string{"session=private"}, "Authorization": []string{"Bearer private"}, "X-Csrftoken": []string{"private"},
				"Origin": []string{"https://first.example"}, "Referer": []string{"https://first.example/?secret=private"},
				"X-Private": []string{"private"}, "User-Agent": []string{"Pantry test"}, "Content-Type": []string{"application/x-www-form-urlencoded"},
			}})
			if err != nil || response.Status != 200 || calls != 2 {
				t.Fatalf("response=%+v calls=%d error=%v", response, calls, err)
			}
		})
	}
}

func TestSafeFetcherRedirectPolicyAndLimit(t *testing.T) {
	for _, target := range []string{"http://first.example/", "https://127.0.0.1/", "https://169.254.169.254/", "https://user:password@second.example/", "https://second.example:8443/", "file:///etc/passwd"} {
		t.Run(target, func(t *testing.T) {
			fetcher := safeTestFetcher()
			calls := 0
			fetcher.client.Transport = roundTripperFunc(func(*http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{target}}, Body: io.NopCloser(strings.NewReader(""))}, nil
			})
			_, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "https://first.example/"})
			if err == nil || calls != 1 {
				t.Fatalf("unsafe redirect made %d calls, error=%v", calls, err)
			}
		})
	}
	fetcher := safeTestFetcher()
	calls := 0
	fetcher.client.Transport = roundTripperFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"/again"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	_, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "https://first.example/"})
	if err == nil || calls != maxRedirects+1 {
		t.Fatalf("redirect loop calls=%d error=%v", calls, err)
	}
}

func TestSafeFetcherAccountsEachHopAndCancelsReadBudget(t *testing.T) {
	t.Run("redirect request budget", func(t *testing.T) {
		fetcher := safeTestFetcher()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		budget := newBudgetFetcher(fetcher, cancel)
		budget.attempts = maxOutboundRequests - 1
		calls := 0
		fetcher.client.Transport = roundTripperFunc(func(*http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://next.example/"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		})
		_, err := budget.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: "https://first.example/"})
		if !errors.Is(err, errScrapeBudget) || calls != 1 || ctx.Err() == nil {
			t.Fatalf("redirect escaped budget: calls=%d error=%v canceled=%v", calls, err, ctx.Err())
		}
	})
	t.Run("read budget latches", func(t *testing.T) {
		fetcher := safeTestFetcher()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		budget := newBudgetFetcher(fetcher, cancel)
		budget.bytes = maxCumulativeBytes - 5
		calls := 0
		fetcher.client.Transport = roundTripperFunc(func(*http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("123456"))}, nil
		})
		for i := 0; i < 2; i++ {
			_, err := budget.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: "https://first.example/"})
			if !errors.Is(err, errScrapeBudget) {
				t.Fatalf("read budget error=%v", err)
			}
		}
		if calls != 1 || ctx.Err() == nil {
			t.Fatalf("exhausted budget continued fetching: calls=%d canceled=%v", calls, ctx.Err())
		}
	})
}

func TestSafeFetcherDeniedAddressAliasesAndRebinding(t *testing.T) {
	for _, denied := range []string{"93.184.216.34", "::ffff:93.184.216.34", "2606:4700:4700::1111"} {
		t.Run(denied, func(t *testing.T) {
			fetcher := safeTestFetcher(denied)
			fetcher.resolver = resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
				return []net.IPAddr{{IP: net.ParseIP(denied)}}, nil
			})
			fetcher.dial = func(context.Context, string, string) (net.Conn, error) {
				t.Fatal("denied alias reached socket dial")
				return nil, nil
			}
			if _, err := fetcher.dialContext(context.Background(), "tcp", "alternate.example:443"); err == nil {
				t.Fatal("denied alias accepted")
			}
		})
	}
	for _, final := range [][]net.IPAddr{
		{{IP: net.ParseIP("93.184.216.35")}},
		{{IP: net.ParseIP("93.184.216.34")}, {IP: net.ParseIP("127.0.0.1")}},
	} {
		fetcher := safeTestFetcher("93.184.216.35")
		calls := 0
		fetcher.resolver = resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
			calls++
			if calls == 1 {
				return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
			}
			return final, nil
		})
		fetcher.dial = func(context.Context, string, string) (net.Conn, error) {
			t.Fatal("rebound address reached socket dial")
			return nil, nil
		}
		if _, err := fetcher.dialContext(context.Background(), "tcp", "rebind.example:443"); err == nil {
			t.Fatal("unsafe final resolution accepted")
		}
	}
	for _, raw := range []string{"64:ff9b::7f00:1", "64:ff9b:1::a00:1", "2002:7f00:1::", "2001::1", "100::1", "::2"} {
		if publicAddress(netip.MustParseAddr(raw)) {
			t.Errorf("translation/reserved address accepted: %s", raw)
		}
	}
}

func TestSafeFetcherPinsDialAndPreservesHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Host != "recipe.example" {
			t.Errorf("upstream Host=%q", request.Host)
		}
		_, _ = io.WriteString(writer, "recipe")
	}))
	defer server.Close()
	fetcher := safeTestFetcher()
	defer fetcher.client.CloseIdleConnections()
	fetcher.dial = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "93.184.216.34:80" {
			t.Errorf("dial was not pinned to validated IP: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	result, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "http://recipe.example/"})
	if err != nil || string(result.Body) != "recipe" {
		t.Fatalf("result=%+v error=%v", result, err)
	}
}

func TestSafeFetcherTimeoutCoversDNSAndPermit(t *testing.T) {
	t.Run("DNS", func(t *testing.T) {
		fetcher := safeTestFetcher()
		fetcher.resolver = resolverFunc(func(ctx context.Context, _ string) ([]net.IPAddr, error) {
			deadline, exists := ctx.Deadline()
			if !exists || time.Until(deadline) > perFetchTimeout {
				t.Error("DNS lacks the per-fetch timeout")
			}
			return nil, context.DeadlineExceeded
		})
		_, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "https://recipe.example/"})
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("DNS timeout identity lost: %v", err)
		}
	})
	t.Run("permit", func(t *testing.T) {
		fetcher := safeTestFetcher()
		for i := 0; i < cap(fetcher.global); i++ {
			fetcher.global <- struct{}{}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()
		_, err := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: "https://recipe.example/"})
		if !errors.Is(err, context.DeadlineExceeded) || len(fetcher.global) != cap(fetcher.global) || len(fetcher.hosts) != 0 {
			t.Fatalf("permit timeout leaked state: error=%v global=%d hosts=%d", err, len(fetcher.global), len(fetcher.hosts))
		}
	})
}

func TestSafeFetcherSanitizesTransportErrors(t *testing.T) {
	fetcher := safeTestFetcher()
	fetcher.client.Transport = roundTripperFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("response contains token-secret") })
	_, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "https://recipe.example/?oauth=token-secret"})
	if err == nil || strings.Contains(err.Error(), "token-secret") || strings.Contains(err.Error(), "recipe.example") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestSafeFetcherRedirectDestinationConcurrency(t *testing.T) {
	fetcher := safeTestFetcher()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var active, maximum atomic.Int32
	entered := make(chan struct{}, 8)
	release := make(chan struct{})
	fetcher.client.Transport = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Hostname() != "shared.example" {
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://shared.example/recipe"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		current := active.Add(1)
		defer active.Add(-1)
		for previous := maximum.Load(); current > previous && !maximum.CompareAndSwap(previous, current); previous = maximum.Load() {
		}
		entered <- struct{}{}
		select {
		case <-release:
		case <-request.Context().Done():
			return nil, request.Context().Err()
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("recipe"))}, nil
	})
	var wait sync.WaitGroup
	for i := 0; i < 8; i++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			_, err := fetcher.Fetch(ctx, FetchRequest{Method: http.MethodGet, URL: fmt.Sprintf("https://origin-%d.example/", index)})
			if err != nil {
				t.Errorf("concurrent fetch: %v", err)
			}
		}(i)
	}
	for i := 0; i < perHostConcurrency; i++ {
		select {
		case <-entered:
		case <-ctx.Done():
			close(release)
			wait.Wait()
			t.Fatal("destination permits deadlocked")
		}
	}
	select {
	case <-entered:
		close(release)
		wait.Wait()
		t.Fatal("redirect bypassed the destination concurrency limit")
	case <-time.After(25 * time.Millisecond):
	}
	close(release)
	wait.Wait()
	if maximum.Load() > perHostConcurrency || len(fetcher.global) != 0 || len(fetcher.hosts) != 0 {
		t.Fatalf("destination concurrency=%d global=%d hosts=%d", maximum.Load(), len(fetcher.global), len(fetcher.hosts))
	}
}

func TestSafeFetcherBoundsActualGzipDecompression(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Encoding", "gzip")
		compressed := gzip.NewWriter(writer)
		_, _ = io.WriteString(compressed, strings.Repeat("x", maxResponseBytes+1))
		_ = compressed.Close()
	}))
	defer server.Close()
	fetcher := safeTestFetcher()
	defer fetcher.client.CloseIdleConnections()
	fetcher.dial = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	_, err := fetcher.Fetch(context.Background(), FetchRequest{Method: http.MethodGet, URL: "http://recipe.example/"})
	if err == nil || !strings.Contains(err.Error(), "safe size") {
		t.Fatalf("gzip expansion accepted: %v", err)
	}
}
