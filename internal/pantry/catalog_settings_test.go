package pantry

import (
	"context"
	"errors"
	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/authn"
	"strings"
	"testing"
)

type catalogStub struct {
	token, household, id, display, category, revision string
	calls                                             int
	entries                                           []CatalogEntry
	seed                                              bool
	keys                                              []string
	view                                              CatalogView
	aisle                                             AisleView
	settings                                          HouseholdSettings
	err                                               error
}

func (m *catalogStub) call(token, h string) { m.calls++; m.token = token; m.household = h }
func (m *catalogStub) GetCatalog(_ context.Context, t, h string) (CatalogView, error) {
	m.call(t, h)
	return m.view, m.err
}
func (m *catalogStub) CatalogSeedSource(_ context.Context, t, h string) (CatalogView, error) {
	m.call(t, h)
	return m.view, m.err
}
func (m *catalogStub) EnsureCatalogEntries(_ context.Context, t, h string, e []CatalogEntry, seed bool) (CatalogView, error) {
	m.call(t, h)
	m.entries = e
	m.seed = seed
	return m.view, m.err
}
func (m *catalogStub) UpdateCatalogIngredient(_ context.Context, t, h, id, display, category string) (ShoppingCatalog, error) {
	m.call(t, h)
	m.id = id
	m.display = display
	m.category = category
	return ShoppingCatalog{ID: id, Category: category}, m.err
}
func (m *catalogStub) RemoveCatalogIngredient(_ context.Context, t, h, id string) error {
	m.call(t, h)
	m.id = id
	return m.err
}
func (m *catalogStub) GetHouseholdAisles(_ context.Context, t, h string) (AisleView, error) {
	m.call(t, h)
	return m.aisle, m.err
}
func (m *catalogStub) CreateHouseholdAisle(_ context.Context, t, h, label, key string) (AisleView, error) {
	m.call(t, h)
	m.display = label
	m.id = key
	return m.aisle, m.err
}
func (m *catalogStub) RemoveHouseholdAisle(_ context.Context, t, h, key string) (AisleView, error) {
	m.call(t, h)
	m.id = key
	return m.aisle, m.err
}
func (m *catalogStub) SaveHouseholdAisleOrder(_ context.Context, t, h, r string, keys []string) (AisleView, error) {
	m.call(t, h)
	m.revision = r
	m.keys = keys
	return m.aisle, m.err
}
func (m *catalogStub) GetHouseholdSettings(_ context.Context, t, h string) (HouseholdSettings, error) {
	m.call(t, h)
	return m.settings, m.err
}
func (m *catalogStub) AddHouseholdStore(_ context.Context, t, h, name string) (HouseholdSettings, error) {
	m.call(t, h)
	m.display = name
	return m.settings, m.err
}
func (m *catalogStub) RemoveHouseholdStore(_ context.Context, t, h, id string) (HouseholdSettings, error) {
	m.call(t, h)
	m.id = id
	return m.settings, m.err
}
func catalogService(m CatalogSettingsStore) *Service {
	return NewService(nil, nil, nil, nil, nil, WithCatalogSettings(m))
}

var catalogCaller = authn.Caller{AccessToken: "caller"}

