package rpcapi

import (
	"connectrpc.com/connect"
	"context"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
)

func (s *Server) ListQueue(ctx context.Context, r *connect.Request[pantryv1.ListQueueRequest]) (*connect.Response[pantryv1.ListQueueResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.service.ListQueue(ctx, caller, r.Msg.HouseholdId, r.Msg.RecipeId)
	if err != nil {
		return nil, s.serviceError(ctx, "list queue", err)
	}
	response := &pantryv1.ListQueueResponse{}
	for _, row := range rows {
		response.Entries = append(response.Entries, &pantryv1.QueueEntry{Id: row.ID, RecipeId: row.RecipeID, RecipeTitle: row.RecipeTitle})
	}
	return connect.NewResponse(response), nil
}
func (s *Server) AddQueueRecipe(ctx context.Context, r *connect.Request[pantryv1.AddQueueRecipeRequest]) (*connect.Response[pantryv1.AddQueueRecipeResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.service.AddQueueRecipe(ctx, caller, r.Msg.HouseholdId, r.Msg.RecipeId)
	if err != nil {
		return nil, s.serviceError(ctx, "add queue recipe", err)
	}
	return connect.NewResponse(&pantryv1.AddQueueRecipeResponse{Entry: &pantryv1.QueueEntry{Id: row.ID, RecipeId: row.RecipeID, RecipeTitle: row.RecipeTitle}}), nil
}
func (s *Server) RemoveQueueRecipe(ctx context.Context, r *connect.Request[pantryv1.RemoveQueueRecipeRequest]) (*connect.Response[pantryv1.RemoveQueueRecipeResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.service.RemoveQueueRecipe(ctx, caller, r.Msg.HouseholdId, r.Msg.RecipeId); err != nil {
		return nil, s.serviceError(ctx, "remove queue recipe", err)
	}
	return connect.NewResponse(&pantryv1.RemoveQueueRecipeResponse{}), nil
}
func (s *Server) ClearQueueAndChecks(ctx context.Context, r *connect.Request[pantryv1.ClearQueueAndChecksRequest]) (*connect.Response[pantryv1.ClearQueueAndChecksResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.service.ClearQueueAndChecks(ctx, caller, r.Msg.HouseholdId); err != nil {
		return nil, s.serviceError(ctx, "clear queue", err)
	}
	return connect.NewResponse(&pantryv1.ClearQueueAndChecksResponse{}), nil
}
