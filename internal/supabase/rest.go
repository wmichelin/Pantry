package supabase

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HouseholdReader preserves the existing Supabase RLS boundary by accepting
// the verified caller token for every operation. It must never use a
// service-role key or a connection that bypasses RLS.
type HouseholdReader interface {
	ListHouseholds(context.Context, string) ([]Household, error)
}

// MembershipReader preserves the legacy landing-screen query: one caller-visible
// household membership, including the nested household projection.
type MembershipReader interface {
	FindMembership(context.Context, string, string) (*Membership, error)
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

type RESTClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewRESTClient(baseURL, apiKey string) *RESTClient {
	return &RESTClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (client *RESTClient) ListHouseholds(ctx context.Context, accessToken string) ([]Household, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		client.baseURL+"/rest/v1/households?select=id,name,invite_code,created_by,created_at&order=created_at.asc",
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create households request: %w", err)
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+accessToken)

	response, err := client.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request households: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("request households: unexpected status %d", response.StatusCode)
	}

	var households []Household
	if err := json.NewDecoder(response.Body).Decode(&households); err != nil {
		return nil, fmt.Errorf("decode households: %w", err)
	}
	if households == nil {
		households = []Household{}
	}
	return households, nil
}

func (client *RESTClient) FindMembership(ctx context.Context, userID, accessToken string) (*Membership, error) {
	query := url.Values{
		"select":  {"household_id,role,households(id,name,invite_code)"},
		"user_id": {"eq." + userID},
		"limit":   {"1"},
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		client.baseURL+"/rest/v1/household_members?"+query.Encode(),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create membership request: %w", err)
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+accessToken)

	response, err := client.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request membership: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("request membership: unexpected status %d", response.StatusCode)
	}

	var memberships []Membership
	if err := json.NewDecoder(response.Body).Decode(&memberships); err != nil {
		return nil, fmt.Errorf("decode membership: %w", err)
	}
	if len(memberships) == 0 {
		return nil, nil
	}
	return &memberships[0], nil
}
