package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wmichelin/Pantry/internal/authn"
	"github.com/wmichelin/Pantry/internal/supabase"
)

type verifierStub struct {
	principal authn.Principal
	err       error
}

func (stub verifierStub) Verify(context.Context, string) (authn.Principal, error) {
	return stub.principal, stub.err
}

type householdReaderStub struct {
	households []supabase.Household
	err        error
	token      string
}

func (stub *householdReaderStub) ListHouseholds(_ context.Context, token string) ([]supabase.Household, error) {
	stub.token = token
	return stub.households, stub.err
}

func TestFoundationRoutes(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		header     string
		verifier   verifierStub
		wantStatus int
		wantBody   string
	}{
		{name: "health", path: "/healthz", wantStatus: http.StatusOK, wantBody: `{"status":"ok"}`},
		{name: "ready", path: "/readyz", wantStatus: http.StatusOK, wantBody: `{"status":"ready"}`},
		{name: "whoami requires token", path: "/api/v1/whoami", wantStatus: http.StatusUnauthorized, wantBody: `{"code":"unauthenticated","message":"A valid Pantry session is required."}`},
		{name: "whoami rejects invalid token", path: "/api/v1/whoami", header: "Bearer token", verifier: verifierStub{err: errors.New("invalid")}, wantStatus: http.StatusUnauthorized, wantBody: `{"code":"unauthenticated","message":"A valid Pantry session is required."}`},
		{name: "whoami returns verified subject", path: "/api/v1/whoami", header: "Bearer token", verifier: verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}}, wantStatus: http.StatusOK, wantBody: `{"user_id":"user-1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := New(tt.verifier, &householdReaderStub{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.header != "" {
				request.Header.Set("Authorization", tt.header)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, tt.wantStatus)
			}
			var got any
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			var want any
			if err := json.Unmarshal([]byte(tt.wantBody), &want); err != nil {
				t.Fatalf("decode expected response: %v", err)
			}
			if !equalJSON(got, want) {
				t.Fatalf("body = %s, want %s", response.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestListHouseholdsUsesVerifiedCallerToken(t *testing.T) {
	reader := &householdReaderStub{households: []supabase.Household{{ID: "household-1", Name: "Pantry"}}}
	handler := New(
		verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}},
		reader,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/households", nil)
	request.Header.Set("Authorization", "Bearer verified-user-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if reader.token != "verified-user-token" {
		t.Fatalf("forwarded token = %q", reader.token)
	}
}

func equalJSON(left, right any) bool {
	leftBytes, _ := json.Marshal(left)
	rightBytes, _ := json.Marshal(right)
	return string(leftBytes) == string(rightBytes)
}
