package authn

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestJWKSVerifierAcceptsOnlyValidAuthenticatedToken(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	key := jwk{
		KeyID:     "test-key",
		KeyType:   "RSA",
		Algorithm: "RS256",
		Modulus:   base64.RawURLEncoding.EncodeToString(privateKey.PublicKey.N.Bytes()),
		Exponent:  base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privateKey.PublicKey.E)).Bytes()),
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/auth/v1/.well-known/jwks.json" {
			http.NotFound(response, request)
			return
		}
		_ = json.NewEncoder(response).Encode(jwksDocument{Keys: []jwk{key}})
	}))
	defer server.Close()

	verifier := &JWKSVerifier{
		issuer:   server.URL + "/auth/v1",
		audience: "authenticated",
		client:   server.Client(),
		keys:     make(map[string]any),
	}

	validToken := signTestToken(t, privateKey, "test-key", verifier.issuer, "authenticated", "authenticated")
	principal, err := verifier.Verify(t.Context(), validToken)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if principal.Subject != "user-123" || principal.Role != "authenticated" {
		t.Fatalf("Verify() principal = %#v", principal)
	}

	wrongAudience := signTestToken(t, privateKey, "test-key", verifier.issuer, "wrong-audience", "authenticated")
	if _, err := verifier.Verify(t.Context(), wrongAudience); err != ErrUnauthenticated {
		t.Fatalf("Verify() wrong audience error = %v, want ErrUnauthenticated", err)
	}

	wrongRole := signTestToken(t, privateKey, "test-key", verifier.issuer, "authenticated", "anon")
	if _, err := verifier.Verify(t.Context(), wrongRole); err != ErrUnauthenticated {
		t.Fatalf("Verify() anon role error = %v, want ErrUnauthenticated", err)
	}
}

func signTestToken(t *testing.T, privateKey *rsa.PrivateKey, keyID, issuer, audience, role string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, accessClaims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user-123",
			Issuer:    issuer,
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
		},
	})
	token.Header["kid"] = keyID
	signed, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}
