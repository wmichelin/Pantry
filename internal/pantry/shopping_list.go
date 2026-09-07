package pantry

import (
	"context"
	"errors"
	"github.com/wmichelin/Pantry/internal/authn"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"math"
	"sort"
	"strings"
)

const jsTrim = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

func normalizeShoppingName(s string) string {
	return strings.Trim(cases.Lower(language.Und).String(s), jsTrim)
}
func shoppingCategory(s string) string {
	s = strings.Trim(s, jsTrim)
	if s == "" {
		return "other"
	}
	return s
}

// JavaScript /\b\w/g uses ASCII word boundaries, not Unicode title casing.
func shoppingTitle(s string) string {
	prevWord := false
	return strings.Map(func(r rune) rune {
		word := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_'
		out := r
		if word && !prevWord && r >= 'a' && r <= 'z' {
			out = r - 'a' + 'A'
		}
		prevWord = word
		return out
	}, s)
}

type ShoppingOccurrence struct {
	RecipeTitle string   `json:"recipe_title"`
	Quantity    *float64 `json:"quantity"`
	Unit        *string  `json:"unit"`
}
type ShoppingIngredient struct {
	Name string `json:"name"`
	ShoppingOccurrence
}
type ShoppingManual struct {
	ID             string   `json:"id"`
	NormalizedName string   `json:"normalized_name"`
	Quantity       *float64 `json:"quantity"`
	Unit           *string  `json:"unit"`
	SortOrder      *int32   `json:"sort_order"`
}
type ShoppingCatalog struct {
	ID             string `json:"id"`
	NormalizedName string `json:"normalized_name"`
	DisplayName    string `json:"display_name"`
	SortOrder      int32  `json:"sort_order"`
	Category       string `json:"category"`
}
type ShoppingAisle struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	SortOrder int32  `json:"sort_order"`
}
type ShoppingSnapshot struct {
	Revision    string               `json:"revision"`
	Ingredients []ShoppingIngredient `json:"ingredients"`
	Manuals     []ShoppingManual     `json:"manuals"`
	Catalog     []ShoppingCatalog    `json:"catalog"`
	Checks      []string             `json:"checks"`
	Aisles      []ShoppingAisle      `json:"aisles"`
}
type ShoppingItem struct {
	ListKey        string               `json:"list_key"`
	NormalizedName string               `json:"normalized_name"`
	DisplayName    string               `json:"display_name"`
	MetadataID     string               `json:"metadata_id"`
	SortOrder      *int32               `json:"sort_order"`
	Category       string               `json:"category"`
	Occurrences    []ShoppingOccurrence `json:"occurrences"`
	Checked        bool                 `json:"checked"`
	IsManual       bool                 `json:"is_manual"`
	ManualItemID   string               `json:"manual_item_id"`
}
type ShoppingList struct {
	Revision string
	Items    []ShoppingItem
	Catalog  []ShoppingCatalog
	Aisles   []ShoppingAisle
}
type ShoppingCatalogSeed struct {
	NormalizedName string `json:"normalized_name"`
	DisplayName    string `json:"display_name"`
}
type ShoppingOrderRow struct {
	ListKey  string
	Category string
}
type ShoppingMetadataOrder struct {
	ID        string `json:"id"`
	SortOrder int32  `json:"sort_order"`
	Category  string `json:"category"`
}
type ShoppingManualOrder struct {
	ID        string `json:"id"`
	SortOrder int32  `json:"sort_order"`
}
type ShoppingListStore interface {
	ShoppingSnapshot(context.Context, string, string) (ShoppingSnapshot, error)
	EnsureShoppingCatalog(context.Context, string, string, []ShoppingCatalogSeed) error
	AddShoppingManual(context.Context, string, string, string, string, string, int32) (ShoppingSnapshot, error)
	RemoveShoppingManual(context.Context, string, string, string) (ShoppingSnapshot, error)
	SaveShoppingOrder(context.Context, string, string, string, []ShoppingMetadataOrder, []ShoppingManualOrder) (ShoppingSnapshot, error)
}

