// Command ingestor receives, validates and groups game events, then sends
// complete matches to the analyzer.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/AndresZum/gamestats/ingestor/internal/api"
	"github.com/AndresZum/gamestats/ingestor/internal/config"
	"github.com/AndresZum/gamestats/ingestor/internal/ingest"
	"github.com/AndresZum/gamestats/ingestor/internal/model"
	"github.com/AndresZum/gamestats/ingestor/internal/pipeline"
	"github.com/AndresZum/gamestats/ingestor/internal/sender"
	"github.com/AndresZum/gamestats/ingestor/internal/state"
	"github.com/AndresZum/gamestats/ingestor/internal/validation"
)

const (
	tailerIdleTimeout = 5 * time.Minute
	offsetsSaveEvery  = 5 * time.Second
	recentRejections  = 200
	shutdownTimeout   = 15 * time.Second
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("ingestor stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	registry, err := validation.LoadRegistry(cfg.ConfigDir)
	if err != nil {
		return err
	}
	eventsDir := filepath.Join(cfg.DataDir, "events")
	if err := os.MkdirAll(eventsDir, 0o755); err != nil {
		return err
	}
	slog.Info("ingestor starting", "port", cfg.Port, "games", registry.GameIDs(), "eventsDir", eventsDir)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dedup := validation.NewDedup(validation.DefaultDedupTTL)
	go dedup.Run(ctx, validation.DefaultDedupCleanup)

	rejected, err := ingest.NewRejectedWriter(filepath.Join(cfg.DataDir, "rejected", "rejected.jsonl"), recentRejections)
	if err != nil {
		return err
	}
	input := make(chan model.Event, cfg.InputBuffer)
	intake := ingest.NewIntake(validation.NewValidator(registry), dedup, rejected, input)

	offsets := ingest.LoadOffsets(filepath.Join(cfg.DataDir, "state", "offsets.json"))
	go offsets.Run(ctx, offsetsSaveEvery)
	watcher := ingest.NewDirWatcher(eventsDir, intake, offsets, cfg.WatchInterval, tailerIdleTimeout)
	go watcher.Run(ctx)

	matches := state.NewRegistry()
	batches := make(chan model.MatchBatch, cfg.SenderWorkers*2)
	dispatcher := pipeline.NewDispatcher(input, batches, pipeline.Config{
		IdleTimeout: cfg.MatchIdleTimeout,
		FinishGrace: cfg.MatchFinishGrace,
	}, matches, rejected)
	go dispatcher.Run()

	outbox, err := sender.NewOutbox(filepath.Join(cfg.DataDir, "outbox"))
	if err != nil {
		return err
	}
	send := sender.New(sender.DefaultConfig(cfg.AnalyzerURL, cfg.SenderWorkers), matches, outbox)
	go send.RetryOutbox(ctx)
	// After ctx ends the senders park every remaining batch in the outbox.
	consumed := make(chan struct{})
	go func() {
		defer close(consumed)
		send.Run(ctx, batches)
	}()

	handler := (&api.Server{Intake: intake, Rejected: rejected, Registry: matches, Sender: send}).Handler()
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()

	select {
	case <-ctx.Done():
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			stop()
			return err
		}
	}

	// Shutdown order: stop the producers (HTTP and tailers), save where
	// each file was left, then close the input channel. That close travels
	// down the pipeline: the dispatcher flushes open matches as PARTIAL,
	// the senders park them in the outbox (ctx is already cancelled) and
	// return when the batch channel closes.
	slog.Info("shutting down", "timeout", shutdownTimeout.String())
	deadline := time.Now().Add(shutdownTimeout)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		shutdownCtx, cancel := context.WithDeadline(context.Background(), deadline)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		watcher.Wait()
		if err := offsets.Save(); err != nil {
			slog.Error("save offsets", "err", err)
		}
		close(input)
		<-consumed
		rejected.Close()
	}()
	select {
	case <-finished:
		slog.Info("ingestor stopped cleanly", "outboxSize", send.OutboxSize())
		return nil
	case <-time.After(time.Until(deadline)):
		return fmt.Errorf("shutdown took longer than %s", shutdownTimeout)
	}
}
