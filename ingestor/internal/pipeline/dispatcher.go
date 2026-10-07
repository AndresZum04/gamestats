// Package pipeline routes validated events to one goroutine per match and
// turns finished matches into batches for the analyzer.
package pipeline

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
	"github.com/google/uuid"
)

// workerBuffer is the channel size of each match worker.
const workerBuffer = 256

// Rejecter records rejected events (implemented by ingest.RejectedWriter).
type Rejecter interface {
	Record(raw []byte, verr *validation.ValidationError)
}

// Config tunes when a match is considered over.
type Config struct {
	// IdleTimeout sends a match as PARTIAL after this long without events.
	IdleTimeout time.Duration
	// FinishGrace is how long to wait for missing seqs after MATCH_FINISHED.
	FinishGrace time.Duration
}

// deps is what every worker shares with the dispatcher.
type deps struct {
	cfg        Config
	registry   *state.Registry
	rejecter   Rejecter
	newBatchID func() string
}

// Dispatcher reads the input channel and hands each event to the worker of
// its match, creating the worker the first time a matchId shows up.
type Dispatcher struct {
	in  <-chan model.Event
	out chan<- model.MatchBatch
	deps
}

// NewDispatcher connects the input channel with the batch channel.
func NewDispatcher(in <-chan model.Event, out chan<- model.MatchBatch, cfg Config, reg *state.Registry, rej Rejecter) *Dispatcher {
	return &Dispatcher{
		in:  in,
		out: out,
		deps: deps{
			cfg: cfg, registry: reg, rejecter: rej,
			newBatchID: func() string { return uuid.NewString() },
		},
	}
}

type route struct {
	events chan model.Event
	gameID string
}

// Run blocks until the input channel is closed and every worker has
// emitted its batch; then it closes the output channel.
//
// The workers and closed maps belong to this goroutine only, so they need
// no locks. Workers talk back only through the done channel.
func (d *Dispatcher) Run() {
	workers := make(map[string]route)
	closed := make(map[string]bool)
	done := make(chan string)
	var wg sync.WaitGroup

	for running := true; running; {
		select {
		case ev, ok := <-d.in:
			if !ok {
				running = false
				break
			}
			if closed[ev.MatchID] {
				d.rejectLate(ev)
				continue
			}
			r, exists := workers[ev.MatchID]
			if !exists {
				r = route{events: make(chan model.Event, workerBuffer), gameID: ev.GameID}
				workers[ev.MatchID] = r
				w := &worker{events: r.events, done: done, out: d.out, match: state.NewMatchState(ev), deps: &d.deps}
				wg.Add(1)
				go func() {
					defer wg.Done()
					w.run()
				}()
			} else if r.gameID != ev.GameID {
				d.rejectWrongGame(ev, r.gameID)
				continue
			}
			r.events <- ev
		case id := <-done:
			// The worker is closing: no more events go to it.
			close(workers[id].events)
			delete(workers, id)
			closed[id] = true
		}
	}

	// Shutdown: closing each channel makes its worker send a PARTIAL batch.
	for _, r := range workers {
		close(r.events)
	}
	finished := make(chan struct{})
	go func() {
		wg.Wait()
		close(finished)
	}()
	for {
		select {
		case <-done: // a worker that was already leaving
		case <-finished:
			close(d.out)
			return
		}
	}
}

// rejectWrongGame refuses an event whose matchId already belongs to
// another game: one batch must hold a single game.
func (d *Dispatcher) rejectWrongGame(ev model.Event, gameID string) {
	raw, _ := json.Marshal(ev)
	d.rejecter.Record(raw, &validation.ValidationError{
		Code:   validation.CodeInvalidField,
		Detail: fmt.Sprintf("matchId %s belongs to game %s, not %s", ev.MatchID, gameID, ev.GameID),
	})
}
