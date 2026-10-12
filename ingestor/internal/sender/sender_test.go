package sender

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
)

// fakeAnalyzer answers each POST with the next status of script, then
// with the last one forever. It records the batches it accepted.
type fakeAnalyzer struct {
	srv      *httptest.Server
	mu       sync.Mutex
	script   []int
	calls    atomic.Int32
	accepted []model.MatchBatch
}

func newFakeAnalyzer(t *testing.T, script ...int) *fakeAnalyzer {
	f := &fakeAnalyzer{script: script}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/matches" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		n := int(f.calls.Add(1))
		f.mu.Lock()
		status := f.script[min(n, len(f.script))-1]
		f.mu.Unlock()
		if status == http.StatusOK {
			var b model.MatchBatch
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				t.Errorf("bad body: %v", err)
			}
			f.mu.Lock()
			f.accepted = append(f.accepted, b)
			f.mu.Unlock()
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAnalyzer) setScript(script ...int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.script = script
	f.calls.Store(0)
}

func newSender(t *testing.T, url string, matchIDs ...string) (*Sender, *state.Registry, *Outbox) {
	t.Helper()
	reg := state.NewRegistry()
	for _, id := range matchIDs {
		reg.Put(state.Snapshot{MatchID: id, State: state.StatusFinished})
	}
	ob, err := NewOutbox(filepath.Join(t.TempDir(), "outbox"))
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{
		AnalyzerURL: url, Workers: 2, Timeout: time.Second,
		Backoff:    []time.Duration{time.Millisecond, 2 * time.Millisecond, 4 * time.Millisecond},
		RetryEvery: 50 * time.Millisecond,
	}
	return New(cfg, reg, ob), reg, ob
}

func batch(id string, status model.BatchStatus) model.MatchBatch {
	return model.MatchBatch{BatchID: "b-" + id, MatchID: id, GameID: "snake", Status: status, Events: []model.Event{}}
}

func stateOf(reg *state.Registry, id string) state.MatchStatus {
	s, _ := reg.Get(id)
	return s.State
}

func TestRetriesThenSucceeds(t *testing.T) {
	for _, failure := range []int{http.StatusInternalServerError, http.StatusTooManyRequests} {
		f := newFakeAnalyzer(t, failure, failure, http.StatusOK)
		s, reg, ob := newSender(t, f.srv.URL, "sn-1")
		s.deliver(context.Background(), batch("sn-1", model.StatusComplete))

		if f.calls.Load() != 3 || stateOf(reg, "sn-1") != state.StatusSent || ob.Size() != 0 {
			t.Fatalf("status %d: calls=%d state=%s outbox=%d", failure, f.calls.Load(), stateOf(reg, "sn-1"), ob.Size())
		}
	}
}

func TestPartialBatchIsMarkedPartialSent(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusOK)
	s, reg, _ := newSender(t, f.srv.URL, "sn-2")
	s.deliver(context.Background(), batch("sn-2", model.StatusPartial))
	if stateOf(reg, "sn-2") != state.StatusPartialSent || s.Sent() != 1 {
		t.Fatalf("state=%s sent=%d", stateOf(reg, "sn-2"), s.Sent())
	}
}

func TestBadRequestIsNotRetried(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusBadRequest)
	s, reg, ob := newSender(t, f.srv.URL, "sn-3")
	s.deliver(context.Background(), batch("sn-3", model.StatusComplete))
	if f.calls.Load() != 1 || stateOf(reg, "sn-3") != state.StatusSendFailed || ob.Size() != 0 {
		t.Fatalf("calls=%d state=%s outbox=%d", f.calls.Load(), stateOf(reg, "sn-3"), ob.Size())
	}
}

func TestExhaustedRetriesGoToOutbox(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusServiceUnavailable)
	s, reg, ob := newSender(t, f.srv.URL, "sn-4")
	s.deliver(context.Background(), batch("sn-4", model.StatusComplete))
	if f.calls.Load() != 4 { // first attempt + 3 retries
		t.Errorf("calls = %d, want 4", f.calls.Load())
	}
	if stateOf(reg, "sn-4") != state.StatusSendFailed || ob.Size() != 1 {
		t.Fatalf("state=%s outbox=%d", stateOf(reg, "sn-4"), ob.Size())
	}
}

func TestAnalyzerDownGoesToOutbox(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusOK)
	url := f.srv.URL
	f.srv.Close() // connection refused
	s, _, ob := newSender(t, url, "sn-5")
	s.deliver(context.Background(), batch("sn-5", model.StatusComplete))
	if ob.Size() != 1 {
		t.Fatalf("outbox = %d, want 1", ob.Size())
	}
}

// The T06 criterion: with the analyzer down, batches stay in the outbox;
// once it is back, the retrier delivers them and empties the outbox.
func TestOutboxIsDeliveredWhenAnalyzerReturns(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusServiceUnavailable)
	ids := []string{"sn-a", "sn-b", "sn-c"}
	s, reg, ob := newSender(t, f.srv.URL, ids...)

	batches := make(chan model.MatchBatch, len(ids))
	for _, id := range ids {
		batches <- batch(id, model.StatusComplete)
	}
	close(batches)
	s.Run(context.Background(), batches)
	if ob.Size() != 3 {
		t.Fatalf("outbox = %d, want 3", ob.Size())
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.RetryOutbox(ctx)
	time.Sleep(120 * time.Millisecond) // two rounds while still down
	if ob.Size() != 3 {
		t.Fatalf("outbox = %d while analyzer is down", ob.Size())
	}

	f.setScript(http.StatusOK)
	deadline := time.Now().Add(2 * time.Second)
	for ob.Size() > 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	f.mu.Lock()
	accepted := len(f.accepted)
	f.mu.Unlock()
	if ob.Size() != 0 || accepted != 3 {
		t.Fatalf("outbox=%d accepted=%d", ob.Size(), accepted)
	}
	for _, id := range ids {
		if stateOf(reg, id) != state.StatusSent {
			t.Errorf("%s state = %s", id, stateOf(reg, id))
		}
	}
}

func TestShutdownParksWithoutCalling(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusOK)
	s, _, ob := newSender(t, f.srv.URL, "sn-6")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.deliver(ctx, batch("sn-6", model.StatusPartial))
	if f.calls.Load() != 0 || ob.Size() != 1 {
		t.Fatalf("calls=%d outbox=%d", f.calls.Load(), ob.Size())
	}
}

func TestOutboxKeepsBatchRewrittenDuringRetry(t *testing.T) {
	ob, err := NewOutbox(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_ = ob.Save(batch("sn-7", model.StatusPartial))
	listed, _ := ob.entries()

	newer := batch("sn-7", model.StatusComplete)
	newer.Players = []string{"p-ana"} // different size
	_ = ob.Save(newer)
	_ = ob.removeIfUnchanged(listed[0])
	if ob.Size() != 1 {
		t.Fatal("the newer batch was deleted")
	}
}

func TestCorruptOutboxFileIsQuarantined(t *testing.T) {
	f := newFakeAnalyzer(t, http.StatusOK)
	s, _, ob := newSender(t, f.srv.URL)
	if err := os.WriteFile(filepath.Join(ob.dir, "broken.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.retryOnce(context.Background())
	if ob.Size() != 0 || f.calls.Load() != 0 {
		t.Fatalf("outbox=%d calls=%d", ob.Size(), f.calls.Load())
	}
	if _, err := os.Stat(filepath.Join(ob.dir, "broken.json.failed")); err != nil {
		t.Fatal("corrupt file should be kept as .failed")
	}
}
