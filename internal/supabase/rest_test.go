package supabase

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
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

func TestRESTClientHouseholdOperationsUseCallerJWTForRPC(t *testing.T) {
	tests := []struct {
		name string
		path string
		body string
		run  func(*RESTClient) error
	}{
		{
			name: "create",
			path: "/rest/v1/rpc/create_household",
			body: `{"p_name":"Pantry","p_display_name":"Owner"}`,
			run: func(client *RESTClient) error {
				created, err := client.CreateHousehold(t.Context(), "user-access-token", "Pantry", "Owner")
				if err == nil && (created == nil || created.InviteCode != "INVITE") {
					t.Fatalf("created = %#v", created)
				}
				return err
			},
		},
		{
			name: "join",
			path: "/rest/v1/rpc/join_household_by_invite",
			body: `{"p_code":"INVITE","p_display_name":"Member"}`,
			run: func(client *RESTClient) error {
				joined, err := client.JoinHouseholdByInvite(t.Context(), "user-access-token", "INVITE", "Member")
				if err == nil && (joined == nil || !joined.AlreadyMember) {
					t.Fatalf("joined = %#v", joined)
				}
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != tt.path {
					t.Fatalf("path = %q, want %q", request.URL.Path, tt.path)
				}
				if request.Header.Get("Authorization") != "Bearer user-access-token" || request.Header.Get("apikey") != "anon-key" {
					t.Fatalf("operation did not preserve caller-only credentials")
				}
				var got any
				if err := json.NewDecoder(request.Body).Decode(&got); err != nil {
					t.Fatalf("decode request: %v", err)
				}
				var want any
				if err := json.Unmarshal([]byte(tt.body), &want); err != nil {
					t.Fatalf("decode expected request: %v", err)
				}
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("RPC request = %#v, want %#v", got, want)
				}
				writer.Header().Set("Content-Type", "application/json")
				if tt.name == "create" {
					_, _ = writer.Write([]byte(`[{"id":"household-1","name":"Pantry","invite_code":"INVITE"}]`))
					return
				}
				_, _ = writer.Write([]byte(`[{"id":"household-1","name":"Pantry","already_member":true}]`))
			}))
			defer server.Close()

			if err := tt.run(NewRESTClient(server.URL, "anon-key")); err != nil {
				t.Fatalf("RPC operation error = %v", err)
			}
		})
	}
}

func TestRESTClientSaveRecipeForwardsAtomicPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/rest/v1/rpc/create_recipe_with_ingredients" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer user-access-token" || request.Header.Get("apikey") != "anon-key" {
			t.Fatalf("recipe RPC did not preserve caller credentials")
		}
		var input map[string]any
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatalf("decode input: %v", err)
		}
		if input["p_household_id"] != "household-1" {
			t.Fatalf("household input = %#v", input)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`[{"id":"recipe-1","title":"Soup","ingredient_count":1}]`))
	}))
	defer server.Close()

	recipe, err := NewRESTClient(server.URL, "anon-key").SaveRecipe(t.Context(), "user-access-token", RecipeSave{
		HouseholdID: "household-1",
		Title:       "Soup",
		Ingredients: []RecipeIngredient{{Name: "tomato"}},
	})
	if err != nil || recipe == nil || recipe.IngredientCount != 1 {
		t.Fatalf("SaveRecipe() = %#v, %v", recipe, err)
	}
}
