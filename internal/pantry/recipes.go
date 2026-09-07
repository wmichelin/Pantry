package pantry

import (
	"context"
	"errors"
	"strings"

	"github.com/wmichelin/Pantry/internal/authn"
)

type RecipeSummary struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	SourceURL *string  `json:"source_url"`
}

type StoredRecipeIngredient struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Quantity *float64 `json:"quantity"`
	Unit     *string  `json:"unit"`
}

type RecipeDetail struct {
	ID              string                   `json:"id"`
	Title           string                   `json:"title"`
	HouseholdID     string                   `json:"household_id"`
	CreatedAt       string                   `json:"created_at"`
	SourceType      string                   `json:"source_type"`
	SourceURL       *string                  `json:"source_url"`
	ImageURL        *string                  `json:"image_url"`
	Servings        *int32                   `json:"servings"`
	PrepTimeMinutes *int32                   `json:"prep_time_minutes"`
	CookTimeMinutes *int32                   `json:"cook_time_minutes"`
	Instructions    []string                 `json:"instructions"`
	Tags            []string                 `json:"tags"`
	Ingredients     []StoredRecipeIngredient `json:"recipe_ingredients"`
}

type RecipeManager interface {
	ListRecipes(context.Context, string, string) ([]RecipeSummary, error)
	GetRecipe(context.Context, string, string) (*RecipeDetail, error)
	SearchRecipeIngredients(context.Context, string, string, string) ([]string, error)
	UpdateRecipeTags(context.Context, string, string, []string) (bool, error)
	DeleteRecipe(context.Context, string, string) (bool, error)
}

func (s *Service) ListRecipes(ctx context.Context, caller authn.Caller, householdID string) ([]RecipeSummary, error) {
	if strings.TrimSpace(householdID) == "" {
		return nil, invalid("A household is required.")
	}
	if s.recipeManager == nil {
		return nil, unavailable("Recipe management is unavailable.", errors.New("recipe manager not configured"))
	}
	rows, err := s.recipeManager.ListRecipes(ctx, caller.AccessToken, householdID)
	if err != nil {
		return nil, unavailable("Pantry could not load recipes right now.", err)
	}
	return rows, nil
}
func (s *Service) GetRecipe(ctx context.Context, caller authn.Caller, recipeID string) (*RecipeDetail, error) {
	if strings.TrimSpace(recipeID) == "" {
		return nil, invalid("A recipe is required.")
	}
	if s.recipeManager == nil {
		return nil, unavailable("Recipe management is unavailable.", errors.New("recipe manager not configured"))
	}
	recipe, err := s.recipeManager.GetRecipe(ctx, caller.AccessToken, recipeID)
	if err != nil {
		return nil, unavailable("Pantry could not load the recipe right now.", err)
	}
	if recipe == nil {
		return nil, recipeNotFound()
	}
	return recipe, nil
}
func (s *Service) SearchRecipeIngredients(ctx context.Context, caller authn.Caller, householdID, query string) ([]string, error) {
	if strings.TrimSpace(householdID) == "" {
		return nil, invalid("A household is required.")
	}
	if s.recipeManager == nil {
		return nil, unavailable("Recipe management is unavailable.", errors.New("recipe manager not configured"))
	}
	ids, err := s.recipeManager.SearchRecipeIngredients(ctx, caller.AccessToken, householdID, query)
	if err != nil {
		return nil, unavailable("Pantry could not search ingredients right now.", err)
	}
	return ids, nil
}
func (s *Service) UpdateRecipeTags(ctx context.Context, caller authn.Caller, recipeID string, tags []string) error {
	if strings.TrimSpace(recipeID) == "" {
		return invalid("A recipe is required.")
	}
	if s.recipeManager == nil {
		return unavailable("Recipe management is unavailable.", errors.New("recipe manager not configured"))
	}
	found, err := s.recipeManager.UpdateRecipeTags(ctx, caller.AccessToken, recipeID, append([]string{}, tags...))
	if err != nil {
		return unavailable("Pantry could not save tags right now.", err)
	}
	if !found {
		return recipeNotFound()
	}
	return nil
}
func (s *Service) DeleteRecipe(ctx context.Context, caller authn.Caller, recipeID string) error {
	if strings.TrimSpace(recipeID) == "" {
		return invalid("A recipe is required.")
	}
	if s.recipeManager == nil {
		return unavailable("Recipe management is unavailable.", errors.New("recipe manager not configured"))
	}
	found, err := s.recipeManager.DeleteRecipe(ctx, caller.AccessToken, recipeID)
	if err != nil {
		return unavailable("Pantry could not delete the recipe right now.", err)
	}
	if !found {
		return recipeNotFound()
	}
	return nil
}
func recipeNotFound() *Error {
	return &Error{Kind: ErrorNotFound, Code: "recipe_not_found", Message: "Recipe not found."}
}
