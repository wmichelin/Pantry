package pantry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/authn"
	"os"
	"testing"
)

func TestShoppingSharedLegacyFixture(t *testing.T) {
	data, err := os.ReadFile("../../contracts/fixtures/shopping-aggregation.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Snapshot ShoppingSnapshot
		Expected []ShoppingItem
		Names    []struct{ Raw, Normalized, Display string }
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(fixture.Expected, AggregateShopping(fixture.Snapshot)); diff != "" {
		t.Fatal(diff)
	}
	for _, n := range fixture.Names {
		if got := normalizeShoppingName(n.Raw); got != n.Normalized {
			t.Errorf("normalize %q: %q != %q", n.Raw, got, n.Normalized)
		}
		if shoppingTitle(n.Normalized) != n.Display {
			t.Error("display casing mismatch")
		}
	}
}

type shoppingListStub struct {
	snapshot               ShoppingSnapshot
	token, h               string
	calls, ensures, writes int
	err                    error
	failAt                 string
	metadata               []ShoppingMetadataOrder
	manuals                []ShoppingManualOrder
	name, display          string
	order                  int32
}

func (m *shoppingListStub) ShoppingSnapshot(_ context.Context, token, h string) (ShoppingSnapshot, error) {
	m.calls++
	m.token = token
	m.h = h
	if m.failAt == "reload" && m.calls == 2 {
		return ShoppingSnapshot{}, errors.New("reload failed")
	}
	return m.snapshot, m.err
}
func (m *shoppingListStub) EnsureShoppingCatalog(_ context.Context, token, h string, entries []ShoppingCatalogSeed) error {
	m.ensures++
	if m.failAt == "ensure" {
		return errors.New("ensure failed")
	}
	if m.failAt == "missing" {
		return nil
	}
	for _, e := range entries {
		m.snapshot.Catalog = append(m.snapshot.Catalog, ShoppingCatalog{ID: e.NormalizedName, NormalizedName: e.NormalizedName, DisplayName: "Race Winner", SortOrder: 10, Category: "custom"})
	}
	return m.err
}
func (m *shoppingListStub) AddShoppingManual(_ context.Context, token, h, revision, name, display string, order int32) (ShoppingSnapshot, error) {
	m.writes++
	if m.failAt == "write" {
		return ShoppingSnapshot{}, errors.New("write failed")
	}
	m.name = name
	m.display = display
	m.order = order
	return m.snapshot, m.err
}
func (m *shoppingListStub) RemoveShoppingManual(_ context.Context, token, h, id string) (ShoppingSnapshot, error) {
	m.writes++
	if m.failAt == "write" {
		return ShoppingSnapshot{}, errors.New("write failed")
	}
	m.snapshot.Manuals = nil
	m.token = token
	m.h = h
	return m.snapshot, m.err
}
func (m *shoppingListStub) SaveShoppingOrder(_ context.Context, token, h, revision string, metadata []ShoppingMetadataOrder, manuals []ShoppingManualOrder) (ShoppingSnapshot, error) {
	m.writes++
	if m.failAt == "write" {
		return ShoppingSnapshot{}, errors.New("write failed")
	}
	m.metadata = metadata
	m.manuals = manuals
	return m.snapshot, m.err
}

func TestShoppingSeedAndMutationFailures(t *testing.T) {
	for _, step := range []string{"ensure", "reload", "missing"} {
		m := &shoppingListStub{snapshot: ShoppingSnapshot{Ingredients: []ShoppingIngredient{{Name: "milk"}}}, failAt: step}
		s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
		if _, err := s.GetShoppingList(t.Context(), authn.Caller{}, "h"); err == nil {
			t.Fatal("partial seed returned as success: " + step)
		}
	}
	m := &shoppingListStub{snapshot: shoppingFixture(), failAt: "write"}
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	if _, err := s.AddShoppingManualItem(t.Context(), authn.Caller{}, "h", "tea"); err == nil {
		t.Fatal("add failure hidden")
	}
	if _, err := s.RemoveShoppingManualItem(t.Context(), authn.Caller{}, "h", "manual"); err == nil {
		t.Fatal("remove failure hidden")
	}
	if _, err := s.SaveShoppingOrder(t.Context(), authn.Caller{}, "h", "v1", []ShoppingOrderRow{{"recipe:milk", ""}, {"manual:manual", ""}}); err == nil {
		t.Fatal("order failure hidden")
	}
}
func TestShoppingRemovePreservesRecipeTitledAdded(t *testing.T) {
	m := &shoppingListStub{snapshot: shoppingFixture()}
	u := "cups"
	m.snapshot.Manuals[0].Unit = &u
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	list, err := s.RemoveShoppingManualItem(t.Context(), authn.Caller{}, "h", "manual")
	if err != nil || len(list.Items) != 1 || len(list.Items[0].Occurrences) != 1 || list.Items[0].Occurrences[0].RecipeTitle != "Added" || list.Items[0].IsManual {
		t.Fatal("real Added recipe removed")
	}
}
func TestShoppingManualChecksEmptyAndEqualOrder(t *testing.T) {
	if len(AggregateShopping(ShoppingSnapshot{})) != 0 {
		t.Fatal("empty list not empty")
	}
	s := shoppingFixture()
	s.Manuals[0].SortOrder = &s.Catalog[0].SortOrder
	s.Checks = []string{"milk::manual"}
	items := AggregateShopping(s)
	if len(items) != 2 || items[0].ListKey != "recipe:milk" || items[0].Checked || !items[1].Checked {
		t.Fatal("manual check or stable tie mismatch")
	}
}
func TestShoppingLimits(t *testing.T) {
	m := &shoppingListStub{snapshot: shoppingFixture()}
	m.snapshot.Catalog[0].SortOrder = -2147483648
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	if _, err := s.AddShoppingManualItem(t.Context(), authn.Caller{}, "h", "tea"); err == nil || m.writes != 0 {
		t.Fatal("order underflow reached storage")
	}
	m.snapshot = ShoppingSnapshot{Manuals: make([]ShoppingManual, 10001)}
	if _, err := s.GetShoppingList(t.Context(), authn.Caller{}, "h"); err == nil || m.ensures != 0 {
		t.Fatal("oversized list seeded")
	}
	m.snapshot = ShoppingSnapshot{}
	for i := 0; i < 10000; i++ {
		name := fmt.Sprint(i)
		m.snapshot.Manuals = append(m.snapshot.Manuals, ShoppingManual{ID: name, NormalizedName: name})
		m.snapshot.Catalog = append(m.snapshot.Catalog, ShoppingCatalog{ID: name, NormalizedName: name})
	}
	if _, err := s.AddShoppingManualItem(t.Context(), authn.Caller{}, "h", "new"); err == nil || m.writes != 0 {
		t.Fatal("new row at cap reached storage")
	}
	if _, err := s.AddShoppingManualItem(t.Context(), authn.Caller{}, "h", "0"); err != nil || m.writes != 1 {
		t.Fatal("re-add at cap rejected")
	}
}
func shoppingFixture() ShoppingSnapshot {
	order := int32(20)
	return ShoppingSnapshot{Revision: "v1", Ingredients: []ShoppingIngredient{{Name: "milk", ShoppingOccurrence: ShoppingOccurrence{RecipeTitle: "Added"}}}, Catalog: []ShoppingCatalog{{ID: "catalog", NormalizedName: "milk", DisplayName: "Custom", SortOrder: 10, Category: "other"}}, Manuals: []ShoppingManual{{ID: "manual", NormalizedName: "milk", SortOrder: &order}}}
}
func TestShoppingSeedingRereadsWinner(t *testing.T) {
	m := &shoppingListStub{snapshot: ShoppingSnapshot{Ingredients: []ShoppingIngredient{{Name: "milk"}, {Name: "Milk"}}}}
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	list, err := s.GetShoppingList(t.Context(), authn.Caller{AccessToken: "caller"}, "h")
	if err != nil {
		t.Fatal(err)
	}
	if m.calls != 2 || m.ensures != 1 || list.Items[0].DisplayName != "Race Winner" || m.token != "caller" {
		t.Fatal("seed failed to reread winner")
	}
}
func TestShoppingOrderDeduplicatesWithoutOverwritingDisplay(t *testing.T) {
	m := &shoppingListStub{snapshot: shoppingFixture()}
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	_, err := s.SaveShoppingOrder(t.Context(), authn.Caller{AccessToken: "caller"}, "h", "v1", []ShoppingOrderRow{{"recipe:milk", "dairy"}, {"manual:manual", "custom"}})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]ShoppingMetadataOrder{{"catalog", 10, "custom"}}, m.metadata); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff([]ShoppingManualOrder{{"manual", 20}}, m.manuals); diff != "" {
		t.Fatal(diff)
	}
}
func TestShoppingOrderRejectsIncompleteDuplicateAndStale(t *testing.T) {
	for _, tt := range []struct {
		name, revision string
		rows           []ShoppingOrderRow
	}{{"missing", "v1", nil}, {"duplicate", "v1", []ShoppingOrderRow{{"recipe:milk", ""}, {"recipe:milk", ""}}}, {"foreign", "v1", []ShoppingOrderRow{{"recipe:milk", ""}, {"manual:foreign", ""}}}, {"stale", "old", []ShoppingOrderRow{{"recipe:milk", ""}, {"manual:manual", ""}}}} {
		t.Run(tt.name, func(t *testing.T) {
			m := &shoppingListStub{snapshot: shoppingFixture()}
			s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
			if _, err := s.SaveShoppingOrder(t.Context(), authn.Caller{}, "h", tt.revision, tt.rows); err == nil || m.writes != 0 {
				t.Fatal("invalid order wrote data")
			}
		})
	}
}
func TestShoppingManualUsesLiteralNameAndVisibleMinimum(t *testing.T) {
	m := &shoppingListStub{snapshot: shoppingFixture()}
	m.snapshot.Catalog = append(m.snapshot.Catalog, ShoppingCatalog{ID: "hidden", NormalizedName: "not visible", SortOrder: -999})
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	_, err := s.AddShoppingManualItem(t.Context(), authn.Caller{}, "h", " 2 cups Flour ")
	if err != nil {
		t.Fatal(err)
	}
	if m.name != "2 cups flour" || m.display != "2 cups Flour" || m.order != 0 {
		t.Fatalf("wrong manual: %q %q %d", m.name, m.display, m.order)
	}
}
func TestShoppingDependencyFailuresDoNotReturnPartialLists(t *testing.T) {
	m := &shoppingListStub{err: errors.New("private error")}
	s := NewService(nil, nil, nil, nil, nil, WithShoppingListStore(m))
	if _, err := s.GetShoppingList(t.Context(), authn.Caller{}, "h"); err == nil {
		t.Fatal("failure hidden")
	}
	for _, name := range []string{"", "\ufeff ", "For sauce:"} {
		if _, err := s.AddShoppingManualItem(t.Context(), authn.Caller{}, "h", name); err == nil {
			t.Fatal("invalid item accepted")
		}
	}
	if m.writes != 0 {
		t.Fatal("invalid request wrote data")
	}
}
