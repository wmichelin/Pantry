package pantry

import (
	"context"
	"errors"
	"github.com/wmichelin/Pantry/internal/authn"
	"regexp"
	"strings"
)

type CatalogView struct {
	Items []ShoppingCatalog `json:"items"`
	Names []string          `json:"names,omitempty"`
	Added int32             `json:"added"`
}
type CatalogEntry struct {
	NormalizedName string `json:"normalized_name"`
	DisplayName    string `json:"display_name"`
	SortOrder      *int32 `json:"sort_order,omitempty"`
	Category       string `json:"category"`
}
type CatalogOptions struct {
	DisplayName *string
	SortOrder   *int32
	Category    *string
}
type AisleView struct {
	Aisles   []ShoppingAisle `json:"aisles"`
	Revision string          `json:"revision"`
}
type SettingsMember struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}
type SettingsStore struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int32  `json:"sort_order"`
}
type HouseholdSettings struct {
	Household *CreatedHousehold `json:"household"`
	Members   []SettingsMember  `json:"members"`
	Stores    []SettingsStore   `json:"stores"`
}
type CatalogSettingsStore interface {
	GetCatalog(context.Context, string, string) (CatalogView, error)
	CatalogSeedSource(context.Context, string, string) (CatalogView, error)
	EnsureCatalogEntries(context.Context, string, string, []CatalogEntry, bool) (CatalogView, error)
	UpdateCatalogIngredient(context.Context, string, string, string, string, string) (ShoppingCatalog, error)
	RemoveCatalogIngredient(context.Context, string, string, string) error
	GetHouseholdAisles(context.Context, string, string) (AisleView, error)
	CreateHouseholdAisle(context.Context, string, string, string, string) (AisleView, error)
	RemoveHouseholdAisle(context.Context, string, string, string) (AisleView, error)
	SaveHouseholdAisleOrder(context.Context, string, string, string, []string) (AisleView, error)
	GetHouseholdSettings(context.Context, string, string) (HouseholdSettings, error)
	AddHouseholdStore(context.Context, string, string, string) (HouseholdSettings, error)
	RemoveHouseholdStore(context.Context, string, string, string) (HouseholdSettings, error)
}

func (s *Service) catalogSettingsReady(h string) error {
	if strings.Trim(h, jsTrim) == "" {
		return invalid("A household is required.")
	}
	if s.catalogSettings == nil {
		return unavailable("Catalog/settings unavailable.", errors.New("catalog/settings store missing"))
	}
	return nil
}
func (s *Service) GetCatalog(ctx context.Context, c authn.Caller, h string) (CatalogView, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return CatalogView{}, err
	}
	v, err := s.catalogSettings.GetCatalog(ctx, c.AccessToken, h)
	if err != nil {
		return CatalogView{}, unavailable("Pantry could not load the catalog.", err)
	}
	for i := range v.Items {
		v.Items[i].Category = shoppingCategory(v.Items[i].Category)
	}
	return v, nil
}
func (s *Service) EnsureCatalogIngredient(ctx context.Context, c authn.Caller, h, raw string, options CatalogOptions) (*ShoppingCatalog, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return nil, err
	}
	cleaned, ok := catalogName(raw)
	if !ok {
		return nil, nil
	}
	display := cleaned.DisplayName
	if options.DisplayName != nil && strings.Trim(*options.DisplayName, jsTrim) != "" {
		display = strings.Trim(*options.DisplayName, jsTrim)
	}
	category := "other"
	if options.Category != nil {
		category = shoppingCategory(*options.Category)
	}
	v, err := s.catalogSettings.EnsureCatalogEntries(ctx, c.AccessToken, h, []CatalogEntry{{cleaned.NormalizedName, display, options.SortOrder, category}}, false)
	if err != nil {
		return nil, unavailable("Pantry could not prepare the catalog ingredient.", err)
	}
	if len(v.Items) != 1 {
		return nil, unavailable("Pantry returned no catalog ingredient.", errors.New("invalid ensure result"))
	}
	v.Items[0].Category = shoppingCategory(v.Items[0].Category)
	return &v.Items[0], nil
}
func (s *Service) SeedCatalogFromRecipes(ctx context.Context, c authn.Caller, h string) (int32, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return 0, err
	}
	source, err := s.catalogSettings.CatalogSeedSource(ctx, c.AccessToken, h)
	if err != nil {
		return 0, unavailable("Pantry could not load recipe names.", err)
	}
	if len(source.Names) > 10000 {
		return 0, invalid("Too many recipe names to seed.")
	}
	seen := map[string]bool{}
	for _, m := range source.Items {
		seen[m.NormalizedName] = true
	}
	entries := []CatalogEntry{}
	for _, name := range source.Names {
		if cleaned, ok := catalogName(name); ok && !seen[cleaned.NormalizedName] {
			seen[cleaned.NormalizedName] = true
			entries = append(entries, CatalogEntry{NormalizedName: cleaned.NormalizedName, DisplayName: cleaned.DisplayName, Category: "other"})
		}
	}
	if len(entries) == 0 {
		return 0, nil
	}
	result, err := s.catalogSettings.EnsureCatalogEntries(ctx, c.AccessToken, h, entries, true)
	if err != nil {
		return 0, unavailable("Pantry could not seed the catalog.", err)
	}
	return result.Added, nil
}
func (s *Service) UpdateCatalogIngredient(ctx context.Context, c authn.Caller, h, id, display, category string) (ShoppingCatalog, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return ShoppingCatalog{}, err
	}
	display = strings.Trim(display, jsTrim)
	if id == "" || display == "" {
		return ShoppingCatalog{}, invalid("An ingredient and display name are required.")
	}
	item, err := s.catalogSettings.UpdateCatalogIngredient(ctx, c.AccessToken, h, id, display, shoppingCategory(category))
	if err != nil {
		return ShoppingCatalog{}, unavailable("Pantry could not update the ingredient.", err)
	}
	item.Category = shoppingCategory(item.Category)
	return item, nil
}
func (s *Service) RemoveCatalogIngredient(ctx context.Context, c authn.Caller, h, id string) error {
	if err := s.catalogSettingsReady(h); err != nil {
		return err
	}
	if id == "" {
		return invalid("An ingredient is required.")
	}
	if err := s.catalogSettings.RemoveCatalogIngredient(ctx, c.AccessToken, h, id); err != nil {
		return unavailable("Pantry could not remove the catalog ingredient.", err)
	}
	return nil
}
func (s *Service) GetHouseholdAisles(ctx context.Context, c authn.Caller, h string) (AisleView, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return AisleView{}, err
	}
	v, err := s.catalogSettings.GetHouseholdAisles(ctx, c.AccessToken, h)
	if err != nil {
		return AisleView{}, unavailable("Pantry could not load aisles.", err)
	}
	return v, nil
}

