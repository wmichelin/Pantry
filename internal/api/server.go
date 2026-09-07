package api

import (
	"log/slog"
	"net/http"

	"github.com/wmichelin/Pantry/internal/authn"
	"github.com/wmichelin/Pantry/internal/httpapi"
	"github.com/wmichelin/Pantry/internal/pantry"
	"github.com/wmichelin/Pantry/internal/rpcapi"
)

const RPCPrefix = "/api/rpc"

func New(verifier authn.Verifier, service *pantry.Service, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.Handle(RPCPrefix+"/", http.StripPrefix(RPCPrefix, rpcapi.New(verifier, service, logger)))
	mux.Handle("/", httpapi.NewWithService(verifier, service, logger))
	return mux
}