func TestCatalogEnsureCompatibility(t *testing.T) {
	zero := int32(0)
	display, category := " \ufeffMy Flour ", " custom "
	m := &catalogStub{view: CatalogView{Items: []ShoppingCatalog{{ID: "winner", NormalizedName: "flour", DisplayName: "Existing", Category: " "}}}}
	got, err := catalogService(m).EnsureCatalogIngredient(t.Context(), catalogCaller, "h", "2 cups flour", CatalogOptions{&display, &zero, &category})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]CatalogEntry{{"flour", "My Flour", &zero, "custom"}}, m.entries); diff != "" {
		t.Fatal(diff)
	}
	if got.ID != "winner" || got.DisplayName != "Existing" || got.Category != "other" || m.seed || m.token != "caller" || m.household != "h" {
		t.Fatal("lost existing metadata, caller, options or category fallback")
	}
	for _, raw := range []string{"", " \ufeff", "For sauce:"} {
		m := &catalogStub{}
		got, err := catalogService(m).EnsureCatalogIngredient(t.Context(), catalogCaller, "h", raw, CatalogOptions{})
		if err != nil || got != nil || m.calls != 0 {
			t.Fatalf("invalid name %q reached store", raw)
		}
	}
	m = &catalogStub{}
	if _, err = catalogService(m).EnsureCatalogIngredient(t.Context(), catalogCaller, "h", "flour", CatalogOptions{}); err == nil {
		t.Fatal("missing ensure acknowledgement accepted")
	}
}
func TestCatalogSeedDeduplicatesAndReportsActualInsertCount(t *testing.T) {
	m := &catalogStub{view: CatalogView{Items: []ShoppingCatalog{{NormalizedName: "milk"}}, Names: []string{"Milk", "2 cups flour", "flour", "For sauce:", "salt and pepper"}, Added: 1}}
	n, err := catalogService(m).SeedCatalogFromRecipes(t.Context(), catalogCaller, "h")
	if err != nil || n != 1 || !m.seed || m.calls != 2 {
		t.Fatal("seed count/transaction contract", err)
	}
	if diff := cmp.Diff([]CatalogEntry{{NormalizedName: "flour", DisplayName: "Flour", Category: "other"}, {NormalizedName: "salt and pepper", DisplayName: "Salt And Pepper", Category: "other"}}, m.entries); diff != "" {
		t.Fatal(diff)
	}
	for _, source := range []CatalogView{{Names: []string{"For sauce:"}}, {Items: []ShoppingCatalog{{NormalizedName: "milk"}}, Names: []string{"milk"}}, {Names: make([]string, 10001)}} {
		m := &catalogStub{view: source}
		_, err := catalogService(m).SeedCatalogFromRecipes(t.Context(), catalogCaller, "h")
		if m.calls != 1 || (len(source.Names) > 10000) != (err != nil) {
			t.Fatal("empty/oversized source reached write")
		}
	}
}
func TestCatalogSettingsFailuresAndCallerScope(t *testing.T) {
	operations := map[string]func(*Service, string) error{
		"catalog": func(s *Service, h string) error { _, e := s.GetCatalog(t.Context(), catalogCaller, h); return e },
		"ensure": func(s *Service, h string) error {
			_, e := s.EnsureCatalogIngredient(t.Context(), catalogCaller, h, "flour", CatalogOptions{})
			return e
		},
		"seed": func(s *Service, h string) error {
			_, e := s.SeedCatalogFromRecipes(t.Context(), catalogCaller, h)
			return e
		},
		"edit": func(s *Service, h string) error {
			_, e := s.UpdateCatalogIngredient(t.Context(), catalogCaller, h, "id", " Name ", "")
			return e
		},
		"delete ingredient": func(s *Service, h string) error {
			return s.RemoveCatalogIngredient(t.Context(), catalogCaller, h, "id")
		},
		"aisles": func(s *Service, h string) error {
			_, e := s.GetHouseholdAisles(t.Context(), catalogCaller, h)
			return e
		},
		"add aisle": func(s *Service, h string) error {
			_, e := s.CreateHouseholdAisle(t.Context(), catalogCaller, h, " Other ")
			return e
		},
		"delete aisle": func(s *Service, h string) error {
			_, e := s.RemoveHouseholdAisle(t.Context(), catalogCaller, h, "custom")
			return e
		},
		"order": func(s *Service, h string) error {
			_, e := s.SaveHouseholdAisleOrder(t.Context(), catalogCaller, h, "revision", []string{"custom", "other"})
			return e
		},
		"settings": func(s *Service, h string) error {
			_, e := s.GetHouseholdSettings(t.Context(), catalogCaller, h)
			return e
		},
		"add store": func(s *Service, h string) error {
			_, e := s.AddHouseholdStore(t.Context(), catalogCaller, h, " Store ")
			return e
		},
		"delete store": func(s *Service, h string) error {
			_, e := s.RemoveHouseholdStore(t.Context(), catalogCaller, h, "id")
			return e
		},
	}
	for name, op := range operations {
		t.Run(name, func(t *testing.T) {
			m := &catalogStub{view: CatalogView{Items: []ShoppingCatalog{{ID: "id"}}}}
			if err := op(catalogService(m), "h"); err != nil {
				t.Fatal(err)
			}
			if m.token != "caller" || m.household != "h" {
				t.Fatal("lost caller scope")
			}
			m = &catalogStub{err: errors.New("secret upstream detail")}
			err := op(catalogService(m), "h")
			var publicError *Error
			if !errors.As(err, &publicError) || strings.Contains(publicError.Message, "secret") || !errors.Is(err, m.err) {
				t.Fatal("missing or unsafe error")
			}
			if m.calls != 1 {
				t.Fatal("failure continued into another operation")
			}
			m = &catalogStub{}
			if op(catalogService(m), "\ufeff ") == nil || m.calls != 0 {
				t.Fatal("blank household accepted")
			}
			if op(catalogService(nil), "h") == nil {
				t.Fatal("missing dependency accepted")
			}
		})
	}
}
func TestAisleAndStoreValidation(t *testing.T) {
	for label, want := range map[string]string{"Other": "aisle_other", "酒": "aisle", "Dairy & Eggs": "dairy_eggs", strings.Repeat("a", 60): strings.Repeat("a", 48)} {
		m := &catalogStub{}
		_, err := catalogService(m).CreateHouseholdAisle(t.Context(), catalogCaller, "h", label)
		if err != nil || m.id != want {
			t.Fatalf("slug %q: %q %v", label, m.id, err)
		}
	}
	m := &catalogStub{}
	s := catalogService(m)
	for _, keys := range [][]string{nil, {"other", "other"}, {""}, make([]string, 1001)} {
		if _, err := s.SaveHouseholdAisleOrder(t.Context(), catalogCaller, "h", "r", keys); err == nil {
			t.Fatal("invalid order accepted")
		}
	}
	if _, err := s.SaveHouseholdAisleOrder(t.Context(), catalogCaller, "h", "", []string{"other"}); err == nil {
		t.Fatal("missing revision accepted")
	}
	for _, key := range []string{"", "other"} {
		if _, err := s.RemoveHouseholdAisle(t.Context(), catalogCaller, "h", key); err == nil {
			t.Fatal("reserved/empty key accepted")
		}
	}
	if _, err := s.AddHouseholdStore(t.Context(), catalogCaller, "h", "\ufeff "); err == nil {
		t.Fatal("blank store accepted")
	}
	if _, err := s.RemoveHouseholdStore(t.Context(), catalogCaller, "h", ""); err == nil {
		t.Fatal("empty id accepted")
	}
	if _, err := s.CreateHouseholdAisle(t.Context(), catalogCaller, "h", " "); err == nil {
		t.Fatal("blank aisle accepted")
	}
	if _, err := s.UpdateCatalogIngredient(t.Context(), catalogCaller, "h", "id", " ", "other"); err == nil {
		t.Fatal("blank display accepted")
	}
	if err := s.RemoveCatalogIngredient(t.Context(), catalogCaller, "h", ""); err == nil {
		t.Fatal("empty ingredient accepted")
	}
	if m.calls != 0 {
		t.Fatal("invalid input reached storage")
	}
}
