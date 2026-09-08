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

type HouseholdMembershipChecker interface {
	HasHouseholdMembership(context.Context, string, string, string) (bool, error)
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
	ErrorResourceExhausted
	ErrorDeadlineExceeded
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
	households        HouseholdReader
	memberships       MembershipReader
	membershipChecker HouseholdMembershipChecker
	creator           HouseholdCreator
	joiner            HouseholdJoiner
	recipes           RecipeSaver
	recipeManager     RecipeManager
	queueManager      QueueManager
	shoppingChecks    ShoppingChecks
	shoppingListStore ShoppingListStore
	catalogSettings   CatalogSettingsStore
	boardImports      BoardImportStore
	recipeScraper     RecipeScraper
	scrapeAdmissions  chan struct{}
}

type Option func(*Service)

func WithCatalogSettings(store CatalogSettingsStore) Option {
	return func(s *Service) { s.catalogSettings = store }
}

func WithBoardImportStore(store BoardImportStore) Option {
	return func(s *Service) { s.boardImports = store }
}

func WithRecipeScraper(scraper RecipeScraper) Option {
	return func(s *Service) { s.recipeScraper = scraper }
}

func WithShoppingListStore(store ShoppingListStore) Option {
	return func(s *Service) { s.shoppingListStore = store }
}

func WithShoppingChecks(checks ShoppingChecks) Option {
	return func(service *Service) { service.shoppingChecks = checks }
}

func WithRecipeManager(manager RecipeManager) Option {
	return func(service *Service) { service.recipeManager = manager }
}

func WithQueueManager(manager QueueManager) Option {
	return func(service *Service) { service.queueManager = manager }
}

func NewService(households HouseholdReader, memberships MembershipReader, creator HouseholdCreator, joiner HouseholdJoiner, recipes RecipeSaver, options ...Option) *Service {
	service := &Service{
		households:       households,
		memberships:      memberships,
		creator:          creator,
		joiner:           joiner,
		recipes:          recipes,
		scrapeAdmissions: make(chan struct{}, maxScrapeAdmissions),
	}
	if checker, ok := memberships.(HouseholdMembershipChecker); ok {
		service.membershipChecker = checker
	}
	for _, option := range options {
		option(service)
	}
	return service
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
	if err := validateImportedRecipe(recipe); err != nil {
		return nil, err
	}
	return service.persistRecipe(ctx, caller, recipe)
}

func validateImportedRecipe(recipe RecipeSave) error {
	if strings.TrimSpace(recipe.HouseholdID) == "" || strings.TrimSpace(recipe.Title) == "" || recipe.Metadata == nil {
		return invalid("A household, title, and import metadata are required.")
	}
	if recipe.Metadata.SourceType != "url" && recipe.Metadata.SourceType != "pinterest_pin" {
		return invalid("An imported recipe must have a URL or Pinterest source type.")
	}
	return validateRecipeIngredients(recipe.Ingredients)
}

func (service *Service) ParseImportIngredients(ctx context.Context, caller authn.Caller, householdID string, raws []string) ([]ParsedIngredient, error) {
	if strings.TrimSpace(householdID) == "" {
		return nil, invalid("A household is required.")
	}
	if service.membershipChecker == nil {
		return nil, unavailable("Pantry could not verify your household right now.", errors.New("household membership checker not configured"))
	}
	found, err := service.membershipChecker.HasHouseholdMembership(ctx, caller.Principal.Subject, householdID, caller.AccessToken)
	if err != nil {
		return nil, unavailable("Pantry could not verify your household right now.", err)
	}
	if !found {
		return nil, &Error{Kind: ErrorNotFound, Code: "household_not_found", Message: "Household not found."}
	}
	return ParseIngredients(raws), nil
}

func (service *Service) persistRecipe(ctx context.Context, caller authn.Caller, recipe RecipeSave) (*SavedRecipe, error) {
	if err := validateRecipeIngredients(recipe.Ingredients); err != nil {
		return nil, err
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

func validateRecipeIngredients(ingredients []RecipeIngredient) error {
	for _, ingredient := range ingredients {
		if strings.TrimSpace(ingredient.Name) == "" {
			return invalid("Every recipe ingredient needs a name.")
		}
		if ingredient.Quantity != nil && (math.IsNaN(*ingredient.Quantity) || math.IsInf(*ingredient.Quantity, 0)) {
			return invalid("Ingredient quantities must be finite numbers.")
		}
	}
	return nil
}

func invalid(message string) *Error {
	return &Error{Kind: ErrorInvalidArgument, Code: "invalid_request", Message: message}
}

func unavailable(message string, cause error) *Error {
	return &Error{Kind: ErrorUnavailable, Code: "upstream_unavailable", Message: message, cause: cause}
}
