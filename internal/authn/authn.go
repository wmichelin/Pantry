package authn

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

var ErrUnauthenticated = errors.New("unauthenticated")

// Principal is derived exclusively from a verified Supabase access token.
// Request body fields and user metadata are never authorization inputs.
type Principal struct {
	Subject string
	Role    string
}

type Verifier interface {
	Verify(context.Context, string) (Principal, error)
}

func BearerToken(header http.Header) (string, error) {
	parts := strings.Fields(header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", ErrUnauthenticated
	}
	return parts[1], nil
}

func RequirePrincipal(ctx context.Context, header http.Header, verifier Verifier) (Principal, error) {
	token, err := BearerToken(header)
	if err != nil {
		return Principal{}, err
	}
	principal, err := verifier.Verify(ctx, token)
	if err != nil || principal.Subject == "" || principal.Role != "authenticated" {
		return Principal{}, ErrUnauthenticated
	}
	return principal, nil
}
