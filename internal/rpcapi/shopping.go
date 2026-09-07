package rpcapi

import (
	"connectrpc.com/connect"
	"context"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func (s *Server) SetShoppingItemChecked(ctx context.Context, r *connect.Request[pantryv1.SetShoppingItemCheckedRequest]) (*connect.Response[pantryv1.SetShoppingItemCheckedResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	err = s.service.SetShoppingItemChecked(ctx, caller, pantry.ShoppingCheck{HouseholdID: r.Msg.HouseholdId, NormalizedName: r.Msg.NormalizedName, StandaloneManual: r.Msg.StandaloneManual, Checked: r.Msg.Checked})
	if err != nil {
		return nil, s.serviceError(ctx, "set shopping check", err)
	}
	return connect.NewResponse(&pantryv1.SetShoppingItemCheckedResponse{}), nil
}
func (s *Server) ClearShoppingChecks(ctx context.Context, r *connect.Request[pantryv1.ClearShoppingChecksRequest]) (*connect.Response[pantryv1.ClearShoppingChecksResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	if err = s.service.ClearShoppingChecks(ctx, caller, r.Msg.HouseholdId); err != nil {
		return nil, s.serviceError(ctx, "clear shopping checks", err)
	}
	return connect.NewResponse(&pantryv1.ClearShoppingChecksResponse{}), nil
}
func (s *Server) ClearShoppingWeek(ctx context.Context, r *connect.Request[pantryv1.ClearShoppingWeekRequest]) (*connect.Response[pantryv1.ClearShoppingWeekResponse], error) {
	caller, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	if err = s.service.ClearShoppingWeek(ctx, caller, r.Msg.HouseholdId); err != nil {
		return nil, s.serviceError(ctx, "clear shopping week", err)
	}
	return connect.NewResponse(&pantryv1.ClearShoppingWeekResponse{}), nil
}