func AggregateShopping(s ShoppingSnapshot) []ShoppingItem {
	meta := map[string]ShoppingCatalog{}
	for _, m := range s.Catalog {
		meta[m.NormalizedName] = m
	}
	checks := map[string]bool{}
	for _, k := range s.Checks {
		checks[k] = true
	}
	items := []ShoppingItem{}
	recipes := map[string]int{}
	base := func(key, listKey string) ShoppingItem {
		row := ShoppingItem{ListKey: listKey, NormalizedName: key, DisplayName: shoppingTitle(key), Category: "other", Occurrences: []ShoppingOccurrence{}}
		if m, ok := meta[key]; ok {
			row.DisplayName = m.DisplayName
			row.MetadataID = m.ID
			v := m.SortOrder
			row.SortOrder = &v
			row.Category = shoppingCategory(m.Category)
		}
		return row
	}
	for _, ing := range s.Ingredients {
		key := normalizeShoppingName(ing.Name)
		if strings.HasSuffix(key, ":") {
			continue
		}
		if index, ok := recipes[key]; ok {
			items[index].Occurrences = append(items[index].Occurrences, ing.ShoppingOccurrence)
		} else {
			row := base(key, "recipe:"+key)
			row.Checked = checks[key]
			row.Occurrences = append(row.Occurrences, ing.ShoppingOccurrence)
			recipes[key] = len(items)
			items = append(items, row)
		}
	}
	for _, m := range s.Manuals {
		index, hasRecipe := recipes[m.NormalizedName]
		occurrence := ShoppingOccurrence{RecipeTitle: "Added", Quantity: m.Quantity, Unit: m.Unit}
		if hasRecipe && m.Unit != nil && strings.Trim(*m.Unit, jsTrim) != "" {
			items[index].Occurrences = append(items[index].Occurrences, occurrence)
			items[index].IsManual = true
			items[index].ManualItemID = m.ID
			continue
		}
		row := base(m.NormalizedName, "manual:"+m.ID)
		row.IsManual = true
		row.ManualItemID = m.ID
		if m.SortOrder != nil {
			row.SortOrder = m.SortOrder
		}
		row.Checked = checks[m.NormalizedName+"::manual"] || !hasRecipe && checks[m.NormalizedName]
		if m.Quantity != nil || m.Unit != nil && *m.Unit != "" {
			row.Occurrences = append(row.Occurrences, occurrence)
		}
		items = append(items, row)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].SortOrder == nil {
			return false
		}
		if items[j].SortOrder == nil {
			return true
		}
		return *items[i].SortOrder < *items[j].SortOrder
	})
	return items
}
func shoppingListFromSnapshot(s ShoppingSnapshot) ShoppingList {
	for i := range s.Catalog {
		s.Catalog[i].Category = shoppingCategory(s.Catalog[i].Category)
	}
	return ShoppingList{Revision: s.Revision, Items: AggregateShopping(s), Catalog: s.Catalog, Aisles: s.Aisles}
}
func (s *Service) shoppingListReady(h string) error {
	if strings.TrimSpace(h) == "" {
		return invalid("A household is required.")
	}
	if s.shoppingListStore == nil {
		return unavailable("Shopping list unavailable.", errors.New("shopping store not configured"))
	}
	return nil
}
func (s *Service) GetShoppingList(ctx context.Context, c authn.Caller, h string) (ShoppingList, error) {
	if err := s.shoppingListReady(h); err != nil {
		return ShoppingList{}, err
	}
	snapshot, err := s.shoppingListStore.ShoppingSnapshot(ctx, c.AccessToken, h)
	if err != nil {
		return ShoppingList{}, unavailable("Pantry could not load the shopping list.", err)
	}
	items := AggregateShopping(snapshot)
	if len(items) > 10000 {
		return ShoppingList{}, invalid("Shopping list exceeds the supported 10,000 rows.")
	}
	missing := []ShoppingCatalogSeed{}
	seen := map[string]bool{}
	for _, row := range items {
		if row.MetadataID == "" && !seen[row.NormalizedName] {
			seen[row.NormalizedName] = true
			missing = append(missing, ShoppingCatalogSeed{row.NormalizedName, row.DisplayName})
		}
	}
	if len(missing) > 0 {
		if err = s.shoppingListStore.EnsureShoppingCatalog(ctx, c.AccessToken, h, missing); err != nil {
			return ShoppingList{}, unavailable("Pantry could not prepare the shopping catalog.", err)
		}
		snapshot, err = s.shoppingListStore.ShoppingSnapshot(ctx, c.AccessToken, h)
		if err != nil {
			return ShoppingList{}, unavailable("Pantry could not reload the shopping list.", err)
		}
		items = AggregateShopping(snapshot)
		if len(items) > 10000 {
			return ShoppingList{}, invalid("Shopping list exceeds the supported 10,000 rows.")
		}
		for _, row := range items {
			if row.MetadataID == "" {
				return ShoppingList{}, invalid("Shopping list changed while preparing the catalog; reload.")
			}
		}
	}
	return shoppingListFromSnapshot(snapshot), nil
}
func (s *Service) AddShoppingManualItem(ctx context.Context, c authn.Caller, h, name string) (ShoppingList, error) {
	key := normalizeShoppingName(name)
	if key == "" || strings.HasSuffix(key, ":") {
		return ShoppingList{}, invalid("An item name is required; section headers are not items.")
	}
	list, err := s.GetShoppingList(ctx, c, h)
	if err != nil {
		return ShoppingList{}, err
	}
	if len(list.Items) >= 10000 {
		readd := false
		for _, row := range list.Items {
			if row.NormalizedName == key && row.IsManual {
				readd = true
			}
		}
		if !readd {
			return ShoppingList{}, invalid("Shopping list limit reached; remove an item first.")
		}
	}
	next := int64(10)
	hasOrder := false
	for _, row := range list.Items {
		if row.SortOrder != nil && (!hasOrder || int64(*row.SortOrder)-10 < next) {
			next = int64(*row.SortOrder) - 10
			hasOrder = true
		}
	}
	if next < math.MinInt32 {
		return ShoppingList{}, invalid("Shopping order limit reached; sort the list first.")
	}
	display := strings.Trim(name, jsTrim)
	if display == key {
		display = shoppingTitle(key)
	}
	snapshot, err := s.shoppingListStore.AddShoppingManual(ctx, c.AccessToken, h, list.Revision, key, display, int32(next))
	if err != nil {
		return ShoppingList{}, unavailable("Pantry could not add the item; reload before retrying.", err)
	}
	return shoppingListFromSnapshot(snapshot), nil
}
func (s *Service) RemoveShoppingManualItem(ctx context.Context, c authn.Caller, h, id string) (ShoppingList, error) {
	if err := s.shoppingListReady(h); err != nil {
		return ShoppingList{}, err
	}
	if id == "" {
		return ShoppingList{}, invalid("A manual item is required.")
	}
	snapshot, err := s.shoppingListStore.RemoveShoppingManual(ctx, c.AccessToken, h, id)
	if err != nil {
		return ShoppingList{}, unavailable("Pantry could not remove the item.", err)
	}
	return shoppingListFromSnapshot(snapshot), nil
}
func (s *Service) SaveShoppingOrder(ctx context.Context, c authn.Caller, h, revision string, rows []ShoppingOrderRow) (ShoppingList, error) {
	if len(rows) > 10000 || revision == "" {
		return ShoppingList{}, invalid("A bounded shopping order and revision are required.")
	}
	list, err := s.GetShoppingList(ctx, c, h)
	if err != nil {
		return ShoppingList{}, err
	}
	if list.Revision != revision || len(rows) != len(list.Items) {
		return ShoppingList{}, invalid("Shopping list changed; reload before ordering.")
	}
	byKey := map[string]ShoppingItem{}
	for _, row := range list.Items {
		byKey[row.ListKey] = row
	}
	metadata := []ShoppingMetadataOrder{}
	metaIndex := map[string]int{}
	recipePosition := map[string]int32{}
	manuals := []ShoppingManualOrder{}
	for i, row := range rows {
		item, ok := byKey[row.ListKey]
		if !ok || item.MetadataID == "" {
			return ShoppingList{}, invalid("Shopping order contains a missing or duplicate item.")
		}
		delete(byKey, row.ListKey)
		order := int32((i + 1) * 10)
		category := shoppingCategory(row.Category)
		if idx, ok := metaIndex[item.MetadataID]; ok {
			metadata[idx].Category = category
		} else {
			metaIndex[item.MetadataID] = len(metadata)
			metadata = append(metadata, ShoppingMetadataOrder{item.MetadataID, order, category})
		}
		if strings.HasPrefix(row.ListKey, "recipe:") {
			recipePosition[item.MetadataID] = order
		} else {
			manuals = append(manuals, ShoppingManualOrder{item.ManualItemID, order})
		}
	}
	for id, order := range recipePosition {
		metadata[metaIndex[id]].SortOrder = order
	}
	snapshot, err := s.shoppingListStore.SaveShoppingOrder(ctx, c.AccessToken, h, revision, metadata, manuals)
	if err != nil {
		return ShoppingList{}, unavailable("Pantry could not save the order; reload the list.", err)
	}
	return shoppingListFromSnapshot(snapshot), nil
}
