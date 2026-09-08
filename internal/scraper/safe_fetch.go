package scraper

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxURLBytes            = 2048
	maxResponseBytes       = 2 << 20
	maxRedirects           = 5
	perFetchTimeout        = 8 * time.Second
	globalFetchConcurrency = 8
	perHostConcurrency     = 4
)

type Resolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type FetchRequest struct {
	Method  string
	URL     string
	Headers http.Header
	Body    []byte
}

type FetchResponse struct {
	Status  int
	Headers http.Header
	Body    []byte
}

type Fetcher interface {
	Fetch(context.Context, FetchRequest) (FetchResponse, error)
}

type hostGate struct {
	semaphore  chan struct{}
	references int
}

type SafeFetcher struct {
	resolver    Resolver
	deniedHosts map[string]struct{}
	deniedIPs   map[netip.Addr]struct{}
	client      *http.Client
	dial        func(context.Context, string, string) (net.Conn, error)
	global      chan struct{}
	mu          sync.Mutex
	hosts       map[string]*hostGate
}

func NewSafeFetcher(deniedHosts ...string) (*SafeFetcher, error) {
	return newSafeFetcher(net.DefaultResolver, deniedHosts...)
}

func newSafeFetcher(resolver Resolver, deniedHosts ...string) (*SafeFetcher, error) {
	fetcher := &SafeFetcher{
		resolver: resolver, deniedHosts: make(map[string]struct{}), deniedIPs: make(map[netip.Addr]struct{}),
		global: make(chan struct{}, globalFetchConcurrency), hosts: make(map[string]*hostGate),
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	fetcher.dial = dialer.DialContext
	// Resolve protected services once at construction, independently of the
	// attacker's target hostname. An alternate public hostname must not bypass
	// these destination denials. Failed inventory means startup fails closed.
	protectedHosts := []string{"waltermichelin.com", "pantry.waltermichelin.com", "pantry-staging.waltermichelin.com"}
	protectedHosts = append(protectedHosts, deniedHosts...)
	for _, host := range protectedHosts {
		if parsed, err := url.Parse(host); err == nil && parsed.Hostname() != "" {
			host = parsed.Hostname()
		}
		host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
		if ip, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
			fetcher.deniedIPs[ip.Unmap()] = struct{}{}
			continue
		}
		if host != "" {
			fetcher.deniedHosts[host] = struct{}{}
		}
	}
	resolutionContext, cancel := context.WithTimeout(context.Background(), perFetchTimeout)
	defer cancel()
	for host := range fetcher.deniedHosts {
		addresses, err := resolver.LookupIPAddr(resolutionContext, host)
		if err != nil || len(addresses) == 0 {
			return nil, errors.New("protected scraper destinations could not be resolved")
		}
		for _, address := range addresses {
			ip, ok := netip.AddrFromSlice(address.IP)
			if !ok || address.Zone != "" {
				return nil, errors.New("protected scraper destination returned an invalid address")
			}
			fetcher.deniedIPs[ip.Unmap()] = struct{}{}
		}
	}
	transport := &http.Transport{
		Proxy:                  nil,
		DialContext:            fetcher.dialContext,
		ForceAttemptHTTP2:      true,
		MaxIdleConns:           16,
		MaxIdleConnsPerHost:    perHostConcurrency,
		IdleConnTimeout:        30 * time.Second,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  5 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		ExpectContinueTimeout:  time.Second,
	}
	fetcher.client = &http.Client{
		Transport: transport,
		// Redirects are handled explicitly so every hop shares request accounting,
		// destination permits, URL checks, and a credential-free header policy.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return fetcher, nil
}

func (*SafeFetcher) usesRequestBudget() {}

func (fetcher *SafeFetcher) Fetch(ctx context.Context, request FetchRequest) (FetchResponse, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, perFetchTimeout)
	defer cancel()
	parsed, err := url.Parse(request.URL)
	if err != nil {
		return FetchResponse{}, errors.New("invalid upstream URL")
	}
	if request.Method != http.MethodGet && request.Method != http.MethodPost {
		return FetchResponse{}, errors.New("unsupported upstream method")
	}
	headers := request.Headers.Clone()
	for redirects := 0; ; redirects++ {
		if err := fetcher.validateURL(fetchCtx, parsed); err != nil {
			return FetchResponse{}, err
		}
		response, err := fetcher.fetchHop(fetchCtx, request.Method, parsed, headers, request.Body)
		if err != nil {
			return FetchResponse{}, err
		}
		if !isRedirect(response.Status) || response.Headers.Get("Location") == "" {
			return response, nil
		}
		if redirects >= maxRedirects {
			return FetchResponse{}, errors.New("redirect limit exceeded")
		}
		next, err := parsed.Parse(response.Headers.Get("Location"))
		if err != nil {
			return FetchResponse{}, errors.New("invalid upstream redirect")
		}
		if parsed.Scheme == "https" && next.Scheme != "https" {
			return FetchResponse{}, errors.New("insecure upstream redirect is not allowed")
		}
		if response.Status == http.StatusSeeOther ||
			((response.Status == http.StatusMovedPermanently || response.Status == http.StatusFound) && request.Method == http.MethodPost) {
			request.Method, request.Body = http.MethodGet, nil
		}
		// Deliberately rebuild rather than blacklist: Pinterest session/CSRF
		// material, Authorization, Origin, and Referer never cross a redirect.
		redirectHeaders := make(http.Header)
		for _, key := range []string{"User-Agent", "Accept", "Accept-Language", "Content-Type"} {
			if key == "Content-Type" && request.Method == http.MethodGet {
				continue
			}
			for _, value := range headers.Values(key) {
				redirectHeaders.Add(key, value)
			}
		}
		headers, parsed = redirectHeaders, next
	}
}

