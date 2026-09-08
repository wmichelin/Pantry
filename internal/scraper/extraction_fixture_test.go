package scraper

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func TestLegacyExtractionFixture(t *testing.T) {
	var fixture struct {
		Provenance struct {
			Source       string `json:"source"`
			SourceSHA256 string `json:"source_sha256"`
		} `json:"provenance"`
		Cases []struct {
			Name       string `json:"name"`
			HTML       string `json:"html"`
			SourceURL  string `json:"source_url"`
			SourceType string `json:"source_type"`
			Expected   struct {
				Title           string   `json:"title"`
				SourceURL       string   `json:"source_url"`
				SourceType      string   `json:"source_type"`
				ImageURL        *string  `json:"image_url"`
				Servings        *int32   `json:"servings"`
				PrepTimeMinutes *int32   `json:"prep_time_minutes"`
				CookTimeMinutes *int32   `json:"cook_time_minutes"`
				Instructions    []string `json:"instructions"`
				RawIngredients  []string `json:"raw_ingredients"`
				SuggestedTags   []string `json:"suggested_tags"`
			} `json:"expected"`
		} `json:"cases"`
	}
	data, err := os.ReadFile("../../contracts/fixtures/scraper-extraction.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../../" + fixture.Provenance.Source)
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(source)); got != fixture.Provenance.SourceSHA256 {
		t.Fatalf("legacy source hash changed: got %s; regenerate and review oracle provenance", got)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("legacy extraction fixture must contain cases")
	}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			got, err := extractRecipeHTML(tc.HTML, tc.SourceURL, tc.SourceType)
			if err != nil {
				t.Fatal(err)
			}
			expected := tc.Expected
			want := pantry.ScrapedRecipe{
				Title: expected.Title, SourceURL: expected.SourceURL, SourceType: expected.SourceType,
				ImageURL: expected.ImageURL, Servings: expected.Servings,
				PrepTimeMinutes: expected.PrepTimeMinutes, CookTimeMinutes: expected.CookTimeMinutes,
				Instructions: expected.Instructions, RawIngredients: expected.RawIngredients,
				SuggestedTags: expected.SuggestedTags,
			}
			// Do not equate nil and empty: both optional presence and repeated
			// field ordering are part of the unchanged legacy wire behavior.
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatalf("legacy extraction mismatch (-legacy +Go):\n%s", diff)
			}
		})
	}
}
