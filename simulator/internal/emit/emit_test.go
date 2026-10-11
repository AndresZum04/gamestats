package emit

import (
	"bufio"
	"context"
	"encoding/json"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

// small builds a 3-event match lasting 60 s of game time.
func small(id string) match.Match {
	b := match.NewBuilder(rand.New(rand.NewSource(1)), "trivia", id)
	b.Add(0, "MATCH_STARTED", "", "", map[string]any{"players": []string{"p-ana", "p-luis"}, "mode": "CLASSIC"})
	b.Add(30*time.Second, "TURN_STARTED", "p-ana", "", map[string]any{"turn": 1})
	b.Add(60*time.Second, "MATCH_FINISHED", "", "", map[string]any{"durationMs": 60000, "results": []any{}})
	return b.Build()
}

// Stream at 600x: a 60 s match takes 0.1 s, timestamps keep game time and
// none is ahead of the moment it was written.
func TestStreamPacesAndAnchorsInThePast(t *testing.T) {
	dir := t.TempDir()
	start := time.Now()
	n, err := Stream(context.Background(), dir, []match.Match{small("tv-a"), small("tv-b")}, 600)
	took := time.Since(start)
	if err != nil || n != 6 {
		t.Fatalf("lines=%d err=%v", n, err)
	}
	if took < 90*time.Millisecond || took > 2*time.Second {
		t.Errorf("took %s, want about 100 ms", took)
	}

	f, err := os.Open(filepath.Join(dir, "trivia", "tv-a.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var stamps []time.Time
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var e struct{ Timestamp string }
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatal(err)
		}
		ts, err := time.Parse(match.TimeLayout, e.Timestamp)
		if err != nil {
			t.Fatal(err)
		}
		stamps = append(stamps, ts)
	}
	if len(stamps) != 3 {
		t.Fatalf("%d lines", len(stamps))
	}
	if gap := stamps[2].Sub(stamps[0]); gap != 60*time.Second {
		t.Errorf("game duration in timestamps = %s, want 60s", gap)
	}
	if stamps[2].After(time.Now()) {
		t.Errorf("last timestamp %s is in the future", stamps[2])
	}
}

func TestHTTPSendsBatchesAndWaitsOn503(t *testing.T) {
	var mu sync.Mutex
	calls, events := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if calls == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		var arr []json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&arr); err != nil || len(arr) > 2 {
			t.Errorf("bad array of %d: %v", len(arr), err)
		}
		events += len(arr)
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"accepted": len(arr), "rejected": 0, "errors": []any{}})
	}))
	defer srv.Close()

	res, err := HTTP(context.Background(), srv.URL, []match.Match{small("tv-c"), small("tv-d")}, 6000, 2)
	if err != nil {
		t.Fatal(err)
	}
	if res.Lines != 6 || res.Accepted != 6 || events != 6 {
		t.Fatalf("result %+v, server got %d events", res, events)
	}
}

func TestFileIsReproducible(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 9, 10, 14, 0, 0, 0, time.UTC)
	a, b := filepath.Join(dir, "a.jsonl"), filepath.Join(dir, "b.jsonl")
	if _, err := File(a, []match.Match{small("tv-e")}, base); err != nil {
		t.Fatal(err)
	}
	if _, err := File(b, []match.Match{small("tv-e")}, base); err != nil {
		t.Fatal(err)
	}
	ra, _ := os.ReadFile(a)
	rb, _ := os.ReadFile(b)
	if string(ra) != string(rb) || len(ra) == 0 {
		t.Fatal("same input, different files")
	}
}
