package rpcapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"connectrpc.com/connect"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
)

const MaxRequestBytes = 16 << 10
const MaxImportRequestBytes = 256 << 10
const MaxShoppingOrderRequestBytes = 1 << 20
const MaxAisleOrderRequestBytes = 128 << 10

type Server struct {
	pantryv1connect.UnimplementedIdentityServiceHandler
	pantryv1connect.UnimplementedHouseholdServiceHandler
	pantryv1connect.UnimplementedRecipeServiceHandler
	pantryv1connect.UnimplementedQueueServiceHandler
	pantryv1connect.UnimplementedShoppingServiceHandler
	pantryv1connect.UnimplementedCatalogServiceHandler
	pantryv1connect.UnimplementedAisleServiceHandler
	pantryv1connect.UnimplementedHouseholdSettingsServiceHandler

	service *pantry.Service
	logger  *slog.Logger
}

func New(verifier authn.Verifier, service *pantry.Service, logger *slog.Logger) http.Handler {
	server := &Server{service: service, logger: logger}
	handlerOptions := []connect.HandlerOption{
		connect.WithReadMaxBytes(MaxRequestBytes),
	}
	mux := http.NewServeMux()
	mux.Handle(pantryv1connect.NewIdentityServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewHouseholdServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewRecipeServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewQueueServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewShoppingServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewCatalogServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewAisleServiceHandler(server, handlerOptions...))
	mux.Handle(pantryv1connect.NewHouseholdSettingsServiceHandler(server, handlerOptions...))
	_, aisleOrderHandler := pantryv1connect.NewAisleServiceHandler(server, connect.WithReadMaxBytes(MaxAisleOrderRequestBytes))
	mux.Handle(pantryv1connect.AisleServiceSaveHouseholdAisleOrderProcedure, aisleOrderHandler)
	_, importHandler := pantryv1connect.NewRecipeServiceHandler(server, connect.WithReadMaxBytes(MaxImportRequestBytes))
	mux.Handle(pantryv1connect.RecipeServiceImportRecipeProcedure, importHandler)
	mux.Handle(pantryv1connect.RecipeServiceImportRawRecipeProcedure, importHandler)
	mux.Handle(pantryv1connect.RecipeServiceParseImportIngredientsProcedure, importHandler)
	_, orderHandler := pantryv1connect.NewShoppingServiceHandler(server, connect.WithReadMaxBytes(MaxShoppingOrderRequestBytes))
	mux.Handle(pantryv1connect.ShoppingServiceSaveShoppingOrderProcedure, orderHandler)

	bounded := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		limit := int64(MaxRequestBytes)
		if request.URL.Path == pantryv1connect.RecipeServiceImportRecipeProcedure ||
			request.URL.Path == pantryv1connect.RecipeServiceImportRawRecipeProcedure ||
			request.URL.Path == pantryv1connect.RecipeServiceParseImportIngredientsProcedure {
			limit = MaxImportRequestBytes
		}
		if request.URL.Path == pantryv1connect.ShoppingServiceSaveShoppingOrderProcedure {
			limit = MaxShoppingOrderRequestBytes
		}
		if request.URL.Path == pantryv1connect.AisleServiceSaveHouseholdAisleOrderProcedure {
			limit = MaxAisleOrderRequestBytes
		}
		http.MaxBytesHandler(mux, limit).ServeHTTP(writer, request)
	})
	authenticated := authenticate(verifier, logger, bounded)
	return withRequestLog(logger, authenticated)
}