func isRedirect(status int) bool {
	return status == http.StatusMovedPermanently || status == http.StatusFound || status == http.StatusSeeOther || status == http.StatusTemporaryRedirect || status == http.StatusPermanentRedirect
}

func (fetcher *SafeFetcher) fetchHop(ctx context.Context, method string, parsed *url.URL, headers http.Header, body []byte) (FetchResponse, error) {
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if err := fetcher.acquire(ctx, host); err != nil {
		return FetchResponse{}, err
	}
	defer fetcher.release(host)
	if err := budgetBeforeRequest(ctx); err != nil {
		return FetchResponse{}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, method, parsed.String(), bytes.NewReader(body))
	if err != nil {
		return FetchResponse{}, errors.New("invalid upstream request")
	}
	httpRequest.Header = headers.Clone()
	response, err := fetcher.client.Do(httpRequest)
	if err != nil {
		return FetchResponse{}, safeUpstreamError(ctx, "upstream request failed", err)
	}
	defer response.Body.Close()
	if isRedirect(response.StatusCode) && response.Header.Get("Location") != "" {
		// Do not drain attacker-controlled redirect bodies. Closing releases the
		// destination permit before acquiring the next hop's permit.
		return FetchResponse{Status: response.StatusCode, Headers: response.Header.Clone()}, nil
	}
	responseBody, err := io.ReadAll(io.LimitReader(budgetResponseReader(ctx, response.Body), maxResponseBytes+1))
	if err != nil {
		return FetchResponse{}, safeUpstreamError(ctx, "read upstream response failed", err)
	}
	if len(responseBody) > maxResponseBytes {
		return FetchResponse{}, errors.New("upstream response exceeds safe size")
	}
	return FetchResponse{Status: response.StatusCode, Headers: response.Header.Clone(), Body: responseBody}, nil
}

// Transport errors (especially url.Error) embed raw URLs and query strings.
// Preserve cancellation/deadline identity without retaining upstream content.
func safeUpstreamError(ctx context.Context, message string, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	return errors.New(message)
}

func (fetcher *SafeFetcher) validateURL(ctx context.Context, parsed *url.URL) error {
	if parsed == nil || len(parsed.String()) > maxURLBytes || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return errors.New("only credential-free HTTP and HTTPS recipe URLs are allowed")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "" || strings.HasSuffix(host, ".localhost") || host == "localhost" {
		return errors.New("local and internal recipe URLs are not allowed")
	}
	if fetcher.deniedHost(host) {
		return errors.New("Pantry service destinations are not allowed")
	}
	port := parsed.Port()
	if port != "" && !((parsed.Scheme == "http" && port == "80") || (parsed.Scheme == "https" && port == "443")) {
		return errors.New("only standard web ports are allowed")
	}
	addresses, err := fetcher.resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return safeUpstreamError(ctx, "recipe site could not be resolved safely", err)
	}
	for _, address := range addresses {
		ip, ok := netip.AddrFromSlice(address.IP)
		if !ok || address.Zone != "" || !fetcher.allowedAddress(ip.Unmap()) {
			return errors.New("local, private, or reserved recipe destinations are not allowed")
		}
	}
	return nil
}

