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

// Caller contains the verified identity and the original access token. The
// token is forwarded to Supabase so auth.uid() and RLS remain authoritative.
type Caller struct {
	Principal   Principal
	AccessToken string
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
	caller, err := RequireCaller(ctx, header, verifier)
	if err != nil {
		return Principal{}, err
	}
	return caller.Principal, nil
}

func RequireCaller(ctx context.Context, header http.Header, verifier Verifier) (Caller, error) {
	token, err := BearerToken(header)
	if err != nil {
		return Caller{}, err
	}
	principal, err := verifier.Verify(ctx, token)
	if err != nil || principal.Subject == "" || principal.Role != "authenticated" {
		return Caller{}, ErrUnauthenticated
	}
	return Caller{Principal: principal, AccessToken: token}, nil
}

type callerContextKey struct{}

func ContextWithCaller(ctx context.Context, caller Caller) context.Context {
	return context.WithValue(ctx, callerContextKey{}, caller)
}

func CallerFromContext(ctx context.Context) (Caller, bool) {
	caller, ok := ctx.Value(callerContextKey{}).(Caller)
	return caller, ok
}
