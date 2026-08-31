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

// HouseholdCreator and HouseholdJoiner expose the staged atomic membership
// operations. Both preserve the caller JWT so Supabase can derive auth.uid()
// inside the RPC rather than trusting a user ID supplied by the client.
type HouseholdCreator interface {
	CreateHousehold(context.Context, string, string, string) (*CreatedHousehold, error)
}

type HouseholdJoiner interface {
	JoinHouseholdByInvite(context.Context, string, string, string) (*JoinedHousehold, error)
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

func (client *RESTClient) CreateHousehold(ctx context.Context, accessToken, name, displayName string) (*CreatedHousehold, error) {
	var households []CreatedHousehold
	if err := client.callRPC(ctx, accessToken, "create_household", map[string]string{
		"p_name":         name,
		"p_display_name": displayName,
	}, &households); err != nil {
		return nil, err
	}
	if len(households) != 1 {
		return nil, fmt.Errorf("create household: unexpected response shape")
	}
	return &households[0], nil
}

func (client *RESTClient) JoinHouseholdByInvite(ctx context.Context, accessToken, code, displayName string) (*JoinedHousehold, error) {
	var households []JoinedHousehold
	if err := client.callRPC(ctx, accessToken, "join_household_by_invite", map[string]string{
		"p_code":         code,
		"p_display_name": displayName,
	}, &households); err != nil {
		return nil, err
	}
	if len(households) == 0 {
		return nil, nil
	}
	if len(households) != 1 {
		return nil, fmt.Errorf("join household: unexpected response shape")
	}
	return &households[0], nil
}

func (client *RESTClient) callRPC(ctx context.Context, accessToken, function string, input map[string]string, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode %s RPC input: %w", function, err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/rest/v1/rpc/"+function, strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("create %s RPC request: %w", function, err)
	}
	request.Header.Set("apikey", client.apiKey)
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")

	response, err := client.client.Do(request)
	if err != nil {
		return fmt.Errorf("request %s RPC: %w", function, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("request %s RPC: unexpected status %d", function, response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(output); err != nil {
		return fmt.Errorf("decode %s RPC response: %w", function, err)
	}
	return nil
}
