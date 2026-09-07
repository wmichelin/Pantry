package rpcapi_test

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type queueStub struct {
	token, household, recipe string
	calls                    int
	err                      error
	empty                    bool
}

func (m *queueStub) ListQueue(_ context.Context, token, household, recipe string) ([]pantry.QueueEntry, error) {
	m.token = token
	m.household = household
	m.recipe = recipe
	m.calls++
	return []pantry.QueueEntry{{ID: "q", RecipeID: "r", RecipeTitle: "Soup"}}, m.err
}
func (m *queueStub) AddQueueRecipe(_ context.Context, token, household, recipe string) (*pantry.QueueEntry, error) {
	m.token = token
	m.household = household
	m.recipe = recipe
	m.calls++
	if m.empty {
		return nil, m.err
	}
	return &pantry.QueueEntry{ID: "q", RecipeID: recipe, RecipeTitle: "Soup"}, m.err
}
func (m *queueStub) RemoveQueueRecipe(_ context.Context, token, household, recipe string) error {
	m.token = token
	m.household = household
	m.recipe = recipe
	m.calls++
	return m.err
}
func (m *queueStub) ClearQueueAndChecks(_ context.Context, token, household string) error {
	m.token = token
	m.household = household
	m.calls++
	return m.err
}
func queueClient(t *testing.T, m *queueStub) pantryv1connect.QueueServiceClient {
	t.Helper()
	b := &backendStub{}
	s := httptest.NewServer(api.New(verifierStub{principal: authn.Principal{Subject: "u", Role: "authenticated"}}, pantry.NewService(b, b, b, b, b, pantry.WithQueueManager(m)), slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(s.Close)
	return pantryv1connect.NewQueueServiceClient(http.DefaultClient, s.URL+api.RPCPrefix)
}
func TestQueueGeneratedClientPreservesCallerAndIdentity(t *testing.T) {
	m := &queueStub{}
	c := queueClient(t, m)
	list, err := c.ListQueue(t.Context(), authorized(&pantryv1.ListQueueRequest{HouseholdId: "h"}))
	if err != nil || len(list.Msg.Entries) != 1 || list.Msg.Entries[0].RecipeTitle != "Soup" {
		t.Fatalf("list: %v %v", list, err)
	}
	added, err := c.AddQueueRecipe(t.Context(), authorized(&pantryv1.AddQueueRecipeRequest{HouseholdId: "h", RecipeId: "r"}))
	if err != nil || added.Msg.Entry.RecipeId != "r" {
		t.Fatalf("add: %v %v", added, err)
	}
	_, err = c.RemoveQueueRecipe(t.Context(), authorized(&pantryv1.RemoveQueueRecipeRequest{HouseholdId: "h", RecipeId: "r"}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.ClearQueueAndChecks(t.Context(), authorized(&pantryv1.ClearQueueAndChecksRequest{HouseholdId: "h"}))
	if err != nil {
		t.Fatal(err)
	}
	if m.token != "caller-token" || m.household != "h" || m.recipe != "r" || m.calls != 4 {
		t.Fatal("lost verified caller or queue identity")
	}
}
func TestQueueRejectsInvalidAndFailedRequests(t *testing.T) {
	for _, tt := range []struct {
		name, household, recipe string
		err                     error
		empty                   bool
		want                    connect.Code
	}{
		{name: "no household", recipe: "r", want: connect.CodeInvalidArgument},
		{name: "no recipe", household: "h", want: connect.CodeInvalidArgument},
		{name: "upstream", household: "h", recipe: "r", err: errors.New("private error"), want: connect.CodeUnavailable},
		{name: "empty response", household: "h", recipe: "r", empty: true, want: connect.CodeUnavailable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			m := &queueStub{err: tt.err, empty: tt.empty}
			c := queueClient(t, m)
			_, err := c.AddQueueRecipe(t.Context(), authorized(&pantryv1.AddQueueRecipeRequest{HouseholdId: tt.household, RecipeId: tt.recipe}))
			if connect.CodeOf(err) != tt.want {
				t.Fatalf("error: %v", err)
			}
			if tt.want == connect.CodeInvalidArgument && m.calls != 0 {
				t.Fatal("invalid request reached storage")
			}
		})
	}
	m := &queueStub{}
	c := queueClient(t, m)
	_, err := c.ClearQueueAndChecks(t.Context(), connect.NewRequest(&pantryv1.ClearQueueAndChecksRequest{HouseholdId: "h"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated || m.calls != 0 {
		t.Fatal("anonymous clear accepted")
	}
}
