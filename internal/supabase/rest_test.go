package supabase

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRESTClientListHouseholdsForwardsOnlyCallerIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/rest/v1/households" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("apikey") != "publishable-key" {
			t.Fatalf("apikey = %q", request.Header.Get("apikey"))
		}
		if request.Header.Get("Authorization") != "Bearer user-access-token" {
			t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
		}
		if request.URL.Query().Get("select") != "id,name,invite_code,created_by,created_at" {
			t.Fatalf("select = %q", request.URL.Query().Get("select"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`[{"id":"household-1","name":"Pantry","invite_code":"ABC123","created_by":"user-1","created_at":"2026-08-31T00:00:00Z"}]`))
	}))
	defer server.Close()

	client := NewRESTClient(server.URL, "publishable-key")
	households, err := client.ListHouseholds(t.Context(), "user-access-token")
	if err != nil {
		t.Fatalf("ListHouseholds() error = %v", err)
	}
	if len(households) != 1 || households[0].ID != "household-1" {
		t.Fatalf("ListHouseholds() = %#v", households)
	}
}
