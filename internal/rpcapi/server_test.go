package rpcapi_test

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"github.com/wmichelin/Pantry/internal/rpcapi"
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

type scraperStub struct {
	calls  int
	result *pantry.ScrapeResult
	run    func(context.Context) (*pantry.ScrapeResult, error)
}

func (stub *scraperStub) Scrape(ctx context.Context, _ string, _ string, _ string) (*pantry.ScrapeResult, error) {
	stub.calls++
	if stub.run != nil {
		return stub.run(ctx)
	}
	return stub.result, nil
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

func TestScrapeRecipeUsesAuthenticatedBinaryContract(t *testing.T) {
	zero := int32(0)
	image := ""
	backend := &backendStub{membership: &pantry.Membership{HouseholdID: "household-1"}}
	scraper := &scraperStub{result: &pantry.ScrapeResult{Recipe: &pantry.ScrapedRecipe{
		Title: "Recipe", SourceURL: "https://recipes.example", SourceType: "url", ImageURL: &image,
		Servings: &zero, Instructions: []string{"Second", "First"}, RawIngredients: []string{}, SuggestedTags: []string{"One Pot"},
	}}}
	service := pantry.NewService(backend, backend, backend, backend, backend, pantry.WithRecipeScraper(scraper))
	handler := api.New(verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}}, service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(handler)
	defer server.Close()
	client := pantryv1connect.NewRecipeScrapeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	request := connect.NewRequest(&pantryv1.ScrapeRecipeRequest{HouseholdId: "household-1", Url: "https://recipes.example"})
	request.Header().Set("Authorization", "Bearer verified-user-token")
	response, err := client.ScrapeRecipe(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	recipe := response.Msg.GetRecipe()
	if recipe == nil || recipe.Title != "Recipe" || recipe.SourceUrl != "https://recipes.example" || recipe.SourceType != "url" || recipe.ImageUrl == nil || *recipe.ImageUrl != "" || recipe.Servings == nil || *recipe.Servings != 0 || recipe.PrepTimeMinutes != nil || recipe.CookTimeMinutes != nil || !slices.Equal(recipe.Instructions, []string{"Second", "First"}) || len(recipe.RawIngredients) != 0 || !slices.Equal(recipe.SuggestedTags, []string{"One Pot"}) || response.Msg.GetBoard() != nil || scraper.calls != 1 {
		t.Fatalf("scrape response = %#v, calls = %d", recipe, scraper.calls)
	}
}

func TestScrapeRecipeRejectsAnonymousOutsiderAndOversizeBeforeOutboundWork(t *testing.T) {
	scraper := &scraperStub{result: &pantry.ScrapeResult{Recipe: &pantry.ScrapedRecipe{Title: "Recipe"}}}
	backend := &backendStub{membership: &pantry.Membership{HouseholdID: "allowed-household"}}
	service := pantry.NewService(backend, backend, backend, backend, backend, pantry.WithRecipeScraper(scraper))
	handler := api.New(verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}}, service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(handler)
	defer server.Close()

	anonymous, err := http.Post(server.URL+api.RPCPrefix+pantryv1connect.RecipeScrapeServiceScrapeRecipeProcedure, "application/proto", strings.NewReader("not-protobuf"))
	if err != nil {
		t.Fatal(err)
	}
	anonymous.Body.Close()
	if anonymous.StatusCode != http.StatusUnauthorized || scraper.calls != 0 || len(backend.tokens) != 0 {
		t.Fatalf("anonymous status=%d scraper=%d membership=%d", anonymous.StatusCode, scraper.calls, len(backend.tokens))
	}

	client := pantryv1connect.NewRecipeScrapeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	outsider := connect.NewRequest(&pantryv1.ScrapeRecipeRequest{HouseholdId: "other-household", Url: "https://recipes.example"})
	outsider.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := client.ScrapeRecipe(context.Background(), outsider); connect.CodeOf(err) != connect.CodeNotFound || scraper.calls != 0 || backend.userID != "user-1" || len(backend.tokens) != 1 {
		t.Fatalf("outsider error=%v scraper=%d user=%q membership=%d", err, scraper.calls, backend.userID, len(backend.tokens))
	}

	oversize := connect.NewRequest(&pantryv1.ScrapeRecipeRequest{HouseholdId: "allowed-household", Url: "https://recipes.example/?" + strings.Repeat("x", rpcapi.MaxScrapeRequestBytes)})
	oversize.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := client.ScrapeRecipe(context.Background(), oversize); connect.CodeOf(err) != connect.CodeResourceExhausted || scraper.calls != 0 || len(backend.tokens) != 1 {
		t.Fatalf("oversize error=%v scraper=%d membership=%d", err, scraper.calls, len(backend.tokens))
	}

	boardScraper := &scraperStub{result: &pantry.ScrapeResult{Board: &pantry.ScrapedBoard{Recipes: []pantry.ScrapedRecipe{}, TotalFound: 0}}}
	boardService := pantry.NewService(backend, backend, backend, backend, backend, pantry.WithRecipeScraper(boardScraper))
	boardServer := httptest.NewServer(api.New(verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}}, boardService, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer boardServer.Close()
	boardClient := pantryv1connect.NewRecipeScrapeServiceClient(http.DefaultClient, boardServer.URL+api.RPCPrefix)
	boardRequest := connect.NewRequest(&pantryv1.ScrapeRecipeRequest{HouseholdId: "allowed-household", Url: "https://pinterest.com/user/board"})
	boardRequest.Header().Set("Authorization", "Bearer verified-user-token")
	boardResponse, err := boardClient.ScrapeRecipe(context.Background(), boardRequest)
	if err != nil || boardResponse.Msg.GetBoard() == nil || boardResponse.Msg.GetBoard().TotalFound != 0 || boardResponse.Msg.GetRecipe() != nil || boardScraper.calls != 1 {
		t.Fatalf("empty board oneof=%#v error=%v calls=%d", boardResponse, err, boardScraper.calls)
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

type scrapeDeadlineRecorder struct {
	*httptest.ResponseRecorder
	writeDeadline time.Time
	deadlineError error
}

func (writer *scrapeDeadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	writer.writeDeadline = deadline
	return writer.deadlineError
}

func TestScrapeDeadlineReservesStructuredResponseMargin(t *testing.T) {
	var operationDeadline time.Time
	scraper := &scraperStub{run: func(ctx context.Context) (*pantry.ScrapeResult, error) {
		var ok bool
		operationDeadline, ok = ctx.Deadline()
		if !ok {
			t.Fatal("scrape operation has no deadline")
		}
		return nil, context.DeadlineExceeded
	}}
	backend := &backendStub{membership: &pantry.Membership{HouseholdID: "household-1"}}
	service := pantry.NewService(backend, backend, backend, backend, backend, pantry.WithRecipeScraper(scraper))
	handler := api.New(verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}}, service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	body, err := proto.Marshal(&pantryv1.ScrapeRecipeRequest{HouseholdId: "household-1", Url: "https://recipes.example"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, api.RPCPrefix+pantryv1connect.RecipeScrapeServiceScrapeRecipeProcedure, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/proto")
	request.Header.Set("Connect-Protocol-Version", "1")
	request.Header.Set("Authorization", "Bearer verified-user-token")
	writer := &scrapeDeadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
	started := time.Now()
	handler.ServeHTTP(writer, request)
	if operationDeadline.Before(started.Add(rpcapi.ScrapeTimeout)) || operationDeadline.After(time.Now().Add(rpcapi.ScrapeTimeout)) {
		t.Fatal("scrape operation deadline does not use its bounded timeout")
	}
	if margin := writer.writeDeadline.Sub(operationDeadline); margin != rpcapi.ScrapeResponseMargin || margin <= 0 {
		t.Fatalf("structured-response deadline margin = %s", margin)
	}
	if rpcapi.ScrapeTimeout+rpcapi.ScrapeResponseMargin != 45*time.Second {
		t.Fatal("scrape exceeded the 45-second HTTP write budget")
	}
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(writer.Body.Bytes(), &response); err != nil || response.Code != "deadline_exceeded" || writer.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected structured deadline error, got status %d body %q: %v", writer.Code, writer.Body.String(), err)
	}
	if writer.Header().Get("Cache-Control") != "no-store" || scraper.calls != 1 {
		t.Fatal("scrape cache or invocation contract failed")
	}

	// Do not begin work when the response writer cannot reserve its deadline.
	request = httptest.NewRequest(http.MethodPost, api.RPCPrefix+pantryv1connect.RecipeScrapeServiceScrapeRecipeProcedure, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/proto")
	request.Header.Set("Authorization", "Bearer verified-user-token")
	writer = &scrapeDeadlineRecorder{ResponseRecorder: httptest.NewRecorder(), deadlineError: errors.New("unsupported")}
	handler.ServeHTTP(writer, request)
	if writer.Code != http.StatusInternalServerError || scraper.calls != 1 {
		t.Fatal("unsupported write deadline did not fail before scrape work")
	}
}
