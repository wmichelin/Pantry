package rpcapi

import (
	"connectrpc.com/connect"
	"context"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func shoppingListProto(list pantry.ShoppingList) *pantryv1.ShoppingList {
	out := &pantryv1.ShoppingList{Revision: list.Revision}
	for _, item := range list.Items {
		row := &pantryv1.ShoppingItem{ListKey: item.ListKey, NormalizedName: item.NormalizedName, DisplayName: item.DisplayName, MetadataId: item.MetadataID, SortOrder: item.SortOrder, Category: item.Category, Checked: item.Checked, IsManual: item.IsManual, ManualItemId: item.ManualItemID}
		for _, o := range item.Occurrences {
			row.Occurrences = append(row.Occurrences, &pantryv1.ShoppingOccurrence{RecipeTitle: o.RecipeTitle, Quantity: o.Quantity, Unit: o.Unit})
		}
		out.Items = append(out.Items, row)
	}
	for _, m := range list.Catalog {
		out.Catalog = append(out.Catalog, &pantryv1.ShoppingCatalogItem{Id: m.ID, NormalizedName: m.NormalizedName, DisplayName: m.DisplayName, SortOrder: m.SortOrder, Category: m.Category})
	}
	for _, a := range list.Aisles {
		out.Aisles = append(out.Aisles, &pantryv1.ShoppingAisle{Key: a.Key, Label: a.Label, SortOrder: a.SortOrder})
	}
	return out
}
func (s *Server) GetShoppingList(ctx context.Context, r *connect.Request[pantryv1.GetShoppingListRequest]) (*connect.Response[pantryv1.GetShoppingListResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.service.GetShoppingList(ctx, c, r.Msg.HouseholdId)
	if err != nil {
		return nil, s.serviceError(ctx, "get shopping list", err)
	}
	return connect.NewResponse(&pantryv1.GetShoppingListResponse{List: shoppingListProto(list)}), nil
}
func (s *Server) AddShoppingManualItem(ctx context.Context, r *connect.Request[pantryv1.AddShoppingManualItemRequest]) (*connect.Response[pantryv1.AddShoppingManualItemResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.service.AddShoppingManualItem(ctx, c, r.Msg.HouseholdId, r.Msg.Name)
	if err != nil {
		return nil, s.serviceError(ctx, "add shopping manual", err)
	}
	return connect.NewResponse(&pantryv1.AddShoppingManualItemResponse{List: shoppingListProto(list)}), nil
}
func (s *Server) RemoveShoppingManualItem(ctx context.Context, r *connect.Request[pantryv1.RemoveShoppingManualItemRequest]) (*connect.Response[pantryv1.RemoveShoppingManualItemResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.service.RemoveShoppingManualItem(ctx, c, r.Msg.HouseholdId, r.Msg.ManualItemId)
	if err != nil {
		return nil, s.serviceError(ctx, "remove shopping manual", err)
	}
	return connect.NewResponse(&pantryv1.RemoveShoppingManualItemResponse{List: shoppingListProto(list)}), nil
}
func (s *Server) SaveShoppingOrder(ctx context.Context, r *connect.Request[pantryv1.SaveShoppingOrderRequest]) (*connect.Response[pantryv1.SaveShoppingOrderResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	rows := make([]pantry.ShoppingOrderRow, 0, len(r.Msg.Rows))
	for _, row := range r.Msg.Rows {
		if row == nil {
			rows = append(rows, pantry.ShoppingOrderRow{})
		} else {
			rows = append(rows, pantry.ShoppingOrderRow{ListKey: row.ListKey, Category: row.Category})
		}
	}
	list, err := s.service.SaveShoppingOrder(ctx, c, r.Msg.HouseholdId, r.Msg.Revision, rows)
	if err != nil {
		return nil, s.serviceError(ctx, "save shopping order", err)
	}
	return connect.NewResponse(&pantryv1.SaveShoppingOrderResponse{List: shoppingListProto(list)}), nil
}
