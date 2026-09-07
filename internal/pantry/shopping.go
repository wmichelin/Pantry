package pantry

import (
	"context"
	"errors"
	"strings"

	"github.com/wmichelin/Pantry/internal/authn"
)

type ShoppingCheck struct {
	HouseholdID      string
	NormalizedName   string
	StandaloneManual bool
	Checked          bool
}

// ShoppingChecks is intentionally separate from queue management: clearing a
// shopping week also removes manual items, while clearing the queue does not.
type ShoppingChecks interface {
	SetShoppingItemChecked(context.Context, string, ShoppingCheck) error
	ClearShoppingChecks(context.Context, string, string) error
	ClearShoppingWeek(context.Context, string, string) error
}

func (s *Service) shoppingReady(householdID string) error {
	if strings.TrimSpace(householdID) == "" {
		return invalid("A household is required.")
	}
	if s.shoppingChecks == nil {
		return unavailable("Shopping is unavailable.", errors.New("shopping checks not configured"))
	}
	return nil
}

func (s *Service) SetShoppingItemChecked(ctx context.Context, caller authn.Caller, check ShoppingCheck) error {
	if err := s.shoppingReady(check.HouseholdID); err != nil {
		return err
	}
	// Preserve the persisted key verbatim; this is not autocomplete normalization.
	if strings.TrimSpace(check.NormalizedName) == "" {
		return invalid("A shopping item is required.")
	}
	if err := s.shoppingChecks.SetShoppingItemChecked(ctx, caller.AccessToken, check); err != nil {
		return unavailable("Pantry could not update the shopping item.", err)
	}
	return nil
}
func (s *Service) ClearShoppingChecks(ctx context.Context, caller authn.Caller, householdID string) error {
	if err := s.shoppingReady(householdID); err != nil {
		return err
	}
	if err := s.shoppingChecks.ClearShoppingChecks(ctx, caller.AccessToken, householdID); err != nil {
		return unavailable("Pantry could not clear shopping checks.", err)
	}
	return nil
}
func (s *Service) ClearShoppingWeek(ctx context.Context, caller authn.Caller, householdID string) error {
	if err := s.shoppingReady(householdID); err != nil {
		return err
	}
	if err := s.shoppingChecks.ClearShoppingWeek(ctx, caller.AccessToken, householdID); err != nil {
		return unavailable("Pantry could not clear the shopping week.", err)
	}
	return nil
}
