package supabase

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// HouseholdReader preserves the existing Supabase RLS boundary by accepting
// the verified caller token for every operation. It must never use a
// service-role key or a connection that bypasses RLS.
type HouseholdReader interface {
	ListHouseholds(context.Context, string) ([]Household, error)
}

type Household struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	InviteCode string `json:"invite_code"`
	CreatedBy  string `json:"created_by"`
	CreatedAt  string `json:"created_at"`
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
