// Package e2e runs the whole ingestor pipeline (intake, dispatcher, workers
// and senders) against a fake analyzer, without opening the ingestor port.
package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/ingest"
	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/pipeline"
	"github.com/AndresZum04/gamestats/ingestor/internal/sender"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
	"github.com/google/uuid"
)

// fakeAnalyzer stores every batch it receives. It can fail the first
// failFirst requests with 503.
type fakeAnalyzer struct {
	mu        sync.Mutex
	batches   []model.MatchBatch
	failFirst int
	calls     int
}

func (f *fakeAnalyzer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.calls <= f.failFirst {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var b model.MatchBatch
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	f.batches = append(f.batches, b)
	w.WriteHeader(http.StatusOK)
}

func (f *fakeAnalyzer) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fakeAnalyzer) received() []model.MatchBatch {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]model.MatchBatch(nil), f.batches...)
}

// system is a running ingestor pipeline.
type system struct {
	intake   *ingest.Intake
	rejected *ingest.RejectedWriter
	registry *state.Registry
	sender   *sender.Sender
	analyzer *fakeAnalyzer
	stop     func()
}

func startSystem(t *testing.T, pcfg pipeline.Config, analyzer *fakeAnalyzer) *system {
	t.Helper()
	reg, err := validation.LoadRegistry("../../../configs/games")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	rej, err := ingest.NewRejectedWriter(filepath.Join(dir, "rejected", "rejected.jsonl"), 200)
	if err != nil {
		t.Fatal(err)
	}
	outbox, err := sender.NewOutbox(filepath.Join(dir, "outbox"))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(analyzer)

	input := make(chan model.Event, 10000)
	batches := make(chan model.MatchBatch, 8)
	matches := state.NewRegistry()
	scfg := sender.DefaultConfig(srv.URL, 4)
	scfg.Backoff = []time.Duration{10 * time.Millisecond, 20 * time.Millisecond, 40 * time.Millisecond}
	send := sender.New(scfg, matches, outbox)

	go pipeline.NewDispatcher(input, batches, pcfg, matches, rej).Run()
	senderDone := make(chan struct{})
	go func() {
		send.Run(context.Background(), batches)
		close(senderDone)
	}()

	s := &system{
		intake:   ingest.NewIntake(validation.NewValidator(reg), validation.NewDedup(time.Hour), rej, input),
		rejected: rej, registry: matches, sender: send, analyzer: analyzer,
	}
	var once sync.Once
	s.stop = func() {
		once.Do(func() {
			close(input)
			<-senderDone
			rej.Close()
			srv.Close()
		})
	}
	t.Cleanup(s.stop)
	return s
}

// raceMatch returns the raw lines of a racing match with seq 1..n:
// MATCH_STARTED, laps of four drivers, MATCH_FINISHED.
func raceMatch(id string, n int) [][]byte {
	drivers := []string{"p-ana", "p-luis", "p-sofi", "p-kev"}
	at := func(seq int) string {
		return time.Date(2026, 9, 10, 14, 0, 0, 0, time.UTC).Add(time.Duration(seq) * time.Second).Format(model.TimeLayout)
	}
	line := func(seq int, typ string, player any, data map[string]any) []byte {
		raw, _ := json.Marshal(map[string]any{
			"schemaVersion": "1.0", "eventId": uuid.NewString(), "timestamp": at(seq),
			"gameId": "racing-pro", "gameVersion": "1.0", "matchId": id, "seq": seq,
			"playerId": player, "type": typ, "data": data,
		})
		return raw
	}
	lines := [][]byte{line(1, "MATCH_STARTED", nil, map[string]any{"players": drivers, "mode": "GRAND_PRIX"})}
	for seq := 2; seq < n; seq++ {
		lines = append(lines, line(seq, "LAP_COMPLETED", drivers[seq%len(drivers)],
			map[string]any{"lap": seq / len(drivers), "lapTimeMs": 90000 + seq, "position": 1 + seq%len(drivers), "topSpeedKmh": 310.5}))
	}
	return append(lines, line(n, "MATCH_FINISHED", nil, map[string]any{"durationMs": n * 1000, "results": []any{}}))
}

