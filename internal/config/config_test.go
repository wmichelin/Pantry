package config

import (
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		anonKey string
		wantErr bool
	}{
		{name: "valid HTTPS origin", url: "https://example.supabase.co", anonKey: "publishable-key"},
		{name: "missing URL", anonKey: "publishable-key", wantErr: true},
		{name: "missing anon key", url: "https://example.supabase.co", wantErr: true},
		{name: "rejects HTTP", url: "http://example.supabase.co", anonKey: "publishable-key", wantErr: true},
		{name: "rejects path", url: "https://example.supabase.co/path", anonKey: "publishable-key", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PANTRY_API_SUPABASE_URL", tt.url)
			t.Setenv("PANTRY_API_SUPABASE_ANON_KEY", tt.anonKey)
			t.Setenv("PANTRY_API_JWT_AUDIENCE", "authenticated")
			t.Setenv("PANTRY_API_DENY_DESTINATIONS", "192.0.2.1")
			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoadDenyDestinations(t *testing.T) {
	t.Setenv("PANTRY_API_SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("PANTRY_API_SUPABASE_ANON_KEY", "publishable-key")
	t.Setenv("PANTRY_API_DENY_DESTINATIONS", " 192.0.2.1, HOST.Example., https://EXAMPLE.supabase.co/,::ffff:192.0.2.1,2001:db8::1 ")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"192.0.2.1", "host.example", "example.supabase.co", "2001:db8::1", "waltermichelin.com", "pantry.waltermichelin.com", "pantry-staging.waltermichelin.com"}
	if diff := cmp.Diff(want, cfg.DenyDestinations); diff != "" {
		t.Fatalf("deny destinations mismatch (-want +got):\n%s", diff)
	}
}

func TestLoadRejectsMissingOrUnsafeDenyConfigurationWithoutEchoingIt(t *testing.T) {
	t.Setenv("PANTRY_API_SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("PANTRY_API_SUPABASE_ANON_KEY", "publishable-key")
	for _, raw := range []string{"", " ", "host.example,", "https://private-token@host.example", "https://host.example/path", "host.example:443", "https://host.example?private-token", "host.example\nprivate-token", "-invalid.example", "fe80::1%eth0"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("PANTRY_API_DENY_DESTINATIONS", raw)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "PANTRY_API_DENY_DESTINATIONS") || strings.Contains(err.Error(), "private-token") {
				t.Fatalf("expected sanitized deny configuration error, got %v", err)
			}
		})
	}
}
