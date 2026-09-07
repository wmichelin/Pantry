package rpcapi

import (
	"context"

	"connectrpc.com/connect"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
)

func recipeCaller(ctx context.Context) (authn.Caller, error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return caller, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	return caller, nil
}
func textList(values []string) *pantryv1.RecipeTextList {
	if values == nil {
		return nil
	}
	return &pantryv1.RecipeTextList{Values: values}
}
func (s *Server) ListRecipes(ctx context.Context, r *connect.Request[pantryv1.ListRecipesRequest]) (*connect.Response[pantryv1.ListRecipesResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.service.ListRecipes(ctx, caller, r.Msg.HouseholdId)
	if err != nil {
		return nil, s.serviceError(ctx, "list recipes", err)
	}
	response := &pantryv1.ListRecipesResponse{}
	for _, row := range rows {
		response.Recipes = append(response.Recipes, &pantryv1.RecipeSummary{Id: row.ID, Title: row.Title, Tags: textList(row.Tags), SourceUrl: row.SourceURL})
	}
	return connect.NewResponse(response), nil
}
func (s *Server) GetRecipe(ctx context.Context, r *connect.Request[pantryv1.GetRecipeRequest]) (*connect.Response[pantryv1.GetRecipeResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.service.GetRecipe(ctx, caller, r.Msg.RecipeId)
	if err != nil {
		return nil, s.serviceError(ctx, "get recipe", err)
	}
	response := &pantryv1.GetRecipeResponse{Recipe: &pantryv1.RecipeDetail{
		Id: row.ID, Title: row.Title, HouseholdId: row.HouseholdID, CreatedAt: row.CreatedAt, SourceType: row.SourceType,
		SourceUrl: row.SourceURL, ImageUrl: row.ImageURL, Servings: row.Servings, PrepTimeMinutes: row.PrepTimeMinutes,
		CookTimeMinutes: row.CookTimeMinutes, Instructions: textList(row.Instructions), Tags: textList(row.Tags),
	}}
	for _, ingredient := range row.Ingredients {
		response.Ingredients = append(response.Ingredients, &pantryv1.StoredRecipeIngredient{Id: ingredient.ID, Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: ingredient.Unit})
	}
	return connect.NewResponse(response), nil
}
func (s *Server) SearchRecipeIngredients(ctx context.Context, r *connect.Request[pantryv1.SearchRecipeIngredientsRequest]) (*connect.Response[pantryv1.SearchRecipeIngredientsResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := s.service.SearchRecipeIngredients(ctx, caller, r.Msg.HouseholdId, r.Msg.Query)
	if err != nil {
		return nil, s.serviceError(ctx, "search ingredients", err)
	}
	return connect.NewResponse(&pantryv1.SearchRecipeIngredientsResponse{RecipeIds: ids}), nil
}
func (s *Server) UpdateRecipeTags(ctx context.Context, r *connect.Request[pantryv1.UpdateRecipeTagsRequest]) (*connect.Response[pantryv1.UpdateRecipeTagsResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.service.UpdateRecipeTags(ctx, caller, r.Msg.RecipeId, r.Msg.Tags); err != nil {
		return nil, s.serviceError(ctx, "update recipe tags", err)
	}
	return connect.NewResponse(&pantryv1.UpdateRecipeTagsResponse{}), nil
}
func (s *Server) DeleteRecipe(ctx context.Context, r *connect.Request[pantryv1.DeleteRecipeRequest]) (*connect.Response[pantryv1.DeleteRecipeResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.service.DeleteRecipe(ctx, caller, r.Msg.RecipeId); err != nil {
		return nil, s.serviceError(ctx, "delete recipe", err)
	}
	return connect.NewResponse(&pantryv1.DeleteRecipeResponse{}), nil
}