func waitUntil(t *testing.T, within time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// T08.1: 20 matches of 200 events, each sent from its own goroutine in
// shuffled order. The analyzer must get 20 batches, each with its 200
// events exactly once and sorted by seq.
func TestTwentyShuffledMatchesEndToEnd(t *testing.T) {
	const matches, size = 20, 200
	sys := startSystem(t, pipeline.Config{IdleTimeout: time.Minute, FinishGrace: 10 * time.Second}, &fakeAnalyzer{})

	sentIDs := make(map[string]map[string]bool) // matchId -> eventIds
	var wg sync.WaitGroup
	for i := 0; i < matches; i++ {
		id := fmt.Sprintf("rp-e2e-%02d", i)
		lines := raceMatch(id, size)
		ids := make(map[string]bool)
		for _, l := range lines {
			var e struct{ EventID string }
			_ = json.Unmarshal(l, &e)
			ids[e.EventID] = true
		}
		sentIDs[id] = ids
		rand.Shuffle(len(lines), func(a, b int) { lines[a], lines[b] = lines[b], lines[a] })

		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, l := range lines {
				if err := sys.intake.Submit(context.Background(), l); err != nil {
					t.Errorf("%s rejected: %v", id, err)
				}
			}
		}()
	}
	wg.Wait()
	waitUntil(t, 15*time.Second, func() bool { return len(sys.analyzer.received()) == matches })

	for _, b := range sys.analyzer.received() {
		want, ok := sentIDs[b.MatchID]
		if !ok {
			t.Fatalf("unknown match %s", b.MatchID)
		}
		delete(sentIDs, b.MatchID) // a second batch for the same match fails above
		if b.Status != model.StatusComplete || b.EventCount != size || len(b.Events) != size {
			t.Fatalf("%s: status %s, %d events", b.MatchID, b.Status, len(b.Events))
		}
		for i, e := range b.Events {
			if e.Seq != i+1 {
				t.Fatalf("%s: position %d has seq %d", b.MatchID, i, e.Seq)
			}
			if !want[e.EventID] {
				t.Fatalf("%s: event %s missing or duplicated", b.MatchID, e.EventID)
			}
			delete(want, e.EventID)
		}
	}
	if len(sentIDs) != 0 {
		t.Fatalf("%d matches never arrived", len(sentIDs))
	}
	if c := sys.rejected.Counts(); len(c) != 0 {
		t.Errorf("unexpected rejections %v", c)
	}
	waitUntil(t, time.Second, func() bool { return sys.registry.CountByState()[state.StatusSent] == matches })
	if sys.sender.Sent() != matches {
		t.Errorf("sender counted %d batches", sys.sender.Sent())
	}
}

// T08.2: the analyzer fails twice and answers 200 the third time; the
// batch is delivered without touching the outbox.
func TestRetryEndToEnd(t *testing.T) {
	sys := startSystem(t, pipeline.Config{IdleTimeout: time.Minute, FinishGrace: time.Second}, &fakeAnalyzer{failFirst: 2})
	for _, l := range raceMatch("rp-retry", 5) {
		if err := sys.intake.Submit(context.Background(), l); err != nil {
			t.Fatal(err)
		}
	}
	waitUntil(t, 5*time.Second, func() bool { return len(sys.analyzer.received()) == 1 })
	if calls := sys.analyzer.callCount(); calls != 3 || sys.sender.OutboxSize() != 0 {
		t.Fatalf("calls=%d outbox=%d", calls, sys.sender.OutboxSize())
	}
}

// T08.3: with MATCH_IDLE_TIMEOUT=50ms an unfinished match reaches the
// analyzer as PARTIAL.
func TestIdleTimeoutEndToEnd(t *testing.T) {
	sys := startSystem(t, pipeline.Config{IdleTimeout: 50 * time.Millisecond, FinishGrace: time.Second}, &fakeAnalyzer{})
	for _, l := range raceMatch("rp-idle", 10)[:4] { // no MATCH_FINISHED
		if err := sys.intake.Submit(context.Background(), l); err != nil {
			t.Fatal(err)
		}
	}
	waitUntil(t, 3*time.Second, func() bool { return len(sys.analyzer.received()) == 1 })
	b := sys.analyzer.received()[0]
	if b.Status != model.StatusPartial || b.FinishedAt != nil || b.EventCount != 4 {
		t.Fatalf("status %s, finishedAt %v, %d events", b.Status, b.FinishedAt, b.EventCount)
	}
	waitUntil(t, time.Second, func() bool { return sys.registry.CountByState()[state.StatusPartialSent] == 1 })
}

// T08.4: after a match was sent, the same event again is DUPLICATE_EVENT
// and a new event for it is LATE_EVENT.
func TestDuplicateAndLateEndToEnd(t *testing.T) {
	sys := startSystem(t, pipeline.Config{IdleTimeout: time.Minute, FinishGrace: time.Second}, &fakeAnalyzer{})
	lines := raceMatch("rp-closed", 6)
	for _, l := range lines {
		if err := sys.intake.Submit(context.Background(), l); err != nil {
			t.Fatal(err)
		}
	}
	waitUntil(t, 5*time.Second, func() bool { return len(sys.analyzer.received()) == 1 })

	err := sys.intake.Submit(context.Background(), lines[2])
	if verr, ok := err.(*validation.ValidationError); !ok || verr.Code != validation.CodeDuplicateEvent {
		t.Fatalf("resent event: got %v, want DUPLICATE_EVENT", err)
	}
	fresh := raceMatch("rp-closed", 8)[6] // new eventId, seq 7
	if err := sys.intake.Submit(context.Background(), fresh); err != nil {
		t.Fatalf("late event must pass validation, got %v", err)
	}
	waitUntil(t, time.Second, func() bool { return sys.rejected.Counts()[validation.CodeLateEvent] == 1 })
	if n := len(sys.analyzer.received()); n != 1 {
		t.Fatalf("analyzer got %d batches, want 1", n)
	}
}
