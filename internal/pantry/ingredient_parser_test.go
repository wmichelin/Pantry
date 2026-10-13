package pantry

import (
	"encoding/json"
	"github.com/google/go-cmp/cmp"
	"os"
	"testing"
)

func TestCatalogSharedParserFixtures(t *testing.T) {
	data, err := os.ReadFile("../../contracts/fixtures/catalog-names.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Raw, Name                 string
		Quantity                  *float64
		Unit, Normalized, Display *string
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Raw, func(t *testing.T) {
			want := ParsedIngredient{RawString: f.Raw, Name: f.Name, Quantity: f.Quantity, Unit: f.Unit}
			if diff := cmp.Diff(want, ParseIngredient(f.Raw)); diff != "" {
				t.Fatal(diff)
			}
			got, ok := catalogName(f.Raw)
			if ok != (f.Normalized != nil) {
				t.Fatal("invalid catalog name mismatch")
			}
			if ok && (got.NormalizedName != *f.Normalized || got.DisplayName != *f.Display) {
				t.Fatalf("catalog mismatch: %+v", got)
			}
		})
	}
}

func TestImportArrayParserCompatibility(t *testing.T) {
	zero := 0.0
	tests := []struct {
		name string
		raw  []string
		want []ParsedIngredient
	}{
		{
			name: "filters every section and serving line",
			raw:  []string{"For The Sauce:", "2 cups Rice", " - FOR SERVING quinoa", "0 cups Water"},
			want: []ParsedIngredient{
				{Name: "rice", Quantity: float64Pointer(2), Unit: stringPointer("cups"), RawString: "2 cups Rice"},
				{Name: "water", Quantity: &zero, Unit: stringPointer("cups"), RawString: "0 cups Water"},
			},
		},
		{
			name: "one compound split preserves expanded raw case",
			raw:  []string{"Additional Cilantro And Sesame Seeds For Topping", "salt and pepper and cumin"},
			want: []ParsedIngredient{
				{Name: "cilantro", RawString: "Cilantro"},
				{Name: "sesame seeds", RawString: "Sesame Seeds"},
				{Name: "salt", RawString: "salt"},
				{Name: "pepper and cumin", RawString: "pepper and cumin"},
			},
		},
		{
			name: "quantity and comma block compound expansion",
			raw:  []string{"4 tbsp avocado oil or olive oil", "salt, pepper and cumin", "ÉCLAIR and sugar"},
			want: []ParsedIngredient{
				{Name: "avocado oil or olive oil", Quantity: float64Pointer(4), Unit: stringPointer("tbsp"), RawString: "4 tbsp avocado oil or olive oil"},
				{Name: "salt, pepper and cumin", RawString: "salt, pepper and cumin"},
				{Name: "éclair and sugar", RawString: "ÉCLAIR and sugar"},
			},
		},
		{
			name: "empty values survive parser for persistence validation",
			raw:  []string{"", "   "},
			want: []ParsedIngredient{{Name: "", RawString: ""}, {Name: "", RawString: "   "}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if diff := cmp.Diff(tt.want, ParseIngredients(tt.raw)); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestImportArraySharedFixtures(t *testing.T) {
	data, err := os.ReadFile("../../contracts/fixtures/import-ingredients.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Raw    []string
		Parsed []ParsedIngredient
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for index, fixture := range fixtures {
		if diff := cmp.Diff(fixture.Parsed, ParseIngredients(fixture.Raw)); diff != "" {
			t.Fatalf("fixture %d mismatch (-legacy +Go):\n%s", index, diff)
		}
	}
}

func float64Pointer(value float64) *float64 { return &value }
func stringPointer(value string) *string    { return &value }
