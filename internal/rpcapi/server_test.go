package rpcapi_test

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
)

type verifierStub struct {
	principal authn.Principal
	err       error
}

func (stub verifierStub) Verify(context.Context, string) (authn.Principal, error) {
	return stub.principal, stub.err
}

type backendStub struct {
	households []pantry.Household
	membership *pantry.Membership
	created    *pantry.CreatedHousehold
	joined     *pantry.JoinedHousehold
	saved      *pantry.SavedRecipe
	err        error
	tokens     []string
	userID     string
	recipes    []pantry.RecipeSave
}

func (stub *backendStub) ListHouseholds(_ context.Context, token string) ([]pantry.Household, error) {
	stub.tokens = append(stub.tokens, token)
	return stub.households, stub.err
}

func (stub *backendStub) FindMembership(_ context.Context, userID, token string) (*pantry.Membership, error) {
	stub.userID = userID
	stub.tokens = append(stub.tokens, token)
	return stub.membership, stub.err
}

func (stub *backendStub) HasHouseholdMembership(_ context.Context, userID, householdID, token string) (bool, error) {
	stub.userID = userID
	stub.tokens = append(stub.tokens, token)
	return stub.membership != nil && stub.membership.HouseholdID == householdID, stub.err
}

func (stub *backendStub) CreateHousehold(_ context.Context, token, _, _ string) (*pantry.CreatedHousehold, error) {
	stub.tokens = append(stub.tokens, token)
	return stub.created, stub.err
}

func (stub *backendStub) JoinHouseholdByInvite(_ context.Context, token, _, _ string) (*pantry.JoinedHousehold, error) {
	stub.tokens = append(stub.tokens, token)
	return stub.joined, stub.err
}

func (stub *backendStub) SaveRecipe(_ context.Context, token string, recipe pantry.RecipeSave) (*pantry.SavedRecipe, error) {
	stub.tokens = append(stub.tokens, token)
	stub.recipes = append(stub.recipes, recipe)
	return stub.saved, stub.err
}

func TestGeneratedClientUsesPublicPrefixAndVerifiedCaller(t *testing.T) {
	backend := &backendStub{membership: &pantry.Membership{
		HouseholdID: "household-1",
		Role:        "owner",
		Household:   pantry.Household{ID: "household-1", Name: "Pantry", InviteCode: "ABC123"},
	}}
	server := newServer(t, backend)
	client := pantryv1connect.NewHouseholdServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	request := connect.NewRequest(&pantryv1.GetMembershipRequest{})
	request.Header().Set("Authorization", "Bearer verified-user-token")

	response, err := client.GetMembership(context.Background(), request)
	if err != nil {
		t.Fatalf("get membership: %v", err)
	}
	if response.Msg.Membership == nil || response.Msg.Membership.Household == nil {
		t.Fatalf("membership = %#v", response.Msg.Membership)
	}
	if response.Msg.Membership.Household.Name != "Pantry" {
		t.Fatalf("household name = %q", response.Msg.Membership.Household.Name)
	}
	if backend.userID != "user-1" || len(backend.tokens) != 1 || backend.tokens[0] != "verified-user-token" {
		t.Fatalf("forwarded caller = (%q, %#v)", backend.userID, backend.tokens)
	}
}

func TestAuthenticationRejectsMalformedBodyBeforeDecode(t *testing.T) {
	backend := &backendStub{}
	server := newServer(t, backend)
	request, err := http.NewRequest(
		http.MethodPost,
		server.URL+api.RPCPrefix+pantryv1connect.HouseholdServiceCreateHouseholdProcedure,
		strings.NewReader("not protobuf"),
	)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("Content-Type", "application/proto")
	request.Header.Set("Connect-Protocol-Version", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("call server: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if body.Code != "unauthenticated" {
		t.Fatalf("code = %q", body.Code)
	}
	if len(backend.tokens) != 0 {
		t.Fatalf("backend received tokens: %#v", backend.tokens)
	}
}

func TestAuthenticatedOversizedRequestIsRejectedBeforeBackend(t *testing.T) {
	backend := &backendStub{}
	server := newServer(t, backend)
	client := pantryv1connect.NewHouseholdServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	request := connect.NewRequest(&pantryv1.CreateHouseholdRequest{Name: strings.Repeat("x", 17<<10)})
	request.Header().Set("Authorization", "Bearer verified-user-token")

	_, err := client.CreateHousehold(context.Background(), request)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("code = %v, want %v (error: %v)", connect.CodeOf(err), connect.CodeResourceExhausted, err)
	}
	if len(backend.tokens) != 0 {
		t.Fatalf("oversized request reached backend: %#v", backend.tokens)
	}
}