func (fetcher *SafeFetcher) allowedAddress(ip netip.Addr) bool {
	_, denied := fetcher.deniedIPs[ip.Unmap()]
	return !denied && publicAddress(ip.Unmap())
}

func (fetcher *SafeFetcher) deniedHost(host string) bool {
	if host == "pantry-staging.waltermichelin.com" || host == "waltermichelin.com" || strings.HasSuffix(host, ".waltermichelin.com") {
		return true
	}
	for denied := range fetcher.deniedHosts {
		if host == denied || strings.HasSuffix(host, "."+denied) {
			return true
		}
	}
	return false
}

func publicAddress(address netip.Addr) bool {
	if !address.IsValid() || address.IsUnspecified() || address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsMulticast() {
		return false
	}
	blocked := []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/4"),
		netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001:db8::/32"),
		netip.MustParsePrefix("fec0::/10"), netip.MustParsePrefix("::/96"),
		// Translation/tunneling ranges can embed otherwise-blocked IPv4 targets.
		netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"),
		netip.MustParsePrefix("100::/64"), netip.MustParsePrefix("2001::/23"),
		netip.MustParsePrefix("2002::/16"),
	}
	for _, prefix := range blocked {
		if prefix.Contains(address) {
			return false
		}
	}
	return address.IsGlobalUnicast()
}

func (fetcher *SafeFetcher) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.New("invalid upstream network address")
	}
	parsed := &url.URL{Scheme: "https", Host: net.JoinHostPort(host, port)}
	if port == "80" {
		parsed.Scheme = "http"
	}
	if err := fetcher.validateURL(ctx, parsed); err != nil {
		return nil, err
	}
	addresses, err := fetcher.resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil, safeUpstreamError(ctx, "recipe site could not be resolved safely", err)
	}
	for _, address := range addresses {
		ip, ok := netip.AddrFromSlice(address.IP)
		if !ok || address.Zone != "" || !fetcher.allowedAddress(ip.Unmap()) {
			return nil, errors.New("recipe destination changed to an unsafe address")
		}
	}
	ip, _ := netip.AddrFromSlice(addresses[0].IP)
	connection, err := fetcher.dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
	if err != nil {
		return nil, safeUpstreamError(ctx, "upstream connection failed", err)
	}
	return connection, nil
}

func (fetcher *SafeFetcher) acquire(ctx context.Context, host string) error {
	select {
	case fetcher.global <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	fetcher.mu.Lock()
	gate := fetcher.hosts[host]
	if gate == nil {
		gate = &hostGate{semaphore: make(chan struct{}, perHostConcurrency)}
		fetcher.hosts[host] = gate
	}
	gate.references++
	fetcher.mu.Unlock()
	select {
	case gate.semaphore <- struct{}{}:
		return nil
	case <-ctx.Done():
		<-fetcher.global
		fetcher.releaseReference(host, gate)
		return ctx.Err()
	}
}

func (fetcher *SafeFetcher) release(host string) {
	fetcher.mu.Lock()
	gate := fetcher.hosts[host]
	fetcher.mu.Unlock()
	if gate != nil {
		<-gate.semaphore
		fetcher.releaseReference(host, gate)
	}
	<-fetcher.global
}

func (fetcher *SafeFetcher) releaseReference(host string, gate *hostGate) {
	fetcher.mu.Lock()
	defer fetcher.mu.Unlock()
	gate.references--
	if gate.references == 0 {
		delete(fetcher.hosts, host)
	}
}

func standardPort(parsed *url.URL) string {
	if parsed.Port() != "" {
		return parsed.Port()
	}
	if parsed.Scheme == "https" {
		return "443"
	}
	return strconv.Itoa(80)
}
