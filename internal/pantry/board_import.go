package pantry

import (
	"context"
	"errors"
	"regexp"

	"github.com/wmichelin/Pantry/internal/authn"
)

const MaxBoardImportItems = 250

var boardOperationID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type BoardImportItem struct {
	Index          int32
	Title          string
	RawIngredients []string
	Metadata       *RecipeImportMetadata
}

type BoardImportRequestItem struct {
	Index          int32                `json:"index"`
	Title          string               `json:"title"`
	RawIngredients []string             `json:"raw_ingredients"`
	Metadata       RecipeImportMetadata `json:"metadata"`
}

// BoardImportManifestItem is the immutable, parsed payload accepted during
// preflight. The database stores this exact manifest so a retry cannot change
// selection, title, tags, metadata, or parser output under the same operation.
type BoardImportManifestItem struct {
	Index       int32                `json:"index"`
	Title       string               `json:"title"`
	Ingredients []RecipeIngredient   `json:"ingredients"`
	Metadata    RecipeImportMetadata `json:"metadata"`
}

type BoardImportCompletion struct {
	Status          string             `json:"status"`
	RecipeID        *string            `json:"recipe_id"`
	Title           string             `json:"title"`
	IngredientCount int                `json:"ingredient_count"`
	Ingredients     []RecipeIngredient `json:"ingredients"`
}

type BoardImportStore interface {
	PreflightBoardImport(context.Context, string, string, string, []BoardImportRequestItem, []BoardImportManifestItem) error
	ImportBoardItem(context.Context, string, string, string, int32) (BoardImportCompletion, error)
}

type BoardImportStatus uint8

const (
	BoardImportSaved BoardImportStatus = iota + 1
	BoardImportSkipped
	BoardImportFailed
)

type BoardImportProgress struct {
	Index          int32
	Title          string
	Status         BoardImportStatus
	Recipe         *SavedRecipe
	Ingredients    []RecipeIngredient
	Processed      int32
	Total          int32
	Saved          int32
	Skipped        int32
	Failed         int32
	FailedTitles   []string
	CatalogWarning bool
	InternalError  error
}

