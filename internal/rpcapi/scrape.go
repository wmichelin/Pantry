package rpcapi

import (
	"context"

	"connectrpc.com/connect"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func (server *Server) ScrapeRecipe(ctx context.Context, request *connect.Request[pantryv1.ScrapeRecipeRequest]) (*connect.Response[pantryv1.ScrapeRecipeResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	result, err := server.service.ScrapeRecipe(ctx, caller, request.Msg.HouseholdId, request.Msg.Url)
	if err != nil {
		return nil, server.serviceError(ctx, "scrape recipe", err)
	}
	response := &pantryv1.ScrapeRecipeResponse{}
	if result.Recipe != nil {
		response.Result = &pantryv1.ScrapeRecipeResponse_Recipe{Recipe: scrapedRecipeToProto(*result.Recipe)}
	} else {
		board := &pantryv1.ScrapedBoard{TotalFound: result.Board.TotalFound, Recipes: make([]*pantryv1.ScrapedRecipe, len(result.Board.Recipes))}
		for index, recipe := range result.Board.Recipes {
			board.Recipes[index] = scrapedRecipeToProto(recipe)
		}
		response.Result = &pantryv1.ScrapeRecipeResponse_Board{Board: board}
	}
	return connect.NewResponse(response), nil
}

func scrapedRecipeToProto(recipe pantry.ScrapedRecipe) *pantryv1.ScrapedRecipe {
	return &pantryv1.ScrapedRecipe{
		Title: recipe.Title, SourceUrl: recipe.SourceURL, SourceType: recipe.SourceType,
		ImageUrl: recipe.ImageURL, Servings: recipe.Servings, PrepTimeMinutes: recipe.PrepTimeMinutes,
		CookTimeMinutes: recipe.CookTimeMinutes, Instructions: recipe.Instructions,
		RawIngredients: recipe.RawIngredients, SuggestedTags: recipe.SuggestedTags,
	}
}
