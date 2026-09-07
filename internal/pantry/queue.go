package pantry

import (
	"context"
	"errors"
	"github.com/wmichelin/Pantry/internal/authn"
	"strings"
)

type QueueEntry struct {
	ID          string `json:"id"`
	RecipeID    string `json:"recipe_id"`
	RecipeTitle string `json:"recipe_title"`
}
type QueueManager interface {
	ListQueue(context.Context, string, string, string) ([]QueueEntry, error)
	AddQueueRecipe(context.Context, string, string, string) (*QueueEntry, error)
	RemoveQueueRecipe(context.Context, string, string, string) error
	ClearQueueAndChecks(context.Context, string, string) error
}

func (s *Service) queueReady(householdID string) error {
	if strings.TrimSpace(householdID) == "" {
		return invalid("A household is required.")
	}
	if s.queueManager == nil {
		return unavailable("Queue management is unavailable.", errors.New("queue manager not configured"))
	}
	return nil
}
func (s *Service) ListQueue(ctx context.Context, caller authn.Caller, householdID, recipeID string) ([]QueueEntry, error) {
	if err := s.queueReady(householdID); err != nil {
		return nil, err
	}
	rows, err := s.queueManager.ListQueue(ctx, caller.AccessToken, householdID, recipeID)
	if err != nil {
		return nil, unavailable("Pantry could not load the queue right now.", err)
	}
	return rows, nil
}
func (s *Service) AddQueueRecipe(ctx context.Context, caller authn.Caller, householdID, recipeID string) (*QueueEntry, error) {
	if err := s.queueReady(householdID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(recipeID) == "" {
		return nil, invalid("A recipe is required.")
	}
	row, err := s.queueManager.AddQueueRecipe(ctx, caller.AccessToken, householdID, recipeID)
	if err != nil {
		return nil, unavailable("Pantry could not add the recipe to the queue.", err)
	}
	if row == nil {
		return nil, unavailable("Pantry could not add the recipe to the queue.", errors.New("empty queue response"))
	}
	return row, nil
}
func (s *Service) RemoveQueueRecipe(ctx context.Context, caller authn.Caller, householdID, recipeID string) error {
	if err := s.queueReady(householdID); err != nil {
		return err
	}
	if strings.TrimSpace(recipeID) == "" {
		return invalid("A recipe is required.")
	}
	if err := s.queueManager.RemoveQueueRecipe(ctx, caller.AccessToken, householdID, recipeID); err != nil {
		return unavailable("Pantry could not remove the recipe from the queue.", err)
	}
	return nil
}
func (s *Service) ClearQueueAndChecks(ctx context.Context, caller authn.Caller, householdID string) error {
	if err := s.queueReady(householdID); err != nil {
		return err
	}
	if err := s.queueManager.ClearQueueAndChecks(ctx, caller.AccessToken, householdID); err != nil {
		return unavailable("Pantry could not clear the queue right now.", err)
	}
	return nil
}
