package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config contains only process configuration. Database credentials are
// intentionally absent until the staging RLS feasibility spike proves the
// least-privilege transaction model.
type Config struct {
	ListenAddr  string
	SupabaseURL string
	JWTAudience string
}

func Load() (Config, error) {
	cfg := Config{
		ListenAddr:  valueOrDefault("PANTRY_API_LISTEN_ADDR", ":8080"),
		SupabaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("PANTRY_API_SUPABASE_URL")), "/"),
		JWTAudience: valueOrDefault("PANTRY_API_JWT_AUDIENCE", "authenticated"),
	}

	if cfg.SupabaseURL == "" {
		return Config{}, fmt.Errorf("PANTRY_API_SUPABASE_URL is required")
	}
	parsedURL, err := url.Parse(cfg.SupabaseURL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.Path != "" {
		return Config{}, fmt.Errorf("PANTRY_API_SUPABASE_URL must be an HTTPS origin")
	}
	if strings.TrimSpace(cfg.JWTAudience) == "" {
		return Config{}, fmt.Errorf("PANTRY_API_JWT_AUDIENCE must not be empty")
	}
	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
