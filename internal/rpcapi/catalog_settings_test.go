package rpcapi_test

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Only these operations may be reached; unexpected methods panic via nil interface.
type catalogRPCStub struct {
	pantry.CatalogSettingsStore
	calls    int
	token, h string
	entries  []pantry.CatalogEntry
	err      error
}

func (m *catalogRPCStub) EnsureCatalogEntries(_ context.Context, t, h string, e []pantry.CatalogEntry, _ bool) (pantry.CatalogView, error) {
	m.calls++
	m.token = t
	m.h = h
	m.entries = e
	return pantry.CatalogView{Items: []pantry.ShoppingCatalog{{ID: "i", NormalizedName: "flour", DisplayName: "Flour"}}}, m.err
}
func (m *catalogRPCStub) SaveHouseholdAisleOrder(_ context.Context, t, h, r string, k []string) (pantry.AisleView, error) {
	m.calls++
	m.token = t
	m.h = h
	return pantry.AisleView{Revision: r}, m.err
}
func catalogRPCServer(t *testing.T, m *catalogRPCStub) *httptest.Server {
	t.Helper()
	b := &backendStub{}
	s := httptest.NewServer(api.New(verifierStub{principal: authn.Principal{Subject: "u", Role: "authenticated"}}, pantry.NewService(b, b, b, b, b, pantry.WithCatalogSettings(m)), slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(s.Close)
	return s
}
func TestCatalogBinaryOptionalAndSafeFailure(t *testing.T) {
	m := &catalogRPCStub{}
	s := catalogRPCServer(t, m)
	c := pantryv1connect.NewCatalogServiceClient(http.DefaultClient, s.URL+api.RPCPrefix)
	zero := int32(0)
	blank := ""
	for _, r := range []*pantryv1.EnsureCatalogIngredientRequest{{HouseholdId: "h", RawName: "2 cups flour"}, {HouseholdId: "h", RawName: "2 cups flour", SortOrder: &zero, DisplayName: &blank}} {
		if _, err := c.EnsureCatalogIngredient(t.Context(), authorized(r)); err != nil {
			t.Fatal(err)
		}
		if (m.entries[0].SortOrder == nil) != (r.SortOrder == nil) || m.token != "caller-token" || m.h != "h" {
			t.Fatal("optional/caller contract lost")
		}
	}
	got, err := c.EnsureCatalogIngredient(t.Context(), authorized(&pantryv1.EnsureCatalogIngredientRequest{HouseholdId: "h", RawName: "For sauce:"}))
	if err != nil || got.Msg.Item != nil || m.calls != 2 {
		t.Fatal("invalid name should be intentional absence")
	}
	m.err = errors.New("secret upstream")
	_, err = c.EnsureCatalogIngredient(t.Context(), authorized(&pantryv1.EnsureCatalogIngredientRequest{HouseholdId: "h", RawName: "flour"}))
	if connect.CodeOf(err) != connect.CodeUnavailable || strings.Contains(err.Error(), "secret") {
		t.Fatal("unsafe error", err)
	}
}
func TestCatalogSettingsAnonymousRoutesAndDedicatedBodyLimit(t *testing.T) {
	m := &catalogRPCStub{}
	s := catalogRPCServer(t, m)
	for _, method := range []string{"CatalogService/GetCatalog", "CatalogService/EnsureCatalogIngredient", "CatalogService/SeedCatalogFromRecipes", "CatalogService/UpdateCatalogIngredient", "CatalogService/RemoveCatalogIngredient", "AisleService/GetHouseholdAisles", "AisleService/CreateHouseholdAisle", "AisleService/RemoveHouseholdAisle", "AisleService/SaveHouseholdAisleOrder", "HouseholdSettingsService/GetHouseholdSettings", "HouseholdSettingsService/AddHouseholdStore", "HouseholdSettingsService/RemoveHouseholdStore"} {
		r, err := http.Post(s.URL+api.RPCPrefix+"/pantry.v1."+method, "application/json", strings.NewReader(`{"householdId":"h"}`))
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != 401 {
			t.Fatalf("%s anonymous status %d", method, r.StatusCode)
		}
	}
	if m.calls != 0 {
		t.Fatal("anonymous reached storage")
	}
	c := pantryv1connect.NewAisleServiceClient(http.DefaultClient, s.URL+api.RPCPrefix)
	for _, size := range []int{20 * 1024, 140 * 1024} {
		_, err := c.SaveHouseholdAisleOrder(t.Context(), authorized(&pantryv1.SaveHouseholdAisleOrderRequest{HouseholdId: "h", Revision: strings.Repeat("r", size), Keys: []string{"other"}}))
		if size < 128*1024 && err != nil {
			t.Fatal("dedicated body limit not applied", err)
		}
		if size > 128*1024 && err == nil {
			t.Fatal("oversized body accepted")
		}
	}
	if m.calls != 1 {
		t.Fatal("oversized request reached storage")
	}
}
