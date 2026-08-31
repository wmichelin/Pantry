package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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

type membershipReaderStub struct {
	membership *supabase.Membership
	err        error
	userID     string
	token      string
}

type householdOperationsStub struct {
	created    *supabase.CreatedHousehold
	joined     *supabase.JoinedHousehold
	err        error
	token      string
	name       string
	display    string
	inviteCode string
}

func (stub *householdOperationsStub) CreateHousehold(_ context.Context, token, name, displayName string) (*supabase.CreatedHousehold, error) {
	stub.token = token
	stub.name = name
	stub.display = displayName
	return stub.created, stub.err
}

func (stub *householdOperationsStub) JoinHouseholdByInvite(_ context.Context, token, code, displayName string) (*supabase.JoinedHousehold, error) {
	stub.token = token
	stub.inviteCode = code
	stub.display = displayName
	return stub.joined, stub.err
}

func (stub *membershipReaderStub) FindMembership(_ context.Context, userID, token string) (*supabase.Membership, error) {
	stub.userID = userID
	stub.token = token
	return stub.membership, stub.err
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
			handler := New(tt.verifier, &householdReaderStub{}, &membershipReaderStub{}, &householdOperationsStub{}, &householdOperationsStub{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
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
		&membershipReaderStub{},
		&householdOperationsStub{},
		&householdOperationsStub{},
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

func TestFindMembershipUsesVerifiedCallerIdentity(t *testing.T) {
	reader := &membershipReaderStub{membership: &supabase.Membership{
		HouseholdID: "household-1",
		Role:        "owner",
		Household:   supabase.Household{ID: "household-1", Name: "Pantry", InviteCode: "ABC123"},
	}}
	handler := New(
		verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}},
		&householdReaderStub{},
		reader,
		&householdOperationsStub{},
		&householdOperationsStub{},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/membership", nil)
	request.Header.Set("Authorization", "Bearer verified-user-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if reader.userID != "user-1" || reader.token != "verified-user-token" {
		t.Fatalf("reader identity = (%q, %q)", reader.userID, reader.token)
	}
	var body struct {
		Membership *supabase.Membership `json:"membership"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Membership == nil || body.Membership.HouseholdID != "household-1" {
		t.Fatalf("membership = %#v", body.Membership)
	}
}

func TestHouseholdMembershipOperationsUseVerifiedCallerToken(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		body       string
		operations householdOperationsStub
		wantStatus int
		wantBody   string
		wantName   string
		wantInvite string
	}{
		{
			name:       "create validates name",
			path:       "/api/v1/households",
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"code":"invalid_request","message":"A household name is required."}`,
		},
		{
			name:       "create returns atomic owner household",
			path:       "/api/v1/households",
			body:       `{"name":"Pantry","display_name":"Owner"}`,
			operations: householdOperationsStub{created: &supabase.CreatedHousehold{ID: "household-1", Name: "Pantry", InviteCode: "INVITE"}},
			wantStatus: http.StatusCreated,
			wantBody:   `{"household":{"id":"household-1","name":"Pantry","invite_code":"INVITE"}}`,
			wantName:   "Pantry",
		},
		{
			name:       "join hides invalid invite details",
			path:       "/api/v1/household-joins",
			body:       `{"invite_code":"missing"}`,
			wantStatus: http.StatusNotFound,
			wantBody:   `{"code":"invite_not_found","message":"No household found with that invite code."}`,
			wantInvite: "missing",
		},
		{
			name:       "join reports duplicate membership",
			path:       "/api/v1/household-joins",
			body:       `{"invite_code":"INVITE","display_name":"Member"}`,
			operations: householdOperationsStub{joined: &supabase.JoinedHousehold{ID: "household-1", Name: "Pantry", AlreadyMember: true}},
			wantStatus: http.StatusOK,
			wantBody:   `{"household":{"id":"household-1","name":"Pantry","already_member":true}}`,
			wantInvite: "INVITE",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operations := tt.operations
			handler := New(
				verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}},
				&householdReaderStub{},
				&membershipReaderStub{},
				&operations,
				&operations,
				slog.New(slog.NewTextHandler(io.Discard, nil)),
			)
			request := httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body))
			request.Header.Set("Authorization", "Bearer verified-user-token")
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
			if tt.wantStatus != http.StatusBadRequest && operations.token != "verified-user-token" {
				t.Fatalf("forwarded token = %q", operations.token)
			}
			if tt.wantName != "" && operations.name != tt.wantName {
				t.Fatalf("created name = %q", operations.name)
			}
			if tt.wantInvite != "" && operations.inviteCode != tt.wantInvite {
				t.Fatalf("invite code = %q", operations.inviteCode)
			}
		})
	}
}

func equalJSON(left, right any) bool {
	leftBytes, _ := json.Marshal(left)
	rightBytes, _ := json.Marshal(right)
	return string(leftBytes) == string(rightBytes)
}
