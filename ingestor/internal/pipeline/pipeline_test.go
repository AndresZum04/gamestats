package pipeline

import (
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
)

var base = time.Date(2026, 9, 10, 14, 0, 0, 0, time.UTC)

type fakeRejecter struct {
	mu    sync.Mutex
	codes []validation.Code
}

func (f *fakeRejecter) Record(_ []byte, verr *validation.ValidationError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.codes = append(f.codes, verr.Code)
}

func (f *fakeRejecter) count(code validation.Code) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.codes {
		if c == code {
			n++
		}
	}
	return n
}

type harness struct {
	in       chan model.Event
	out      chan model.MatchBatch
	registry *state.Registry
	rej      *fakeRejecter
	stopped  chan struct{}
}

func start(t *testing.T, cfg Config) *harness {
	t.Helper()
	h := &harness{
		in:       make(chan model.Event, 100),
		out:      make(chan model.MatchBatch, 100),
		registry: state.NewRegistry(),
		rej:      &fakeRejecter{},
		stopped:  make(chan struct{}),
	}
	d := NewDispatcher(h.in, h.out, cfg, h.registry, h.rej)
	go func() {
		d.Run()
		close(h.stopped)
	}()
	t.Cleanup(func() {
		defer func() { _ = recover() }() // in may already be closed by the test
		close(h.in)
	})
	return h
}

var defaultCfg = Config{IdleTimeout: time.Minute, FinishGrace: time.Minute}

func event(match string, seq int, typ string) model.Event {
	player := "p-ana"
	e := model.Event{
		EventID: fmt.Sprintf("%s-%d-%d", match, seq, rand.Int()),
		MatchID: match, GameID: "snake", GameVersion: "1.0",
		Seq: seq, Type: typ, PlayerID: &player, Data: map[string]any{},
		Time: base.Add(time.Duration(seq) * time.Second),
	}
	if typ == "MATCH_STARTED" || typ == "MATCH_FINISHED" {
		e.PlayerID = nil
	}
	e.Timestamp = model.FormatTime(e.Time)
	return e
}

// match builds seq 1..n: MATCH_STARTED, food eaten, MATCH_FINISHED.
func match(id string, n int) []model.Event {
	evs := []model.Event{event(id, 1, "MATCH_STARTED")}
	for seq := 2; seq < n; seq++ {
		evs = append(evs, event(id, seq, "FOOD_EATEN"))
	}
	return append(evs, event(id, n, "MATCH_FINISHED"))
}

func receive(t *testing.T, out <-chan model.MatchBatch, within time.Duration) model.MatchBatch {
	t.Helper()
	select {
	case b := <-out:
		return b
	case <-time.After(within):
		t.Fatal("no batch received")
		return model.MatchBatch{}
	}
}

