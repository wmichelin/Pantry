package pantry

import (
	"context"
	"errors"
	"strings"

	"github.com/wmichelin/Pantry/internal/authn"
)

var (
	ErrScrapeRateLimited = errors.New("scrape rate limited")
	ErrScrapeBusy        = errors.New("scrape already running")
)

const maxScrapeAdmissions = 8

type ScrapedRecipe struct {
	Title           string
	SourceURL       string
	SourceType      string
	ImageURL        *string
	Servings        *int32
	PrepTimeMinutes *int32
	CookTimeMinutes *int32
	Instructions    []string
	RawIngredients  []string
	SuggestedTags   []string
}

type ScrapedBoard struct {
	Recipes    []ScrapedRecipe
	TotalFound int32
}

type ScrapeResult struct {
	Recipe *ScrapedRecipe
	Board  *ScrapedBoard
}

type RecipeScraper interface {
	Scrape(context.Context, string, string, string) (*ScrapeResult, error)
}

func (service *Service) ScrapeRecipe(ctx context.Context, caller authn.Caller, householdID, rawURL string) (*ScrapeResult, error) {
	householdID = strings.TrimSpace(householdID)
	rawURL = strings.TrimSpace(rawURL)
	if householdID == "" || rawURL == "" {
		return nil, invalid("A household and recipe URL are required.")
	}
	select {
	case service.scrapeAdmissions <- struct{}{}:
		defer func() { <-service.scrapeAdmissions }()
	default:
		return nil, &Error{Kind: ErrorResourceExhausted, Code: "scrape_capacity", Message: "Recipe imports are busy. Please try again shortly."}
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
	if service.recipeScraper == nil {
		return nil, unavailable("Pantry could not scrape that recipe right now.", errors.New("recipe scraper not configured"))
	}
	result, err := service.recipeScraper.Scrape(ctx, caller.Principal.Subject, householdID, rawURL)
	if err != nil {
		switch {
		case errors.Is(err, ErrScrapeRateLimited):
			return nil, &Error{Kind: ErrorResourceExhausted, Code: "scrape_rate_limited", Message: "Too many recipe imports. Please wait a minute and try again."}
		case errors.Is(err, ErrScrapeBusy):
			return nil, &Error{Kind: ErrorResourceExhausted, Code: "scrape_in_progress", Message: "A recipe import is already running for this account."}
		case errors.Is(err, context.DeadlineExceeded):
			return nil, &Error{Kind: ErrorDeadlineExceeded, Code: "scrape_timeout", Message: "That recipe site took too long to respond. Please try again."}
		case errors.Is(err, context.Canceled):
			return nil, err
		default:
			return nil, unavailable("Pantry could not safely scrape that recipe right now.", err)
		}
	}
	if result == nil || (result.Recipe == nil) == (result.Board == nil) {
		return nil, unavailable("Pantry could not safely scrape that recipe right now.", errors.New("scraper returned an invalid result"))
	}
	return result, nil
}
