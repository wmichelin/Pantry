package authn

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

type verifierStub struct {
	principal Principal
	err       error
}

func (stub verifierStub) Verify(context.Context, string) (Principal, error) {
	return stub.principal, stub.err
}

func TestRequirePrincipal(t *testing.T) {
	tests := []struct {
		name    string
		header  string
		stub    verifierStub
		wantErr bool
	}{
		{name: "valid authenticated user", header: "Bearer access-token", stub: verifierStub{principal: Principal{Subject: "user-1", Role: "authenticated"}}},
		{name: "missing header", wantErr: true},
		{name: "wrong scheme", header: "Basic access-token", wantErr: true},
		{name: "verification failure", header: "Bearer access-token", stub: verifierStub{err: errors.New("bad token")}, wantErr: true},
		{name: "wrong role", header: "Bearer access-token", stub: verifierStub{principal: Principal{Subject: "user-1", Role: "anon"}}, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			header := make(http.Header)
			if tt.header != "" {
				header.Set("Authorization", tt.header)
			}
			_, err := RequirePrincipal(context.Background(), header, tt.stub)
			if (err != nil) != tt.wantErr {
				t.Fatalf("RequirePrincipal() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
