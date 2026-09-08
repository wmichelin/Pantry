package pantry

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/wmichelin/Pantry/internal/authn"
)

type scrapeMembershipStub struct {
	found bool
	err   error
}

type blockingScrapeMembershipStub struct {
	entered chan struct{}
	release chan struct{}
}

func (stub *blockingScrapeMembershipStub) FindMembership(context.Context, string, string) (*Membership, error) {
	return nil, nil
}

func (stub *blockingScrapeMembershipStub) HasHouseholdMembership(ctx context.Context, _, _, _ string) (bool, error) {
	stub.entered <- struct{}{}
	select {
	case <-stub.release:
		return false, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

func (stub scrapeMembershipStub) FindMembership(context.Context, string, string) (*Membership, error) {
	return nil, stub.err
}

func (stub scrapeMembershipStub) HasHouseholdMembership(context.Context, string, string, string) (bool, error) {
	return stub.found, stub.err
}

type recipeScraperStub struct {
	calls  int
	result *ScrapeResult
	err    error
}

func (stub *recipeScraperStub) Scrape(context.Context, string, string, string) (*ScrapeResult, error) {
	stub.calls++
	return stub.result, stub.err
}

func TestScrapeRecipeAuthorizesBeforeOutboundWork(t *testing.T) {
	scraper := &recipeScraperStub{result: &ScrapeResult{Recipe: &ScrapedRecipe{Title: "Recipe"}}}
	service := NewService(nil, scrapeMembershipStub{found: false}, nil, nil, nil, WithRecipeScraper(scraper))
	caller := authn.Caller{Principal: authn.Principal{Subject: "user"}, AccessToken: "token"}
	result, err := service.ScrapeRecipe(context.Background(), caller, "household", "https://recipes.example")
	if result != nil || err == nil || scraper.calls != 0 {
		t.Fatalf("unauthorized scrape = (%#v, %v), outbound calls = %d", result, err, scraper.calls)
	}
	var serviceError *Error
	if !errors.As(err, &serviceError) || serviceError.Kind != ErrorNotFound {
		t.Fatalf("unauthorized error = %#v", err)
	}
}

func TestScrapeRecipeBoundsMembershipAdmission(t *testing.T) {
	memberships := &blockingScrapeMembershipStub{
		entered: make(chan struct{}, maxScrapeAdmissions),
		release: make(chan struct{}),
	}
	service := NewService(nil, memberships, nil, nil, nil)
	caller := authn.Caller{Principal: authn.Principal{Subject: "user"}, AccessToken: "token"}
	var group sync.WaitGroup
	group.Add(maxScrapeAdmissions)
	for index := 0; index < maxScrapeAdmissions; index++ {
		go func() {
			defer group.Done()
			_, _ = service.ScrapeRecipe(context.Background(), caller, "household", "https://recipes.example")
		}()
	}
	for index := 0; index < maxScrapeAdmissions; index++ {
		<-memberships.entered
	}

	result, err := service.ScrapeRecipe(context.Background(), caller, "household", "https://recipes.example")
	var serviceError *Error
	if result != nil || !errors.As(err, &serviceError) || serviceError.Kind != ErrorResourceExhausted || serviceError.Code != "scrape_capacity" {
		t.Fatalf("over-capacity scrape = (%#v, %#v)", result, err)
	}

	close(memberships.release)
	group.Wait()
}

func TestScrapeRecipeMapsLimitsAndValidatesResult(t *testing.T) {
	caller := authn.Caller{Principal: authn.Principal{Subject: "user"}, AccessToken: "token"}
	tests := []struct {
		name   string
		err    error
		result *ScrapeResult
		kind   ErrorKind
	}{
		{name: "rate", err: ErrScrapeRateLimited, kind: ErrorResourceExhausted},
		{name: "busy", err: ErrScrapeBusy, kind: ErrorResourceExhausted},
		{name: "deadline", err: context.DeadlineExceeded, kind: ErrorDeadlineExceeded},
		{name: "invalid result", result: &ScrapeResult{}, kind: ErrorUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			scraper := &recipeScraperStub{result: test.result, err: test.err}
			service := NewService(nil, scrapeMembershipStub{found: true}, nil, nil, nil, WithRecipeScraper(scraper))
			_, err := service.ScrapeRecipe(context.Background(), caller, "household", "https://recipes.example")
			var serviceError *Error
			if !errors.As(err, &serviceError) || serviceError.Kind != test.kind || scraper.calls != 1 {
				t.Fatalf("error = %#v, calls = %d", err, scraper.calls)
			}
		})
	}
}
