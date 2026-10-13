package config

import (
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

// Config contains only process configuration. Database credentials are
// intentionally absent until the staging RLS feasibility spike proves the
// least-privilege transaction model.
type Config struct {
	ListenAddr       string
	SupabaseURL      string
	SupabaseAnonKey  string
	JWTAudience      string
	DenyDestinations []string
}

func Load() (Config, error) {
	cfg := Config{
		ListenAddr:      valueOrDefault("PANTRY_API_LISTEN_ADDR", ":8080"),
		SupabaseURL:     strings.TrimRight(strings.TrimSpace(os.Getenv("PANTRY_API_SUPABASE_URL")), "/"),
		SupabaseAnonKey: strings.TrimSpace(os.Getenv("PANTRY_API_SUPABASE_ANON_KEY")),
		JWTAudience:     valueOrDefault("PANTRY_API_JWT_AUDIENCE", "authenticated"),
	}

	if cfg.SupabaseURL == "" {
		return Config{}, fmt.Errorf("PANTRY_API_SUPABASE_URL is required")
	}
	if cfg.SupabaseAnonKey == "" {
		return Config{}, fmt.Errorf("PANTRY_API_SUPABASE_ANON_KEY is required")
	}
	parsedURL, err := url.Parse(cfg.SupabaseURL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.Path != "" {
		return Config{}, fmt.Errorf("PANTRY_API_SUPABASE_URL must be an HTTPS origin")
	}
	if strings.TrimSpace(cfg.JWTAudience) == "" {
		return Config{}, fmt.Errorf("PANTRY_API_JWT_AUDIENCE must not be empty")
	}
	denyRaw := strings.TrimSpace(os.Getenv("PANTRY_API_DENY_DESTINATIONS"))
	if denyRaw == "" {
		return Config{}, fmt.Errorf("PANTRY_API_DENY_DESTINATIONS is required for shared-host scrape isolation")
	}
	seen := make(map[string]bool)
	for _, destination := range append(strings.Split(denyRaw, ","), parsedURL.Hostname(), "waltermichelin.com", "pantry.waltermichelin.com", "pantry-staging.waltermichelin.com") {
		host, err := denyDestination(destination)
		if err != nil {
			// Configuration values may contain credentials or internal addresses.
			return Config{}, fmt.Errorf("PANTRY_API_DENY_DESTINATIONS must contain comma-separated hostnames, IP addresses, or HTTP(S) origins")
		}
		if !seen[host] {
			seen[host] = true
			cfg.DenyDestinations = append(cfg.DenyDestinations, host)
		}
	}
	return cfg, nil
}

func denyDestination(raw string) (string, error) {
	host := strings.TrimSpace(raw)
	if strings.Contains(host, "://") {
		parsed, err := url.Parse(host)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.Hostname() == "" || parsed.Port() != "" || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return "", fmt.Errorf("invalid destination")
		}
		host = parsed.Hostname()
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if address, err := netip.ParseAddr(host); err == nil && address.Zone() == "" {
		return address.Unmap().String(), nil
	}
	if host == "" || len(host) > 253 {
		return "", fmt.Errorf("invalid destination")
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", fmt.Errorf("invalid destination")
		}
		for _, character := range label {
			if !((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '-') {
				return "", fmt.Errorf("invalid destination")
			}
		}
	}
	return host, nil
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
