package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/wmichelin/Pantry/internal/authn"
)

type Server struct {
	verifier authn.Verifier
	logger   *slog.Logger
}

func New(verifier authn.Verifier, logger *slog.Logger) http.Handler {
	server := Server{verifier: verifier, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("GET /readyz", server.ready)
	mux.HandleFunc("GET /api/v1/whoami", server.whoAmI)
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
