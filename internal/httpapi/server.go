package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/wmichelin/Pantry/internal/authn"
	"github.com/wmichelin/Pantry/internal/pantry"
)

type Server struct {
	verifier authn.Verifier
	service  *pantry.Service
	logger   *slog.Logger
}

func New(verifier authn.Verifier, households pantry.HouseholdReader, memberships pantry.MembershipReader, creator pantry.HouseholdCreator, joiner pantry.HouseholdJoiner, recipes pantry.RecipeSaver, logger *slog.Logger) http.Handler {
	return NewWithService(verifier, pantry.NewService(households, memberships, creator, joiner, recipes), logger)
}

func NewWithService(verifier authn.Verifier, service *pantry.Service, logger *slog.Logger) http.Handler {
	server := Server{verifier: verifier, service: service, logger: logger}
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
	caller, err := authn.RequireCaller(request.Context(), request.Header, server.verifier)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"user_id": caller.Principal.Subject})
}

func (server Server) listHouseholds(writer http.ResponseWriter, request *http.Request) {
	caller, err := authn.RequireCaller(request.Context(), request.Header, server.verifier)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	households, err := server.service.ListHouseholds(request.Context(), caller)
	if err != nil {
		server.writeServiceError(writer, request, "list RLS-scoped households", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"households": households})
}

func (server Server) findMembership(writer http.ResponseWriter, request *http.Request) {
	caller, err := authn.RequireCaller(request.Context(), request.Header, server.verifier)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return
	}
	membership, err := server.service.FindMembership(request.Context(), caller)
	if err != nil {
		server.writeServiceError(writer, request, "find RLS-scoped membership", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"membership": membership})
}

type createHouseholdRequest struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
}

func (server Server) createHousehold(writer http.ResponseWriter, request *http.Request) {
	caller, ok := server.requireCaller(writer, request)
	if !ok {
		return
	}
	var input createHouseholdRequest
	if !decodeJSON(writer, request, &input) {
		writeProblem(writer, http.StatusBadRequest, "invalid_request", "A household name is required.")
		return
	}
	household, err := server.service.CreateHousehold(request.Context(), caller, input.Name, input.DisplayName)
	if err != nil {
		server.writeServiceError(writer, request, "create household", err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"household": household})
}

type joinHouseholdRequest struct {
	InviteCode  string `json:"invite_code"`
	DisplayName string `json:"display_name"`
}

func (server Server) joinHousehold(writer http.ResponseWriter, request *http.Request) {
	caller, ok := server.requireCaller(writer, request)
	if !ok {
		return
	}
	var input joinHouseholdRequest
	if !decodeJSON(writer, request, &input) {
		writeProblem(writer, http.StatusBadRequest, "invalid_request", "An invite code is required.")
		return
	}
	household, err := server.service.JoinHousehold(request.Context(), caller, input.InviteCode, input.DisplayName)
	if err != nil {
		server.writeServiceError(writer, request, "join household", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"household": household})
}

func (server Server) saveRecipe(writer http.ResponseWriter, request *http.Request) {
	caller, ok := server.requireCaller(writer, request)
	if !ok {
		return
	}
	var input pantry.RecipeSave
	if !decodeJSON(writer, request, &input) {
		writeProblem(writer, http.StatusBadRequest, "invalid_request", "A household, title, and at least one ingredient are required.")
		return
	}
	recipe, err := server.service.SaveRecipe(request.Context(), caller, input)
	if err != nil {
		server.writeServiceError(writer, request, "save recipe", err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"recipe": recipe})
}

func (server Server) requireCaller(writer http.ResponseWriter, request *http.Request) (authn.Caller, bool) {
	caller, err := authn.RequireCaller(request.Context(), request.Header, server.verifier)
	if err != nil {
		writeProblem(writer, http.StatusUnauthorized, "unauthenticated", "A valid Pantry session is required.")
		return authn.Caller{}, false
	}
	return caller, true
}

func (server Server) writeServiceError(writer http.ResponseWriter, request *http.Request, operation string, err error) {
	var serviceError *pantry.Error
	if !errors.As(err, &serviceError) {
		server.logger.ErrorContext(request.Context(), operation, "error", err)
		writeProblem(writer, http.StatusBadGateway, "upstream_unavailable", "Pantry could not complete that request right now.")
		return
	}
	status := http.StatusBadRequest
	switch serviceError.Kind {
	case pantry.ErrorNotFound:
		status = http.StatusNotFound
	case pantry.ErrorUnavailable:
		status = http.StatusBadGateway
		server.logger.ErrorContext(request.Context(), operation, "error", err)
	}
	writeProblem(writer, status, serviceError.Code, serviceError.Message)
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