var aisleNonASCII = regexp.MustCompile(`[^a-z0-9]+`)

func aisleKey(label string) string {
	key := strings.Trim(aisleNonASCII.ReplaceAllString(normalizeShoppingName(label), "_"), "_")
	if len(key) > 48 {
		key = key[:48]
	}
	if key == "" {
		key = "aisle"
	}
	if key == "other" {
		key = "aisle_other"
	}
	return key
}
func (s *Service) CreateHouseholdAisle(ctx context.Context, c authn.Caller, h, label string) (AisleView, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return AisleView{}, err
	}
	label = strings.Trim(label, jsTrim)
	if label == "" {
		return AisleView{}, invalid("An aisle name is required.")
	}
	v, err := s.catalogSettings.CreateHouseholdAisle(ctx, c.AccessToken, h, label, aisleKey(label))
	if err != nil {
		return AisleView{}, unavailable("Pantry could not create the aisle.", err)
	}
	return v, nil
}
func (s *Service) RemoveHouseholdAisle(ctx context.Context, c authn.Caller, h, key string) (AisleView, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return AisleView{}, err
	}
	if key == "" || key == "other" {
		return AisleView{}, invalid("The Other aisle cannot be removed.")
	}
	v, err := s.catalogSettings.RemoveHouseholdAisle(ctx, c.AccessToken, h, key)
	if err != nil {
		return AisleView{}, unavailable("Pantry could not remove the aisle.", err)
	}
	return v, nil
}
func (s *Service) SaveHouseholdAisleOrder(ctx context.Context, c authn.Caller, h, revision string, keys []string) (AisleView, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return AisleView{}, err
	}
	if revision == "" || len(keys) == 0 || len(keys) > 1000 {
		return AisleView{}, invalid("An aisle snapshot and bounded complete order are required.")
	}
	seen := map[string]bool{}
	for _, key := range keys {
		if key == "" || seen[key] {
			return AisleView{}, invalid("Aisle order contains an empty or duplicate key.")
		}
		seen[key] = true
	}
	// SQL validates the loaded revision and full authoritative keyset atomically.
	v, err := s.catalogSettings.SaveHouseholdAisleOrder(ctx, c.AccessToken, h, revision, keys)
	if err != nil {
		return AisleView{}, unavailable("Pantry could not save aisle order; reload before retrying.", err)
	}
	return v, nil
}
func (s *Service) GetHouseholdSettings(ctx context.Context, c authn.Caller, h string) (HouseholdSettings, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return HouseholdSettings{}, err
	}
	v, err := s.catalogSettings.GetHouseholdSettings(ctx, c.AccessToken, h)
	if err != nil {
		return HouseholdSettings{}, unavailable("Pantry could not load household settings.", err)
	}
	return v, nil
}
func (s *Service) AddHouseholdStore(ctx context.Context, c authn.Caller, h, name string) (HouseholdSettings, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return HouseholdSettings{}, err
	}
	name = strings.Trim(name, jsTrim)
	if name == "" {
		return HouseholdSettings{}, invalid("A store name is required.")
	}
	v, err := s.catalogSettings.AddHouseholdStore(ctx, c.AccessToken, h, name)
	if err != nil {
		return HouseholdSettings{}, unavailable("Pantry could not add the store.", err)
	}
	return v, nil
}
func (s *Service) RemoveHouseholdStore(ctx context.Context, c authn.Caller, h, id string) (HouseholdSettings, error) {
	if err := s.catalogSettingsReady(h); err != nil {
		return HouseholdSettings{}, err
	}
	if id == "" {
		return HouseholdSettings{}, invalid("A store is required.")
	}
	v, err := s.catalogSettings.RemoveHouseholdStore(ctx, c.AccessToken, h, id)
	if err != nil {
		return HouseholdSettings{}, unavailable("Pantry could not remove the store.", err)
	}
	return v, nil
}