func checkSorted(t *testing.T, b model.MatchBatch, want int) {
	t.Helper()
	if b.EventCount != want || len(b.Events) != want {
		t.Fatalf("%s: %d events, want %d", b.MatchID, len(b.Events), want)
	}
	for i, e := range b.Events {
		if e.Seq != i+1 {
			t.Fatalf("%s: position %d has seq %d", b.MatchID, i, e.Seq)
		}
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// 20 matches sent from 20 goroutines with shuffled events: 20 open matches
// first, then 20 sorted COMPLETE batches.
func TestTwentyMatchesInParallel(t *testing.T) {
	h := start(t, defaultCfg)
	const matches, size = 20, 50

	var wg sync.WaitGroup
	finals := make([]model.Event, matches)
	for i := 0; i < matches; i++ {
		evs := match(fmt.Sprintf("sn-%02d", i), size)
		finals[i] = evs[size-1]
		body := evs[:size-1]
		rand.Shuffle(len(body), func(a, b int) { body[a], body[b] = body[b], body[a] })
		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, e := range body {
				h.in <- e
			}
		}()
	}
	wg.Wait()
	waitFor(t, func() bool {
		open := 0
		for _, s := range h.registry.List() {
			if s.State == state.StatusOpen && s.EventCount == size-1 {
				open++
			}
		}
		return open == matches
	})

	for _, f := range finals {
		h.in <- f
	}
	seen := map[string]bool{}
	for i := 0; i < matches; i++ {
		b := receive(t, h.out, 3*time.Second)
		if b.Status != model.StatusComplete || seen[b.MatchID] {
			t.Fatalf("batch %s status %s (seen before: %v)", b.MatchID, b.Status, seen[b.MatchID])
		}
		seen[b.MatchID] = true
		checkSorted(t, b, size)
	}
	if n := len(h.rej.codes); n != 0 {
		t.Errorf("%d rejections, want 0", n)
	}
}

// MATCH_FINISHED arrives before seq 3: the worker waits for it instead of
// rejecting it as late.
func TestStragglerBeforeFinishIsKept(t *testing.T) {
	h := start(t, defaultCfg)
	evs := match("sn-x", 5)
	for _, i := range []int{0, 1, 3, 4} { // seq 3 held back
		h.in <- evs[i]
	}
	select {
	case b := <-h.out:
		t.Fatalf("batch sent with %d events before seq 3 arrived", b.EventCount)
	case <-time.After(100 * time.Millisecond):
	}
	h.in <- evs[2]
	checkSorted(t, receive(t, h.out, time.Second), 5)
}

func TestFinishGraceSendsWithMissingSeq(t *testing.T) {
	h := start(t, Config{IdleTimeout: time.Minute, FinishGrace: 100 * time.Millisecond})
	evs := match("sn-gap", 4)
	h.in <- evs[0]
	h.in <- evs[2]
	h.in <- evs[3] // seq 2 never arrives
	begin := time.Now()
	b := receive(t, h.out, time.Second)
	if b.Status != model.StatusComplete || b.EventCount != 3 {
		t.Fatalf("status %s, %d events", b.Status, b.EventCount)
	}
	if waited := time.Since(begin); waited < 90*time.Millisecond {
		t.Errorf("sent after %s, before the grace period", waited)
	}
}

func TestLateEvents(t *testing.T) {
	h := start(t, defaultCfg)
	for _, e := range match("sn-late", 3) {
		h.in <- e
	}
	receive(t, h.out, time.Second)

	h.in <- event("sn-late", 2, "FOOD_EATEN")
	waitFor(t, func() bool { return h.rej.count(validation.CodeLateEvent) == 1 })

	// During the grace period, a seq after MATCH_FINISHED is late too.
	h2 := start(t, Config{IdleTimeout: time.Minute, FinishGrace: 200 * time.Millisecond})
	evs := match("sn-late2", 4)
	h2.in <- evs[0]
	h2.in <- evs[3] // finished, seq 2 and 3 missing
	h2.in <- event("sn-late2", 9, "FOOD_EATEN")
	b := receive(t, h2.out, time.Second)
	if b.EventCount != 2 || h2.rej.count(validation.CodeLateEvent) != 1 {
		t.Fatalf("%d events, %d late", b.EventCount, h2.rej.count(validation.CodeLateEvent))
	}
}

func TestIdleMatchIsSentAsPartial(t *testing.T) {
	h := start(t, Config{IdleTimeout: 50 * time.Millisecond, FinishGrace: time.Minute})
	evs := match("sn-idle", 5)
	h.in <- evs[0]
	h.in <- evs[1]
	b := receive(t, h.out, time.Second)
	if b.Status != model.StatusPartial || b.FinishedAt != nil || b.EventCount != 2 {
		t.Fatalf("batch = %s, finishedAt %v, %d events", b.Status, b.FinishedAt, b.EventCount)
	}
}

func TestShutdownFlushesOpenMatches(t *testing.T) {
	h := start(t, defaultCfg)
	for i := 0; i < 3; i++ {
		h.in <- event(fmt.Sprintf("sn-open-%d", i), 1, "MATCH_STARTED")
	}
	waitFor(t, func() bool { return len(h.registry.List()) == 3 })
	close(h.in)

	partial := 0
	for b := range h.out { // the dispatcher closes out when done
		if b.Status == model.StatusPartial {
			partial++
		}
	}
	<-h.stopped
	if partial != 3 {
		t.Fatalf("%d PARTIAL batches, want 3", partial)
	}
}

func TestEventFromAnotherGameIsRejected(t *testing.T) {
	h := start(t, defaultCfg)
	h.in <- event("shared-id", 1, "MATCH_STARTED")
	other := event("shared-id", 2, "FOOD_EATEN")
	other.GameID = "blackjack"
	h.in <- other
	waitFor(t, func() bool { return h.rej.count(validation.CodeInvalidField) == 1 })
}

// Stress for the close handshake: many matches finish while late events
// for them keep coming and the batch consumer is slow. Every late event
// must be rejected exactly once and nothing may deadlock.
func TestClosingMatchesUnderLoad(t *testing.T) {
	h := &harness{
		in:       make(chan model.Event),
		out:      make(chan model.MatchBatch), // unbuffered: workers block on it
		registry: state.NewRegistry(),
		rej:      &fakeRejecter{},
	}
	d := NewDispatcher(h.in, h.out, defaultCfg, h.registry, h.rej)
	go d.Run()

	const matches, late = 50, 5
	go func() {
		for i := 0; i < matches; i++ {
			id := fmt.Sprintf("sn-load-%d", i)
			for _, e := range match(id, 3) {
				h.in <- e
			}
			for j := 0; j < late; j++ {
				h.in <- event(id, 10+j, "FOOD_EATEN")
			}
		}
		close(h.in)
	}()

	got := 0
	for range h.out {
		got++
		time.Sleep(time.Millisecond)
	}
	if got != matches {
		t.Fatalf("%d batches, want %d", got, matches)
	}
	if n := h.rej.count(validation.CodeLateEvent); n != matches*late {
		t.Fatalf("%d late rejections, want %d", n, matches*late)
	}
}
