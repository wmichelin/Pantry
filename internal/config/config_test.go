package config

import "testing"

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{name: "valid HTTPS origin", url: "https://example.supabase.co"},
		{name: "missing URL", wantErr: true},
		{name: "rejects HTTP", url: "http://example.supabase.co", wantErr: true},
		{name: "rejects path", url: "https://example.supabase.co/path", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PANTRY_API_SUPABASE_URL", tt.url)
			t.Setenv("PANTRY_API_JWT_AUDIENCE", "authenticated")
			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
