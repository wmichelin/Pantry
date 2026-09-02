package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/wmichelin/Pantry/internal/authn"
	"github.com/wmichelin/Pantry/internal/supabase"
)

type Server struct {
	verifier    authn.Verifier
	households  supabase.HouseholdReader
	memberships supabase.MembershipReader
	creator     supabase.HouseholdCreator
	joiner      supabase.HouseholdJoiner
	recipes     supabase.RecipeSaver
	logger      *slog.Logger
}

func New(verifier authn.Verifier, households supabase.HouseholdReader, memberships supabase.MembershipReader, creator supabase.HouseholdCreator, joiner supabase.HouseholdJoiner, recipes supabase.RecipeSaver, logger *slog.Logger) http.Handler {
	server := Server{verifier: verifier, households: households, memberships: memberships, creator: creator, joiner: joiner, recipes: recipes, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("GET /readyz", server.ready)
	mux.HandleFunc("GET /api/v1/whoami", server.whoAmI)
	mux.HandleFunc("GET /api/v1/households", server.listHouseholds)
	mux.HandleFunc("GET /api/v1/membership", server.findMembership)
	mux.HandleFunc("POST /api/v1/households", server.createHousehold)
	mux.HandleFunc("POST /api/v1/household-joins", server.joinHousehold)
	mux.HandleFunc("POST /api/v1/recipes", server.saveRecipe)
	return server.withRequestLog(mux)
}

func (server Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (server Server) ready(writer http.ResponseWriter, _ *http.Request) {
	// Database readiness belongs to the RLS feasibility slice. This endpoint
	// proves only that the configured, fail-closed process is accepting traffic.
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ready"})
}

func (server Server) whoAmI(writer http.ResponseWriter, request *http.Request) {
	principal, err := authn.RequirePrincipal(request.Context(), request.Header, server.verifier)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"user_id": principal.Subject})
}

func (server Server) listHouseholds(writer http.ResponseWriter, request *http.Request) {
	accessToken, err := authn.BearerToken(request.Header)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	if _, err := authn.RequirePrincipal(request.Context(), request.Header, server.verifier); err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	households, err := server.households.ListHouseholds(request.Context(), accessToken)
	if err != nil {
		server.logger.ErrorContext(request.Context(), "list RLS-scoped households", "error", err)
		writeProblem(writer, http.StatusBadGateway, "upstream_unavailable", "Pantry could not load households right now.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"households": households})
}

func (server Server) findMembership(writer http.ResponseWriter, request *http.Request) {
	accessToken, err := authn.BearerToken(request.Header)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	principal, err := authn.RequirePrincipal(request.Context(), request.Header, server.verifier)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	membership, err := server.memberships.FindMembership(request.Context(), principal.Subject, accessToken)
	if err != nil {
		server.logger.ErrorContext(request.Context(), "find RLS-scoped membership", "error", err)
		writeProblem(writer, http.StatusBadGateway, "upstream_unavailable", "Pantry could not load your household right now.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"membership": membership})
}

type createHouseholdRequest struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
}

func (server Server) createHousehold(writer http.ResponseWriter, request *http.Request) {
	accessToken, ok := server.requireVerifiedAccessToken(writer, request)
	if !ok {
		return
	}
	var input createHouseholdRequest
	if !decodeJSON(writer, request, &input) || strings.TrimSpace(input.Name) == "" {
		writeProblem(writer, http.StatusBadRequest, "invalid_request", "A household name is required.")
		return
	}
	household, err := server.creator.CreateHousehold(request.Context(), accessToken, input.Name, input.DisplayName)
	if err != nil {
		server.logger.ErrorContext(request.Context(), "create household", "error", err)
		writeProblem(writer, http.StatusBadGateway, "upstream_unavailable", "Pantry could not create the household right now.")
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"household": household})
}

type joinHouseholdRequest struct {
	InviteCode  string `json:"invite_code"`
	DisplayName string `json:"display_name"`
}

func (server Server) joinHousehold(writer http.ResponseWriter, request *http.Request) {
	accessToken, ok := server.requireVerifiedAccessToken(writer, request)
	if !ok {
		return
	}
	var input joinHouseholdRequest
	if !decodeJSON(writer, request, &input) || strings.TrimSpace(input.InviteCode) == "" {
		writeProblem(writer, http.StatusBadRequest, "invalid_request", "An invite code is required.")
		return
	}
	household, err := server.joiner.JoinHouseholdByInvite(request.Context(), accessToken, input.InviteCode, input.DisplayName)
	if err != nil {
		server.logger.ErrorContext(request.Context(), "join household", "error", err)
		writeProblem(writer, http.StatusBadGateway, "upstream_unavailable", "Pantry could not join that household right now.")
		return
	}
	if household == nil {
		writeProblem(writer, http.StatusNotFound, "invite_not_found", "No household found with that invite code.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"household": household})
}

func (server Server) saveRecipe(writer http.ResponseWriter, request *http.Request) {
	accessToken, ok := server.requireVerifiedAccessToken(writer, request)
	if !ok {
		return
	}
	var input supabase.RecipeSave
	if !decodeJSON(writer, request, &input) || strings.TrimSpace(input.HouseholdID) == "" || strings.TrimSpace(input.Title) == "" || len(input.Ingredients) == 0 {
		writeProblem(writer, http.StatusBadRequest, "invalid_request", "A household, title, and at least one ingredient are required.")
		return
	}
	for _, ingredient := range input.Ingredients {
		if strings.TrimSpace(ingredient.Name) == "" {
			writeProblem(writer, http.StatusBadRequest, "invalid_request", "Every recipe ingredient needs a name.")
			return
		}
	}
	recipe, err := server.recipes.SaveRecipe(request.Context(), accessToken, input)
	if err != nil {
		server.logger.ErrorContext(request.Context(), "save recipe", "error", err)
		writeProblem(writer, http.StatusBadGateway, "upstream_unavailable", "Pantry could not save the recipe right now.")
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"recipe": recipe})
}

func (server Server) requireVerifiedAccessToken(writer http.ResponseWriter, request *http.Request) (string, bool) {
	accessToken, err := authn.BearerToken(request.Header)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return "", false
	}
	if _, err := authn.RequirePrincipal(request.Context(), request.Header, server.verifier); err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return "", false
	}
	return accessToken, true
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, destination any) bool {
	request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return false
	}
	return true
}

func (server Server) withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		startedAt := time.Now()
		next.ServeHTTP(writer, request)
		server.logger.InfoContext(context.Background(), "Pantry API request", "method", request.Method, "path", request.URL.Path, "duration_ms", time.Since(startedAt).Milliseconds())
	})
}

type problem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeProblem(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, problem{Code: code, Message: message})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
