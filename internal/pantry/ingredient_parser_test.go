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
