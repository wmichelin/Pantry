package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wmichelin/Pantry/internal/authn"
	"github.com/wmichelin/Pantry/internal/config"
	"github.com/wmichelin/Pantry/internal/httpapi"
	"github.com/wmichelin/Pantry/internal/supabase"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid Pantry API configuration", "error", err)
		os.Exit(1)
	}
	households := supabase.NewRESTClient(cfg.SupabaseURL, cfg.SupabaseAnonKey)

	verifier, err := authn.NewJWKSVerifier(cfg.SupabaseURL, cfg.JWTAudience)
	if err != nil {
		slog.Error("configure JWT verifier", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.New(verifier, households, households, households, households, slog.Default()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		slog.Info("Pantry API listening", "addr", cfg.ListenAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Pantry API stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-signalContext.Done()

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("Pantry API shutdown failed", "error", err)
		os.Exit(1)
	}
}
