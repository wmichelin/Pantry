package rpcapi

import (
	"connectrpc.com/connect"
	"context"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func catalogItemProto(v *pantry.ShoppingCatalog) *pantryv1.CatalogIngredient {
	if v == nil {
		return nil
	}
	return &pantryv1.CatalogIngredient{Id: v.ID, NormalizedName: v.NormalizedName, DisplayName: v.DisplayName, SortOrder: v.SortOrder, Category: v.Category}
}
func catalogItemsProto(items []pantry.ShoppingCatalog) []*pantryv1.CatalogIngredient {
	out := make([]*pantryv1.CatalogIngredient, 0, len(items))
	for _, item := range items {
		out = append(out, catalogItemProto(&item))
	}
	return out
}
func aisleViewProto(v pantry.AisleView) *pantryv1.HouseholdAisleView {
	out := &pantryv1.HouseholdAisleView{Revision: v.Revision}
	for _, a := range v.Aisles {
		out.Aisles = append(out.Aisles, &pantryv1.HouseholdAisle{Key: a.Key, Label: a.Label, SortOrder: a.SortOrder})
	}
	return out
}
func settingsProto(v pantry.HouseholdSettings) *pantryv1.HouseholdSettings {
	out := &pantryv1.HouseholdSettings{}
	if v.Household != nil {
		out.Household = &pantryv1.SettingsHousehold{Id: v.Household.ID, Name: v.Household.Name, InviteCode: v.Household.InviteCode}
	}
	for _, m := range v.Members {
		out.Members = append(out.Members, &pantryv1.SettingsMember{Id: m.ID, DisplayName: m.DisplayName, Role: m.Role})
	}
	for _, m := range v.Stores {
		out.Stores = append(out.Stores, &pantryv1.SettingsStore{Id: m.ID, Name: m.Name, SortOrder: m.SortOrder})
	}
	return out
}
func (s *Server) GetCatalog(ctx context.Context, r *connect.Request[pantryv1.GetCatalogRequest]) (*connect.Response[pantryv1.GetCatalogResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.GetCatalog(ctx, c, r.Msg.HouseholdId)
	if err != nil {
		return nil, s.serviceError(ctx, "GetCatalog", err)
	}
	return connect.NewResponse(&pantryv1.GetCatalogResponse{Items: catalogItemsProto(v.Items)}), nil
}
func (s *Server) EnsureCatalogIngredient(ctx context.Context, r *connect.Request[pantryv1.EnsureCatalogIngredientRequest]) (*connect.Response[pantryv1.EnsureCatalogIngredientResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.EnsureCatalogIngredient(ctx, c, r.Msg.HouseholdId, r.Msg.RawName, pantry.CatalogOptions{DisplayName: r.Msg.DisplayName, SortOrder: r.Msg.SortOrder, Category: r.Msg.Category})
	if err != nil {
		return nil, s.serviceError(ctx, "EnsureCatalogIngredient", err)
	}
	return connect.NewResponse(&pantryv1.EnsureCatalogIngredientResponse{Item: catalogItemProto(v)}), nil
}
func (s *Server) SeedCatalogFromRecipes(ctx context.Context, r *connect.Request[pantryv1.SeedCatalogFromRecipesRequest]) (*connect.Response[pantryv1.SeedCatalogFromRecipesResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.SeedCatalogFromRecipes(ctx, c, r.Msg.HouseholdId)
	if err != nil {
		return nil, s.serviceError(ctx, "SeedCatalogFromRecipes", err)
	}
	return connect.NewResponse(&pantryv1.SeedCatalogFromRecipesResponse{Added: v}), nil
}
func (s *Server) UpdateCatalogIngredient(ctx context.Context, r *connect.Request[pantryv1.UpdateCatalogIngredientRequest]) (*connect.Response[pantryv1.UpdateCatalogIngredientResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.UpdateCatalogIngredient(ctx, c, r.Msg.HouseholdId, r.Msg.IngredientId, r.Msg.DisplayName, r.Msg.Category)
	if err != nil {
		return nil, s.serviceError(ctx, "UpdateCatalogIngredient", err)
	}
	return connect.NewResponse(&pantryv1.UpdateCatalogIngredientResponse{Item: catalogItemProto(&v)}), nil
}
func (s *Server) RemoveCatalogIngredient(ctx context.Context, r *connect.Request[pantryv1.RemoveCatalogIngredientRequest]) (*connect.Response[pantryv1.RemoveCatalogIngredientResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	err = s.service.RemoveCatalogIngredient(ctx, c, r.Msg.HouseholdId, r.Msg.IngredientId)
	if err != nil {
		return nil, s.serviceError(ctx, "RemoveCatalogIngredient", err)
	}
	return connect.NewResponse(&pantryv1.RemoveCatalogIngredientResponse{}), nil
}
func (s *Server) GetHouseholdAisles(ctx context.Context, r *connect.Request[pantryv1.GetHouseholdAislesRequest]) (*connect.Response[pantryv1.GetHouseholdAislesResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.GetHouseholdAisles(ctx, c, r.Msg.HouseholdId)
	if err != nil {
		return nil, s.serviceError(ctx, "GetHouseholdAisles", err)
	}
	return connect.NewResponse(&pantryv1.GetHouseholdAislesResponse{View: aisleViewProto(v)}), nil
}
func (s *Server) CreateHouseholdAisle(ctx context.Context, r *connect.Request[pantryv1.CreateHouseholdAisleRequest]) (*connect.Response[pantryv1.CreateHouseholdAisleResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.CreateHouseholdAisle(ctx, c, r.Msg.HouseholdId, r.Msg.Label)
	if err != nil {
		return nil, s.serviceError(ctx, "CreateHouseholdAisle", err)
	}
	return connect.NewResponse(&pantryv1.CreateHouseholdAisleResponse{View: aisleViewProto(v)}), nil
}
func (s *Server) RemoveHouseholdAisle(ctx context.Context, r *connect.Request[pantryv1.RemoveHouseholdAisleRequest]) (*connect.Response[pantryv1.RemoveHouseholdAisleResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.RemoveHouseholdAisle(ctx, c, r.Msg.HouseholdId, r.Msg.Key)
	if err != nil {
		return nil, s.serviceError(ctx, "RemoveHouseholdAisle", err)
	}
	return connect.NewResponse(&pantryv1.RemoveHouseholdAisleResponse{View: aisleViewProto(v)}), nil
}
func (s *Server) SaveHouseholdAisleOrder(ctx context.Context, r *connect.Request[pantryv1.SaveHouseholdAisleOrderRequest]) (*connect.Response[pantryv1.SaveHouseholdAisleOrderResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.SaveHouseholdAisleOrder(ctx, c, r.Msg.HouseholdId, r.Msg.Revision, r.Msg.Keys)
	if err != nil {
		return nil, s.serviceError(ctx, "SaveHouseholdAisleOrder", err)
	}
	return connect.NewResponse(&pantryv1.SaveHouseholdAisleOrderResponse{View: aisleViewProto(v)}), nil
}
func (s *Server) GetHouseholdSettings(ctx context.Context, r *connect.Request[pantryv1.GetHouseholdSettingsRequest]) (*connect.Response[pantryv1.GetHouseholdSettingsResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.GetHouseholdSettings(ctx, c, r.Msg.HouseholdId)
	if err != nil {
		return nil, s.serviceError(ctx, "GetHouseholdSettings", err)
	}
	return connect.NewResponse(&pantryv1.GetHouseholdSettingsResponse{Settings: settingsProto(v)}), nil
}
func (s *Server) AddHouseholdStore(ctx context.Context, r *connect.Request[pantryv1.AddHouseholdStoreRequest]) (*connect.Response[pantryv1.AddHouseholdStoreResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.AddHouseholdStore(ctx, c, r.Msg.HouseholdId, r.Msg.Name)
	if err != nil {
		return nil, s.serviceError(ctx, "AddHouseholdStore", err)
	}
	return connect.NewResponse(&pantryv1.AddHouseholdStoreResponse{Settings: settingsProto(v)}), nil
}
func (s *Server) RemoveHouseholdStore(ctx context.Context, r *connect.Request[pantryv1.RemoveHouseholdStoreRequest]) (*connect.Response[pantryv1.RemoveHouseholdStoreResponse], error) {
	c, err := recipeCaller(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.service.RemoveHouseholdStore(ctx, c, r.Msg.HouseholdId, r.Msg.StoreId)
	if err != nil {
		return nil, s.serviceError(ctx, "RemoveHouseholdStore", err)
	}
	return connect.NewResponse(&pantryv1.RemoveHouseholdStoreResponse{Settings: settingsProto(v)}), nil
}
