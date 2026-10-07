package pipeline

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
)

// worker owns one match: it is the only goroutine that reads or writes its
// MatchState, so the state needs no locks.
type worker struct {
	events <-chan model.Event      // from the dispatcher
	done   chan<- string           // tells the dispatcher "I am closing"
	out    chan<- model.MatchBatch // to the senders
	match  *state.MatchState
	deps   *deps
}

func (w *worker) run() {
	// Check idleness every 5 s, or more often when the timeout is short
	// (tests use 50 ms).
	interval := max(min(5*time.Second, w.deps.cfg.IdleTimeout/2), time.Millisecond)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var grace <-chan time.Time // nil (blocks forever) until MATCH_FINISHED

	status, shutdown := w.collect(ticker.C, &grace)
	if !shutdown {
		w.leave()
	}

	w.match.State = state.StatusFinished
	w.publish()
	batch := w.match.Batch(w.deps.newBatchID(), status, time.Now())
	slog.Info("match batch ready", "matchId", batch.MatchID, "status", batch.Status, "events", batch.EventCount)
	w.out <- batch

	// After leave, the dispatcher closes events. Anything still queued
	// arrived after the match was closed.
	if w.events != nil {
		for ev := range w.events {
			w.deps.rejectLate(ev)
		}
	}
}

// collect applies events until the match is ready to be sent. shutdown is
// true when the dispatcher closed the channel because the ingestor is
// stopping; the match is then sent as PARTIAL.
func (w *worker) collect(tick <-chan time.Time, grace *<-chan time.Time) (status model.BatchStatus, shutdown bool) {
	for {
		select {
		case ev, ok := <-w.events:
			if !ok {
				w.events = nil
				return model.StatusPartial, true
			}
			if w.match.FinishedSeq > 0 && ev.Seq > w.match.FinishedSeq {
				// After MATCH_FINISHED only stragglers with a lower seq are
				// still part of the match.
				w.deps.rejectLate(ev)
				continue
			}
			w.match.Apply(ev, time.Now())
			w.publish()
			if w.match.Complete() {
				return model.StatusComplete, false
			}
			if w.match.FinishedSeq > 0 && *grace == nil {
				*grace = time.After(w.deps.cfg.FinishGrace)
			}
		case <-*grace:
			slog.Warn("match finished with missing seqs", "matchId", w.match.MatchID)
			return model.StatusComplete, false
		case <-tick:
			if time.Since(w.match.LastEventAt) >= w.deps.cfg.IdleTimeout {
				return model.StatusPartial, false
			}
		}
	}
}

// leave tells the dispatcher this match is closing. While waiting, it keeps
// reading its channel, otherwise the dispatcher could block sending to it
// while it blocks sending to the dispatcher.
func (w *worker) leave() {
	for {
		select {
		case w.done <- w.match.MatchID:
			return
		case ev, ok := <-w.events:
			if !ok { // the ingestor started shutting down meanwhile
				w.events = nil
				continue
			}
			w.deps.rejectLate(ev)
		}
	}
}

func (w *worker) publish() {
	w.deps.registry.Put(w.match.Snapshot())
}

// rejectLate records ev as LATE_EVENT. The raw line is rebuilt from the
// event, since by now only the parsed version exists.
func (d *deps) rejectLate(ev model.Event) {
	raw, _ := json.Marshal(ev)
	d.rejecter.Record(raw, &validation.ValidationError{
		Code:   validation.CodeLateEvent,
		Detail: fmt.Sprintf("match %s was already closed", ev.MatchID),
	})
}
