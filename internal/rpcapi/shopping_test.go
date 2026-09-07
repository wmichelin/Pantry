package rpcapi_test

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type shoppingStub struct {
	token, household string
	check            pantry.ShoppingCheck
	calls            int
	err              error
}

func (m *shoppingStub) SetShoppingItemChecked(_ context.Context, token string, check pantry.ShoppingCheck) error {
	m.calls++
	m.token = token
	m.check = check
	return m.err
}
func (m *shoppingStub) ClearShoppingChecks(_ context.Context, token, h string) error {
	m.calls++
	m.token = token
	m.household = h
	return m.err
}
func (m *shoppingStub) ClearShoppingWeek(_ context.Context, token, h string) error {
	m.calls++
	m.token = token
	m.household = h
	return m.err
}
func shoppingClient(t *testing.T, m *shoppingStub) pantryv1connect.ShoppingServiceClient {
	t.Helper()
	b := &backendStub{}
	options := []pantry.Option{}
	if m != nil {
		options = append(options, pantry.WithShoppingChecks(m))
	}
	server := httptest.NewServer(api.New(verifierStub{principal: authn.Principal{Subject: "u", Role: "authenticated"}}, pantry.NewService(b, b, b, b, b, options...), slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(server.Close)
	return pantryv1connect.NewShoppingServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
}
func TestShoppingBinaryContractPreservesCallerAndCheckIdentity(t *testing.T) {
	for _, manual := range []bool{false, true} {
		for _, checked := range []bool{false, true} {
			m := &shoppingStub{}
			c := shoppingClient(t, m)
			_, err := c.SetShoppingItemChecked(t.Context(), authorized(&pantryv1.SetShoppingItemCheckedRequest{HouseholdId: "h", NormalizedName: "green  onion", StandaloneManual: manual, Checked: checked}))
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(pantry.ShoppingCheck{HouseholdID: "h", NormalizedName: "green  onion", StandaloneManual: manual, Checked: checked}, m.check); diff != "" {
				t.Fatal(diff)
			}
			if _, err = c.ClearShoppingChecks(t.Context(), authorized(&pantryv1.ClearShoppingChecksRequest{HouseholdId: "h"})); err != nil {
				t.Fatal(err)
			}
			if _, err = c.ClearShoppingWeek(t.Context(), authorized(&pantryv1.ClearShoppingWeekRequest{HouseholdId: "h"})); err != nil {
				t.Fatal(err)
			}
			if m.token != "caller-token" || m.household != "h" || m.calls != 3 {
				t.Fatal("lost caller or wrong scope")
			}
		}
	}
}
func TestShoppingInvalidAnonymousAndFailedOperations(t *testing.T) {
	for _, operation := range []string{"set", "checks", "week"} {
		for _, scenario := range []string{"invalid", "anonymous", "upstream", "missing dependency"} {
			t.Run(operation+"/"+scenario, func(t *testing.T) {
				m := &shoppingStub{}
				household := "h"
				token := "caller-token"
				want := connect.CodeInvalidArgument
				switch scenario {
				case "invalid":
					household = " "
				case "anonymous":
					token = ""
					want = connect.CodeUnauthenticated
				case "upstream":
					m.err = errors.New("private database details")
					want = connect.CodeUnavailable
				case "missing dependency":
					m = nil
					want = connect.CodeUnavailable
				}
				c := shoppingClient(t, m)
				var err error
				switch operation {
				case "set":
					r := connect.NewRequest(&pantryv1.SetShoppingItemCheckedRequest{HouseholdId: household, NormalizedName: "milk"})
					if token != "" {
						r.Header().Set("Authorization", "Bearer "+token)
					}
					_, err = c.SetShoppingItemChecked(t.Context(), r)
				case "checks":
					r := connect.NewRequest(&pantryv1.ClearShoppingChecksRequest{HouseholdId: household})
					if token != "" {
						r.Header().Set("Authorization", "Bearer "+token)
					}
					_, err = c.ClearShoppingChecks(t.Context(), r)
				case "week":
					r := connect.NewRequest(&pantryv1.ClearShoppingWeekRequest{HouseholdId: household})
					if token != "" {
						r.Header().Set("Authorization", "Bearer "+token)
					}
					_, err = c.ClearShoppingWeek(t.Context(), r)
				}
				if connect.CodeOf(err) != want || strings.Contains(err.Error(), "private database") {
					t.Fatalf("error: %v", err)
				}
				if m != nil && scenario != "upstream" && m.calls != 0 {
					t.Fatal("invalid request reached storage")
				}
			})
		}
	}
	m := &shoppingStub{}
	c := shoppingClient(t, m)
	_, err := c.SetShoppingItemChecked(t.Context(), authorized(&pantryv1.SetShoppingItemCheckedRequest{HouseholdId: "h", NormalizedName: "\t "}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument || m.calls != 0 {
		t.Fatal("blank name reached storage")
	}
	_, err = c.SetShoppingItemChecked(t.Context(), authorized(&pantryv1.SetShoppingItemCheckedRequest{HouseholdId: "h", NormalizedName: strings.Repeat("x", 20<<10)}))
	if err == nil || m.calls != 0 {
		t.Fatal("oversized request reached storage")
	}
}