func (server *Server) WhoAmI(ctx context.Context, _ *connect.Request[pantryv1.WhoAmIRequest]) (*connect.Response[pantryv1.WhoAmIResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	return connect.NewResponse(&pantryv1.WhoAmIResponse{UserId: caller.Principal.Subject}), nil
}

func (server *Server) ListHouseholds(ctx context.Context, _ *connect.Request[pantryv1.ListHouseholdsRequest]) (*connect.Response[pantryv1.ListHouseholdsResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	households, err := server.service.ListHouseholds(ctx, caller)
	if err != nil {
		return nil, server.serviceError(ctx, "list RLS-scoped households", err)
	}
	response := &pantryv1.ListHouseholdsResponse{Households: make([]*pantryv1.Household, 0, len(households))}
	for _, household := range households {
		response.Households = append(response.Households, householdToProto(household))
	}
	return connect.NewResponse(response), nil
}

func (server *Server) GetMembership(ctx context.Context, _ *connect.Request[pantryv1.GetMembershipRequest]) (*connect.Response[pantryv1.GetMembershipResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	membership, err := server.service.FindMembership(ctx, caller)
	if err != nil {
		return nil, server.serviceError(ctx, "find RLS-scoped membership", err)
	}
	response := &pantryv1.GetMembershipResponse{}
	if membership != nil {
		response.Membership = &pantryv1.Membership{
			HouseholdId: membership.HouseholdID,
			Role:        membership.Role,
			Household: &pantryv1.MembershipHousehold{
				Id:         membership.Household.ID,
				Name:       membership.Household.Name,
				InviteCode: membership.Household.InviteCode,
			},
		}
	}
	return connect.NewResponse(response), nil
}

func (server *Server) CreateHousehold(ctx context.Context, request *connect.Request[pantryv1.CreateHouseholdRequest]) (*connect.Response[pantryv1.CreateHouseholdResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	household, err := server.service.CreateHousehold(ctx, caller, request.Msg.Name, request.Msg.DisplayName)
	if err != nil {
		return nil, server.serviceError(ctx, "create household", err)
	}
	return connect.NewResponse(&pantryv1.CreateHouseholdResponse{Household: &pantryv1.CreatedHousehold{
		Id: household.ID, Name: household.Name, InviteCode: household.InviteCode,
	}}), nil
}

func (server *Server) JoinHousehold(ctx context.Context, request *connect.Request[pantryv1.JoinHouseholdRequest]) (*connect.Response[pantryv1.JoinHouseholdResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	household, err := server.service.JoinHousehold(ctx, caller, request.Msg.InviteCode, request.Msg.DisplayName)
	if err != nil {
		return nil, server.serviceError(ctx, "join household", err)
	}
	return connect.NewResponse(&pantryv1.JoinHouseholdResponse{Household: &pantryv1.JoinedHousehold{
		Id: household.ID, Name: household.Name, AlreadyMember: household.AlreadyMember,
	}}), nil
}

func (server *Server) SaveRecipe(ctx context.Context, request *connect.Request[pantryv1.SaveRecipeRequest]) (*connect.Response[pantryv1.SaveRecipeResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	recipe := pantry.RecipeSave{
		HouseholdID: request.Msg.HouseholdId,
		Title:       request.Msg.Title,
		Ingredients: make([]pantry.RecipeIngredient, 0, len(request.Msg.Ingredients)),
	}
	for _, ingredient := range request.Msg.Ingredients {
		if ingredient == nil {
			recipe.Ingredients = append(recipe.Ingredients, pantry.RecipeIngredient{})
			continue
		}
		recipe.Ingredients = append(recipe.Ingredients, pantry.RecipeIngredient{
			Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: &ingredient.Unit, RawString: ingredient.RawString,
		})
	}
	saved, err := server.service.SaveRecipe(ctx, caller, recipe)
	if err != nil {
		return nil, server.serviceError(ctx, "save recipe", err)
	}
	return connect.NewResponse(&pantryv1.SaveRecipeResponse{Recipe: &pantryv1.SavedRecipe{
		Id: saved.ID, Title: saved.Title, IngredientCount: int32(saved.IngredientCount),
	}}), nil
}

func (server *Server) ImportRecipe(ctx context.Context, request *connect.Request[pantryv1.ImportRecipeRequest]) (*connect.Response[pantryv1.ImportRecipeResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	recipe := pantry.RecipeSave{
		HouseholdID: request.Msg.HouseholdId, Title: request.Msg.Title,
		Ingredients: make([]pantry.RecipeIngredient, 0, len(request.Msg.Ingredients)),
	}
	if metadata := request.Msg.Metadata; metadata != nil {
		recipe.Metadata = &pantry.RecipeImportMetadata{
			SourceURL: metadata.SourceUrl, SourceType: metadata.SourceType,
			ImageURL: metadata.ImageUrl, Instructions: append([]string{}, metadata.Instructions...),
			Tags: append([]string{}, metadata.Tags...), Servings: metadata.Servings,
			PrepTimeMinutes: metadata.PrepTimeMinutes, CookTimeMinutes: metadata.CookTimeMinutes,
		}
	}
	for _, ingredient := range request.Msg.Ingredients {
		if ingredient == nil {
			recipe.Ingredients = append(recipe.Ingredients, pantry.RecipeIngredient{})
			continue
		}
		recipe.Ingredients = append(recipe.Ingredients, pantry.RecipeIngredient{
			Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: ingredient.Unit, RawString: ingredient.RawString,
		})
	}
	saved, err := server.service.ImportRecipe(ctx, caller, recipe)
	if err != nil {
		return nil, server.serviceError(ctx, "import recipe", err)
	}
	return importedRecipeResponse(saved, recipe.Ingredients), nil
}

func (server *Server) ImportRawRecipe(ctx context.Context, request *connect.Request[pantryv1.ImportRawRecipeRequest]) (*connect.Response[pantryv1.ImportRawRecipeResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	parsed, err := server.service.ParseImportIngredients(ctx, caller, request.Msg.HouseholdId, request.Msg.RawIngredients)
	if err != nil {
		return nil, server.serviceError(ctx, "parse imported ingredients", err)
	}
	recipe := pantry.RecipeSave{
		HouseholdID: request.Msg.HouseholdId,
		Title:       request.Msg.Title,
		Ingredients: make([]pantry.RecipeIngredient, len(parsed)),
	}
	if metadata := request.Msg.Metadata; metadata != nil {
		recipe.Metadata = &pantry.RecipeImportMetadata{
			SourceURL: metadata.SourceUrl, SourceType: metadata.SourceType,
			ImageURL: metadata.ImageUrl, Instructions: append([]string{}, metadata.Instructions...),
			Tags: append([]string{}, metadata.Tags...), Servings: metadata.Servings,
			PrepTimeMinutes: metadata.PrepTimeMinutes, CookTimeMinutes: metadata.CookTimeMinutes,
		}
	}
	for index, ingredient := range parsed {
		recipe.Ingredients[index] = pantry.RecipeIngredient{
			Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: ingredient.Unit, RawString: ingredient.RawString,
		}
	}
	saved, err := server.service.ImportRecipe(ctx, caller, recipe)
	if err != nil {
		return nil, server.serviceError(ctx, "import raw recipe", err)
	}
	response := &pantryv1.ImportRawRecipeResponse{
		Recipe:      &pantryv1.SavedRecipe{Id: saved.ID, Title: saved.Title, IngredientCount: int32(saved.IngredientCount)},
		Ingredients: importedIngredientsToProto(recipe.Ingredients),
	}
	return connect.NewResponse(response), nil
}

func importedRecipeResponse(saved *pantry.SavedRecipe, ingredients []pantry.RecipeIngredient) *connect.Response[pantryv1.ImportRecipeResponse] {
	response := &pantryv1.ImportRecipeResponse{
		Recipe:      &pantryv1.SavedRecipe{Id: saved.ID, Title: saved.Title, IngredientCount: int32(saved.IngredientCount)},
		Ingredients: importedIngredientsToProto(ingredients),
	}
	return connect.NewResponse(response)
}

func importedIngredientsToProto(ingredients []pantry.RecipeIngredient) []*pantryv1.ImportedRecipeIngredient {
	response := make([]*pantryv1.ImportedRecipeIngredient, len(ingredients))
	for index, ingredient := range ingredients {
		response[index] = &pantryv1.ImportedRecipeIngredient{
			Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: ingredient.Unit, RawString: ingredient.RawString,
		}
	}
	return response
}

func (server *Server) ParseImportIngredients(ctx context.Context, request *connect.Request[pantryv1.ParseImportIngredientsRequest]) (*connect.Response[pantryv1.ParseImportIngredientsResponse], error) {
	caller, ok := authn.CallerFromContext(ctx)
	if !ok {
		return nil, connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
	}
	parsed, err := server.service.ParseImportIngredients(ctx, caller, request.Msg.HouseholdId, request.Msg.RawIngredients)
	if err != nil {
		return nil, server.serviceError(ctx, "parse imported ingredients", err)
	}
	response := &pantryv1.ParseImportIngredientsResponse{Ingredients: make([]*pantryv1.ImportedRecipeIngredient, len(parsed))}
	for index, ingredient := range parsed {
		response.Ingredients[index] = &pantryv1.ImportedRecipeIngredient{
			Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: ingredient.Unit, RawString: ingredient.RawString,
		}
	}
	return connect.NewResponse(response), nil
}

func householdToProto(household pantry.Household) *pantryv1.Household {
	return &pantryv1.Household{
		Id: household.ID, Name: household.Name, InviteCode: household.InviteCode,
		CreatedBy: household.CreatedBy, CreatedAt: household.CreatedAt,
	}
}

func authenticate(verifier authn.Verifier, logger *slog.Logger, next http.Handler) http.Handler {
	errorWriter := connect.NewErrorWriter(
		connect.WithReadMaxBytes(MaxRequestBytes),
	)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		caller, err := authn.RequireCaller(request.Context(), request.Header, verifier)
		if err != nil {
			rpcError := connectError(connect.CodeUnauthenticated, "unauthenticated", "A valid Pantry session is required.")
			if writeErr := errorWriter.Write(writer, request, rpcError); writeErr != nil {
				logger.ErrorContext(request.Context(), "write RPC authentication error", "error", writeErr)
			}
			return
		}
		next.ServeHTTP(writer, request.WithContext(authn.ContextWithCaller(request.Context(), caller)))
	})
}

func (server *Server) serviceError(ctx context.Context, operation string, err error) error {
	var serviceError *pantry.Error
	if !errors.As(err, &serviceError) {
		server.logger.ErrorContext(ctx, operation, "error", err)
		return connectError(connect.CodeInternal, "internal", "Pantry could not complete that request right now.")
	}
	code := connect.CodeInvalidArgument
	switch serviceError.Kind {
	case pantry.ErrorNotFound:
		code = connect.CodeNotFound
	case pantry.ErrorUnavailable:
		code = connect.CodeUnavailable
		server.logger.ErrorContext(ctx, operation, "error", err)
	}
	return connectError(code, serviceError.Code, serviceError.Message)
}

func connectError(code connect.Code, stableCode, message string) *connect.Error {
	err := connect.NewError(code, errors.New(message))
	detail, detailErr := connect.NewErrorDetail(&pantryv1.PantryErrorDetail{Code: stableCode, UserMessage: message})
	if detailErr == nil {
		err.AddDetail(detail)
	}
	return err
}

func withRequestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		startedAt := time.Now()
		next.ServeHTTP(writer, request)
		logger.InfoContext(context.Background(), "Pantry RPC request", "method", request.Method, "path", request.URL.Path, "duration_ms", time.Since(startedAt).Milliseconds())
	})
}