func TestResponseSizeIsNotLimitedByRequestGuard(t *testing.T) {
	households := make([]pantry.Household, 400)
	for index := range households {
		households[index] = pantry.Household{ID: strings.Repeat("i", 36), Name: strings.Repeat("n", 80)}
	}
	server := newServer(t, &backendStub{households: households})
	client := pantryv1connect.NewHouseholdServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	request := connect.NewRequest(&pantryv1.ListHouseholdsRequest{})
	request.Header().Set("Authorization", "Bearer verified-user-token")

	response, err := client.ListHouseholds(context.Background(), request)
	if err != nil {
		t.Fatalf("list households: %v", err)
	}
	if len(response.Msg.Households) != len(households) {
		t.Fatalf("households = %d, want %d", len(response.Msg.Households), len(households))
	}
}

func TestConnectErrorsCarryStableDetails(t *testing.T) {
	server := newServer(t, &backendStub{})
	client := pantryv1connect.NewHouseholdServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	request := connect.NewRequest(&pantryv1.JoinHouseholdRequest{InviteCode: "missing"})
	request.Header().Set("Authorization", "Bearer verified-user-token")

	_, err := client.JoinHousehold(context.Background(), request)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error type = %T", err)
	}
	for _, encoded := range connectErr.Details() {
		message, detailErr := encoded.Value()
		if detailErr != nil {
			t.Fatalf("decode detail: %v", detailErr)
		}
		detail, ok := message.(*pantryv1.PantryErrorDetail)
		if ok && detail.Code == "invite_not_found" && detail.UserMessage == "No household found with that invite code." {
			return
		}
	}
	t.Fatal("stable Pantry error detail was absent")
}

func TestRecipeQuantityPresenceAndFiniteValidation(t *testing.T) {
	backend := &backendStub{saved: &pantry.SavedRecipe{ID: "recipe-1", Title: "Soup", IngredientCount: 1}}
	server := newServer(t, backend)
	client := pantryv1connect.NewRecipeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	call := func(quantity *float64) error {
		request := connect.NewRequest(&pantryv1.SaveRecipeRequest{
			HouseholdId: "household-1",
			Title:       "Soup",
			Ingredients: []*pantryv1.RecipeIngredient{{Name: "tomato", Quantity: quantity}},
		})
		request.Header().Set("Authorization", "Bearer verified-user-token")
		_, err := client.SaveRecipe(context.Background(), request)
		return err
	}

	if err := call(nil); err != nil {
		t.Fatalf("save absent quantity: %v", err)
	}
	zero := 0.0
	if err := call(&zero); err != nil {
		t.Fatalf("save zero quantity: %v", err)
	}
	if len(backend.recipes) != 2 || backend.recipes[0].Ingredients[0].Quantity != nil {
		t.Fatalf("absent quantity = %#v", backend.recipes)
	}
	if backend.recipes[1].Ingredients[0].Quantity == nil || *backend.recipes[1].Ingredients[0].Quantity != 0 {
		t.Fatalf("zero quantity = %#v", backend.recipes[1].Ingredients[0].Quantity)
	}

	nan := math.NaN()
	if err := call(&nan); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("NaN code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if len(backend.recipes) != 2 {
		t.Fatalf("invalid quantity reached backend: %d calls", len(backend.recipes))
	}
}

func TestGoWireFixtureMatchesCrossLanguageContract(t *testing.T) {
	encoded, err := proto.Marshal(&pantryv1.CreateHouseholdRequest{Name: "Pantry", DisplayName: "Owner"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	const expected = "0a0650616e74727912054f776e6572"
	if got := hex.EncodeToString(encoded); got != expected {
		t.Fatalf("wire bytes = %s, want %s", got, expected)
	}
}

func newServer(t *testing.T, backend *backendStub) *httptest.Server {
	t.Helper()
	service := pantry.NewService(backend, backend, backend, backend, backend)
	handler := api.New(
		verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}},
		service,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}
