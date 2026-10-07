// Package sender delivers match batches to the analyzer, retrying on
// transient errors and parking undeliverable batches in the outbox.
package sender

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
)

// Config tunes the sender.
type Config struct {
	AnalyzerURL string          // base URL, e.g. http://analyzer:8081
	Workers     int             // goroutines reading the batch channel
	Timeout     time.Duration   // per request
	Backoff     []time.Duration // wait before each retry
	RetryEvery  time.Duration   // outbox retry period
}

// DefaultConfig returns the values of the specification.
func DefaultConfig(analyzerURL string, workers int) Config {
	return Config{
		AnalyzerURL: analyzerURL,
		Workers:     workers,
		Timeout:     10 * time.Second,
		Backoff:     []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second},
		RetryEvery:  30 * time.Second,
	}
}

// errPermanent marks answers that will not change on retry (4xx but 429).
var errPermanent = errors.New("analyzer refused the batch")

// Sender posts batches to POST {AnalyzerURL}/api/v1/matches.
type Sender struct {
	cfg      Config
	client   *http.Client
	registry *state.Registry
	outbox   *Outbox

	sent   atomic.Int64 // batches delivered
	failed atomic.Int64 // batches refused or parked in the outbox
}

// New creates a Sender.
func New(cfg Config, registry *state.Registry, outbox *Outbox) *Sender {
	return &Sender{
		cfg:      cfg,
		client:   &http.Client{Timeout: cfg.Timeout},
		registry: registry,
		outbox:   outbox,
	}
}

// Sent returns how many batches were delivered.
func (s *Sender) Sent() int64 { return s.sent.Load() }

// Failed returns how many batches could not be delivered right away.
func (s *Sender) Failed() int64 { return s.failed.Load() }

// OutboxSize returns how many batches wait in the outbox.
func (s *Sender) OutboxSize() int { return s.outbox.Size() }

// Run starts the worker pool and blocks until batches is closed and every
// batch was delivered or parked. Once ctx ends (shutdown), remaining
// batches go straight to the outbox instead of waiting for retries.
func (s *Sender) Run(ctx context.Context, batches <-chan model.MatchBatch) {
	var wg sync.WaitGroup
	for i := 0; i < s.cfg.Workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for b := range batches {
				s.deliver(ctx, b)
			}
		}()
	}
	wg.Wait()
}

func (s *Sender) deliver(ctx context.Context, b model.MatchBatch) {
	err := s.sendWithRetries(ctx, b)
	switch {
	case err == nil:
		s.markDelivered(b)
	case errors.Is(err, errPermanent):
		s.failed.Add(1)
		s.registry.SetState(b.MatchID, state.StatusSendFailed)
		slog.Error("analyzer refused batch", "matchId", b.MatchID, "err", err)
	default:
		s.failed.Add(1)
		s.registry.SetState(b.MatchID, state.StatusSendFailed)
		if serr := s.outbox.Save(b); serr != nil {
			slog.Error("batch lost: cannot write outbox", "matchId", b.MatchID, "err", serr)
			return
		}
		slog.Warn("batch parked in outbox", "matchId", b.MatchID, "err", err)
	}
}

func (s *Sender) markDelivered(b model.MatchBatch) {
	s.sent.Add(1)
	st := state.StatusSent
	if b.Status == model.StatusPartial {
		st = state.StatusPartialSent
	}
	s.registry.SetState(b.MatchID, st)
	slog.Info("batch sent", "matchId", b.MatchID, "status", b.Status, "events", b.EventCount)
}

// sendWithRetries makes the first attempt plus one retry per Backoff entry.
func (s *Sender) sendWithRetries(ctx context.Context, b model.MatchBatch) error {
	body, err := json.Marshal(b)
	if err != nil {
		return fmt.Errorf("%w: %v", errPermanent, err)
	}
	for attempt := 0; ; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err() // shutting down: park it, do not wait
		}
		err = s.post(ctx, body)
		if err == nil || errors.Is(err, errPermanent) || attempt == len(s.cfg.Backoff) {
			return err
		}
		slog.Warn("send failed, retrying", "matchId", b.MatchID, "attempt", attempt+1, "err", err)
		select {
		case <-time.After(s.cfg.Backoff[attempt]):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// post makes one request. It returns nil on 2xx, errPermanent on a 4xx
// other than 429, and a plain error for network problems, 5xx and 429.
func (s *Sender) post(ctx context.Context, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.AnalyzerURL+"/api/v1/matches", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%w: %v", errPermanent, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<10))

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return fmt.Errorf("analyzer answered %d: %s", resp.StatusCode, bytes.TrimSpace(msg))
	default:
		return fmt.Errorf("%w: %d %s", errPermanent, resp.StatusCode, bytes.TrimSpace(msg))
	}
}

// RetryOutbox resends the outbox at start and every RetryEvery until ctx
// ends. Each file gets one attempt per round: the round itself is the retry.
func (s *Sender) RetryOutbox(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.RetryEvery)
	defer ticker.Stop()
	for {
		s.retryOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Sender) retryOnce(ctx context.Context) {
	entries, err := s.outbox.entries()
	if err != nil {
		slog.Error("read outbox", "err", err)
		return
	}
	for _, e := range entries {
		if ctx.Err() != nil {
			return
		}
		b, err := s.outbox.load(e)
		if err != nil {
			slog.Error("corrupt outbox file", "file", e.path, "err", err)
			_ = s.outbox.quarantine(e, "corrupt")
			continue
		}
		body, _ := json.Marshal(b)
		err = s.post(ctx, body)
		switch {
		case err == nil:
			if err := s.outbox.removeIfUnchanged(e); err != nil {
				slog.Error("remove outbox file", "file", e.path, "err", err)
			}
			s.markDelivered(b)
		case errors.Is(err, errPermanent):
			slog.Error("analyzer refused outbox batch", "matchId", b.MatchID, "err", err)
			_ = s.outbox.quarantine(e, "refused")
		default:
			// The analyzer is still down: the rest would fail the same way.
			slog.Info("outbox retry postponed", "pending", len(entries), "err", err)
			return
		}
	}
}
