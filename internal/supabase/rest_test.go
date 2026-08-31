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

func TestRESTClientFindMembershipForwardsVerifiedCallerIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/rest/v1/household_members" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if got := request.URL.Query().Get("user_id"); got != "eq.user-1" {
			t.Fatalf("user_id = %q", got)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer user-access-token" {
			t.Fatalf("authorization = %q", got)
		}
		if got := request.Header.Get("apikey"); got != "anon-key" {
			t.Fatalf("apikey = %q", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`[{"household_id":"household-1","role":"owner","households":{"id":"household-1","name":"Pantry","invite_code":"ABC123"}}]`))
	}))
	defer server.Close()

	client := NewRESTClient(server.URL, "anon-key")
	membership, err := client.FindMembership(t.Context(), "user-1", "user-access-token")
	if err != nil {
		t.Fatalf("FindMembership() error = %v", err)
	}
	if membership == nil || membership.Role != "owner" || membership.Household.ID != "household-1" {
		t.Fatalf("FindMembership() = %#v", membership)
	}
}