func (service *Service) ImportBoard(
	ctx context.Context,
	caller authn.Caller,
	householdID string,
	operationID string,
	items []BoardImportItem,
	preflighted func(total int32) error,
	emit func(BoardImportProgress) error,
) (BoardImportProgress, error) {
	if service.boardImports == nil {
		return BoardImportProgress{}, unavailable("Board import is unavailable.", errors.New("board import store not configured"))
	}
	if !boardOperationID.MatchString(operationID) {
		return BoardImportProgress{}, invalid("A valid board import operation is required.")
	}
	if len(items) == 0 || len(items) > MaxBoardImportItems {
		return BoardImportProgress{}, invalid("A board import must contain between 1 and 250 recipes.")
	}

	manifest := make([]BoardImportManifestItem, len(items))
	requestManifest := make([]BoardImportRequestItem, len(items))
	indexes := make(map[int32]struct{}, len(items))
	for index, item := range items {
		if item.Index < 0 {
			return BoardImportProgress{}, invalid("Board import item indexes must be non-negative and unique.")
		}
		if _, exists := indexes[item.Index]; exists {
			return BoardImportProgress{}, invalid("Board import item indexes must be non-negative and unique.")
		}
		indexes[item.Index] = struct{}{}
		parsed := ParseIngredients(item.RawIngredients)
		recipe := RecipeSave{
			HouseholdID: householdID,
			Title:       item.Title,
			Ingredients: make([]RecipeIngredient, len(parsed)),
			Metadata:    cloneImportMetadata(item.Metadata),
		}
		for ingredientIndex, ingredient := range parsed {
			recipe.Ingredients[ingredientIndex] = RecipeIngredient{
				Name: ingredient.Name, Quantity: ingredient.Quantity,
				Unit: ingredient.Unit, RawString: ingredient.RawString,
			}
		}
		if err := validateImportedRecipe(recipe); err != nil {
			return BoardImportProgress{}, err
		}
		manifest[index] = BoardImportManifestItem{
			Index: item.Index, Title: item.Title,
			Ingredients: recipe.Ingredients, Metadata: *recipe.Metadata,
		}
		requestManifest[index] = BoardImportRequestItem{
			Index: item.Index, Title: item.Title,
			RawIngredients: append([]string{}, item.RawIngredients...),
			Metadata:       *recipe.Metadata,
		}
	}

	if err := service.boardImports.PreflightBoardImport(ctx, caller.AccessToken, householdID, operationID, requestManifest, manifest); err != nil {
		return BoardImportProgress{}, unavailable("Pantry could not prepare or resume the board import.", err)
	}
	if err := preflighted(int32(len(items))); err != nil {
		return BoardImportProgress{}, err
	}

	progress := BoardImportProgress{Total: int32(len(items)), FailedTitles: []string{}}
	anyCatalogWarning := false
	for _, item := range manifest {
		if err := ctx.Err(); err != nil {
			return progress, err
		}
		progress.Index = item.Index
		progress.Title = item.Title
		progress.Processed++
		progress.Recipe = nil
		progress.Ingredients = nil
		progress.CatalogWarning = anyCatalogWarning
		progress.InternalError = nil

		completion, err := service.boardImports.ImportBoardItem(ctx, caller.AccessToken, householdID, operationID, item.Index)
		if err != nil {
			if ctx.Err() != nil {
				return progress, ctx.Err()
			}
			progress.Status = BoardImportFailed
			progress.Failed++
			progress.FailedTitles = append(progress.FailedTitles, item.Title)
			progress.InternalError = err
		} else {
			switch completion.Status {
			case "saved":
				if completion.RecipeID == nil {
					progress.Status = BoardImportFailed
					progress.Failed++
					progress.FailedTitles = append(progress.FailedTitles, item.Title)
					progress.InternalError = errors.New("saved board result omitted recipe identity")
					break
				}
				progress.Status = BoardImportSaved
				progress.Saved++
				progress.Recipe = &SavedRecipe{ID: *completion.RecipeID, Title: completion.Title, IngredientCount: completion.IngredientCount}
				progress.Ingredients = append([]RecipeIngredient{}, completion.Ingredients...)
				if service.enrichImportedCatalog(ctx, caller, householdID, completion.Ingredients) != nil {
					anyCatalogWarning = true
				}
				progress.CatalogWarning = anyCatalogWarning
			case "skipped":
				progress.Status = BoardImportSkipped
				progress.Skipped++
			default:
				progress.Status = BoardImportFailed
				progress.Failed++
				progress.FailedTitles = append(progress.FailedTitles, item.Title)
				progress.InternalError = errors.New("board import store returned an invalid status")
			}
		}
		if err := emit(progress); err != nil {
			return progress, err
		}
	}
	return progress, nil
}

func cloneImportMetadata(metadata *RecipeImportMetadata) *RecipeImportMetadata {
	if metadata == nil {
		return nil
	}
	clone := *metadata
	clone.Instructions = append([]string{}, metadata.Instructions...)
	clone.Tags = append([]string{}, metadata.Tags...)
	return &clone
}

func (service *Service) enrichImportedCatalog(ctx context.Context, caller authn.Caller, householdID string, ingredients []RecipeIngredient) error {
	if service.catalogSettings == nil {
		return errors.New("catalog store not configured")
	}
	entries := make([]CatalogEntry, 0, len(ingredients))
	seen := make(map[string]struct{}, len(ingredients))
	for _, ingredient := range ingredients {
		cleaned, ok := catalogName(ingredient.Name)
		if !ok {
			continue
		}
		if _, exists := seen[cleaned.NormalizedName]; exists {
			continue
		}
		seen[cleaned.NormalizedName] = struct{}{}
		entries = append(entries, CatalogEntry{
			NormalizedName: cleaned.NormalizedName,
			DisplayName:    cleaned.DisplayName,
			Category:       "other",
		})
	}
	if len(entries) == 0 {
		return nil
	}
	_, err := service.catalogSettings.EnsureCatalogEntries(ctx, caller.AccessToken, householdID, entries, false)
	return err
}
