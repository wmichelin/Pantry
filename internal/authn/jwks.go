package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const jwksCacheTTL = 10 * time.Minute

type JWKSVerifier struct {
	issuer   string
	audience string
	client   *http.Client

	mu        sync.Mutex
	keys      map[string]any
	fetchedAt time.Time
}

type accessClaims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KeyID     string `json:"kid"`
	KeyType   string `json:"kty"`
	Algorithm string `json:"alg"`
	Curve     string `json:"crv"`
	Modulus   string `json:"n"`
	Exponent  string `json:"e"`
	X         string `json:"x"`
	Y         string `json:"y"`
}

func NewJWKSVerifier(supabaseURL, audience string) (*JWKSVerifier, error) {
	parsedURL, err := url.Parse(supabaseURL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.Path != "" {
		return nil, fmt.Errorf("invalid Supabase issuer origin")
	}
	if audience == "" {
		return nil, fmt.Errorf("JWT audience is required")
	}
	return &JWKSVerifier{
		issuer:   strings.TrimRight(supabaseURL, "/") + "/auth/v1",
		audience: audience,
		client:   &http.Client{Timeout: 5 * time.Second},
		keys:     make(map[string]any),
	}, nil
}

func (verifier *JWKSVerifier) Verify(ctx context.Context, rawToken string) (Principal, error) {
	claims := &accessClaims{}
	parser := jwt.NewParser(
		jwt.WithAudience(verifier.audience),
		jwt.WithIssuer(verifier.issuer),
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg(), jwt.SigningMethodRS384.Alg(), jwt.SigningMethodRS512.Alg(), jwt.SigningMethodES256.Alg(), jwt.SigningMethodES384.Alg(), jwt.SigningMethodES512.Alg(), jwt.SigningMethodEdDSA.Alg()}),
	)
	token, err := parser.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (any, error) {
		keyID, ok := token.Header["kid"].(string)
		if !ok || keyID == "" {
			return nil, fmt.Errorf("token has no key ID")
		}
		return verifier.keyFor(ctx, keyID)
	})
	if err != nil || token == nil || !token.Valid || claims.Subject == "" || claims.Role != "authenticated" {
		return Principal{}, ErrUnauthenticated
	}
	return Principal{Subject: claims.Subject, Role: claims.Role}, nil
}

func (verifier *JWKSVerifier) keyFor(ctx context.Context, keyID string) (any, error) {
	verifier.mu.Lock()
	defer verifier.mu.Unlock()
	if time.Since(verifier.fetchedAt) > jwksCacheTTL || verifier.keys[keyID] == nil {
		if err := verifier.refreshLocked(ctx); err != nil {
			return nil, err
		}
	}
	key := verifier.keys[keyID]
	if key == nil {
		return nil, fmt.Errorf("JWT key %q is not trusted", keyID)
	}
	return key, nil
}

func (verifier *JWKSVerifier) refreshLocked(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, verifier.issuer+"/.well-known/jwks.json", nil)
	if err != nil {
		return fmt.Errorf("create JWKS request: %w", err)
	}
	response, err := verifier.client.Do(request)
	if err != nil {
		return fmt.Errorf("fetch JWKS: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch JWKS: unexpected status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read JWKS: %w", err)
	}
	var document jwksDocument
	if err := json.Unmarshal(body, &document); err != nil {
		return fmt.Errorf("decode JWKS: %w", err)
	}
	keys := make(map[string]any, len(document.Keys))
	for _, encodedKey := range document.Keys {
		key, err := encodedKey.publicKey()
		if err != nil {
			continue
		}
		if encodedKey.KeyID != "" {
			keys[encodedKey.KeyID] = key
		}
	}
	if len(keys) == 0 {
		return fmt.Errorf("JWKS contains no supported asymmetric verification keys")
	}
	verifier.keys = keys
	verifier.fetchedAt = time.Now()
	return nil
}

func (encodedKey jwk) publicKey() (any, error) {
	decode := func(value string) ([]byte, error) {
		return base64.RawURLEncoding.DecodeString(value)
	}
	switch encodedKey.KeyType {
	case "RSA":
		modulus, err := decode(encodedKey.Modulus)
		if err != nil {
			return nil, err
		}
		exponent, err := decode(encodedKey.Exponent)
		if err != nil || len(exponent) == 0 || len(exponent) > 4 {
			return nil, fmt.Errorf("invalid RSA exponent")
		}
		exponentInt := 0
		for _, value := range exponent {
			exponentInt = exponentInt<<8 | int(value)
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponentInt}, nil
	case "EC":
		curve := map[string]elliptic.Curve{"P-256": elliptic.P256(), "P-384": elliptic.P384(), "P-521": elliptic.P521()}[encodedKey.Curve]
		if curve == nil {
			return nil, fmt.Errorf("unsupported EC curve")
		}
		x, err := decode(encodedKey.X)
		if err != nil {
			return nil, err
		}
		y, err := decode(encodedKey.Y)
		if err != nil {
			return nil, err
		}
		publicKey := &ecdsa.PublicKey{Curve: curve, X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
		if !curve.IsOnCurve(publicKey.X, publicKey.Y) {
			return nil, fmt.Errorf("EC point is not on curve")
		}
		return publicKey, nil
	case "OKP":
		if encodedKey.Curve != "Ed25519" {
			return nil, fmt.Errorf("unsupported OKP curve")
		}
		key, err := decode(encodedKey.X)
		if err != nil || len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("invalid Ed25519 key")
		}
		return ed25519.PublicKey(key), nil
	default:
		return nil, fmt.Errorf("unsupported JWK key type")
	}
}
