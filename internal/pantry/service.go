package pantry

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/wmichelin/Pantry/internal/authn"
)

type HouseholdReader interface {
	ListHouseholds(context.Context, string) ([]Household, error)
}

type MembershipReader interface {
	FindMembership(context.Context, string, string) (*Membership, error)
}

type HouseholdCreator interface {
	CreateHousehold(context.Context, string, string, string) (*CreatedHousehold, error)
}

type HouseholdJoiner interface {
	JoinHouseholdByInvite(context.Context, string, string, string) (*JoinedHousehold, error)
}

type RecipeSaver interface {
	SaveRecipe(context.Context, string, RecipeSave) (*SavedRecipe, error)
}

type Household struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	InviteCode string `json:"invite_code"`
	CreatedBy  string `json:"created_by"`
	CreatedAt  string `json:"created_at"`
}

type Membership struct {
	HouseholdID string    `json:"household_id"`
	Role        string    `json:"role"`
	Household   Household `json:"households"`
}

type CreatedHousehold struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	InviteCode string `json:"invite_code"`
}

type JoinedHousehold struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	AlreadyMember bool   `json:"already_member"`
}

type RecipeIngredient struct {
	Name      string   `json:"name"`
	Quantity  *float64 `json:"quantity"`
	Unit      *string  `json:"unit"`
	RawString string   `json:"raw_string"`
}

type RecipeSave struct {
	HouseholdID string                `json:"household_id"`
	Title       string                `json:"title"`
	Ingredients []RecipeIngredient    `json:"ingredients"`
	Metadata    *RecipeImportMetadata `json:"metadata,omitempty"`
}

type RecipeImportMetadata struct {
	SourceURL       string   `json:"source_url"`
	SourceType      string   `json:"source_type"`
	ImageURL        *string  `json:"image_url"`
	Instructions    []string `json:"instructions"`
	Tags            []string `json:"tags"`
	Servings        *int32   `json:"servings"`
	PrepTimeMinutes *int32   `json:"prep_time_minutes"`
	CookTimeMinutes *int32   `json:"cook_time_minutes"`
}

type SavedRecipe struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	IngredientCount int    `json:"ingredient_count"`
}

type ErrorKind uint8

const (
	ErrorInvalidArgument ErrorKind = iota + 1
	ErrorNotFound
	ErrorUnavailable
)

// Error carries the stable public contract while retaining the internal cause
// for server-side diagnostics.
type Error struct {
	Kind    ErrorKind
	Code    string
	Message string
	cause   error
}

func (err *Error) Error() string {
	if err.cause == nil {
		return err.Code
	}
	return fmt.Sprintf("%s: %v", err.Code, err.cause)
}

func (err *Error) Unwrap() error {
	return err.cause
}

type Service struct {
	households  HouseholdReader
	memberships MembershipReader
	creator     HouseholdCreator
	joiner      HouseholdJoiner
	recipes     RecipeSaver
}

func NewService(households HouseholdReader, memberships MembershipReader, creator HouseholdCreator, joiner HouseholdJoiner, recipes RecipeSaver) *Service {
	return &Service{
		households:  households,
		memberships: memberships,
		creator:     creator,
		joiner:      joiner,
		recipes:     recipes,
	}
}

func (service *Service) ListHouseholds(ctx context.Context, caller authn.Caller) ([]Household, error) {
	households, err := service.households.ListHouseholds(ctx, caller.AccessToken)
	if err != nil {
		return nil, unavailable("Pantry could not load households right now.", err)
	}
	if households == nil {
		households = []Household{}
	}
	return households, nil
}

func (service *Service) FindMembership(ctx context.Context, caller authn.Caller) (*Membership, error) {
	membership, err := service.memberships.FindMembership(ctx, caller.Principal.Subject, caller.AccessToken)
	if err != nil {
		return nil, unavailable("Pantry could not load your household right now.", err)
	}
	return membership, nil
}

func (service *Service) CreateHousehold(ctx context.Context, caller authn.Caller, name, displayName string) (*CreatedHousehold, error) {
	if strings.TrimSpace(name) == "" {
		return nil, invalid("A household name is required.")
	}
	household, err := service.creator.CreateHousehold(ctx, caller.AccessToken, name, displayName)
	if err != nil {
		return nil, unavailable("Pantry could not create the household right now.", err)
	}
	if household == nil {
		return nil, unavailable("Pantry could not create the household right now.", errors.New("household creator returned an empty response"))
	}
	return household, nil
}

func (service *Service) JoinHousehold(ctx context.Context, caller authn.Caller, inviteCode, displayName string) (*JoinedHousehold, error) {
	if strings.TrimSpace(inviteCode) == "" {
		return nil, invalid("An invite code is required.")
	}
	household, err := service.joiner.JoinHouseholdByInvite(ctx, caller.AccessToken, inviteCode, displayName)
	if err != nil {
		return nil, unavailable("Pantry could not join that household right now.", err)
	}
	if household == nil {
		return nil, &Error{Kind: ErrorNotFound, Code: "invite_not_found", Message: "No household found with that invite code."}
	}
	return household, nil
}

func (service *Service) SaveRecipe(ctx context.Context, caller authn.Caller, recipe RecipeSave) (*SavedRecipe, error) {
	// Metadata is accepted only by the dedicated import operation.
	if recipe.Metadata != nil {
		return nil, invalid("Use the recipe import operation for source metadata.")
	}
	if strings.TrimSpace(recipe.HouseholdID) == "" || strings.TrimSpace(recipe.Title) == "" || len(recipe.Ingredients) == 0 {
		return nil, invalid("A household, title, and at least one ingredient are required.")
	}
	return service.persistRecipe(ctx, caller, recipe)
}

func (service *Service) ImportRecipe(ctx context.Context, caller authn.Caller, recipe RecipeSave) (*SavedRecipe, error) {
	if strings.TrimSpace(recipe.HouseholdID) == "" || strings.TrimSpace(recipe.Title) == "" || recipe.Metadata == nil {
		return nil, invalid("A household, title, and import metadata are required.")
	}
	if recipe.Metadata.SourceType != "url" && recipe.Metadata.SourceType != "pinterest_pin" {
		return nil, invalid("An imported recipe must have a URL or Pinterest source type.")
	}
	return service.persistRecipe(ctx, caller, recipe)
}

func (service *Service) persistRecipe(ctx context.Context, caller authn.Caller, recipe RecipeSave) (*SavedRecipe, error) {
	for _, ingredient := range recipe.Ingredients {
		if strings.TrimSpace(ingredient.Name) == "" {
			return nil, invalid("Every recipe ingredient needs a name.")
		}
		if ingredient.Quantity != nil && (math.IsNaN(*ingredient.Quantity) || math.IsInf(*ingredient.Quantity, 0)) {
			return nil, invalid("Ingredient quantities must be finite numbers.")
		}
	}
	saved, err := service.recipes.SaveRecipe(ctx, caller.AccessToken, recipe)
	if err != nil {
		return nil, unavailable("Pantry could not save the recipe right now.", err)
	}
	if saved == nil {
		return nil, unavailable("Pantry could not save the recipe right now.", errors.New("recipe saver returned an empty response"))
	}
	return saved, nil
}

func invalid(message string) *Error {
	return &Error{Kind: ErrorInvalidArgument, Code: "invalid_request", Message: message}
}

func unavailable(message string, cause error) *Error {
	return &Error{Kind: ErrorUnavailable, Code: "upstream_unavailable", Message: message, cause: cause}
}
