package ingest

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
)

const (
	configDir   = "../../../configs/games"
	samplesFile = "../../../data/samples/examples.jsonl"
	poll        = 20 * time.Millisecond
)

type env struct {
	intake   *Intake
	input    chan model.Event
	rejected *RejectedWriter
	dataDir  string
}

func newEnv(t *testing.T, buffer int) *env {
	t.Helper()
	reg, err := validation.LoadRegistry(configDir)
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	rej, err := NewRejectedWriter(filepath.Join(dataDir, "rejected", "rejected.jsonl"), 200)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(rej.Close)
	input := make(chan model.Event, buffer)
	dedup := validation.NewDedup(time.Hour)
	return &env{
		intake:   NewIntake(validation.NewValidator(reg), dedup, rej, input),
		input:    input,
		rejected: rej,
		dataDir:  dataDir,
	}
}

// startWatcher runs a DirWatcher until the returned stop func is called.
func (e *env) startWatcher(t *testing.T, idle time.Duration) (offsets *OffsetStore, stop func()) {
	t.Helper()
	offsets = LoadOffsets(filepath.Join(e.dataDir, "state", "offsets.json"))
	w := NewDirWatcher(filepath.Join(e.dataDir, "events"), e.intake, offsets, poll, idle)
	ctx, cancel := context.WithCancel(context.Background())
	go w.Run(ctx)
	stopped := false
	stop = func() {
		if !stopped {
			stopped = true
			cancel()
			w.Wait()
			if err := offsets.Save(); err != nil {
				t.Error(err)
			}
		}
	}
	t.Cleanup(stop)
	return offsets, stop
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// lapEvent builds a valid LAP_COMPLETED line, with its trailing \n.
func lapEvent(matchID string, seq int) string {
	return fmt.Sprintf(`{"schemaVersion":"1.0","eventId":"%s","timestamp":"2026-09-10T14:01:32.410Z","gameId":"racing-pro","gameVersion":"1.0","matchId":"%s","seq":%d,"playerId":"p-ana","type":"LAP_COMPLETED","data":{"lap":%d,"lapTimeMs":92410,"position":7,"topSpeedKmh":318.4}}`+"\n",
		newUUID(), matchID, seq, seq)
}

func appendTo(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
}

func expectEvents(t *testing.T, ch <-chan model.Event, n int, within time.Duration) []model.Event {
	t.Helper()
	var got []model.Event
	deadline := time.After(within)
	for len(got) < n {
		select {
		case ev := <-ch:
			got = append(got, ev)
		case <-deadline:
			t.Fatalf("got %d events within %s, want %d", len(got), within, n)
		}
	}
	return got
}

func expectNone(t *testing.T, ch <-chan model.Event, during time.Duration) {
	t.Helper()
	select {
	case ev := <-ch:
		t.Fatalf("unexpected event seq %d", ev.Seq)
	case <-time.After(during):
	}
}

func (e *env) eventsFile(name string) string {
	return filepath.Join(e.dataDir, "events", "racing-pro", name)
}

func TestAppendedLinesArriveQuickly(t *testing.T) {
	e := newEnv(t, 100)
	file := e.eventsFile("rp-1.jsonl")
	appendTo(t, file, lapEvent("rp-1", 1)+lapEvent("rp-1", 2))
	e.startWatcher(t, time.Minute)
	expectEvents(t, e.input, 2, 2*time.Second)

	start := time.Now()
	appendTo(t, file, lapEvent("rp-1", 3))
	got := expectEvents(t, e.input, 1, 2*time.Second)
	if got[0].Seq != 3 {
		t.Errorf("seq = %d, want 3", got[0].Seq)
	}
	t.Logf("appended line arrived after %s", time.Since(start))
}

func TestIncompleteLineIsReadOnceComplete(t *testing.T) {
	e := newEnv(t, 100)
	file := e.eventsFile("rp-2.jsonl")
	line := lapEvent("rp-2", 1)
	half := len(line) / 2

	e.startWatcher(t, time.Minute)
	appendTo(t, file, line[:half])
	expectNone(t, e.input, 10*poll) // several passes see half a line
	appendTo(t, file, line[half:])

	expectEvents(t, e.input, 1, 2*time.Second)
	expectNone(t, e.input, 5*poll)
	if r := e.rejected.Recent(10); len(r) != 0 {
		t.Fatalf("half line was rejected: %+v", r)
	}
}

func TestRestartDoesNotReprocess(t *testing.T) {
	e := newEnv(t, 100)
	file := e.eventsFile("rp-3.jsonl")
	appendTo(t, file, lapEvent("rp-3", 1)+lapEvent("rp-3", 2)+lapEvent("rp-3", 3))
	_, stop := e.startWatcher(t, time.Minute)
	expectEvents(t, e.input, 3, 2*time.Second)
	stop()

	// Second run: new Intake with an empty Dedup, as after a real restart.
	// Only the offsets file remembers what was read.
	e2 := newEnv(t, 100)
	e2.dataDir = e.dataDir
	e2.startWatcher(t, time.Minute)
	expectNone(t, e2.input, 10*poll)

	appendTo(t, file, lapEvent("rp-3", 4))
	if got := expectEvents(t, e2.input, 1, 2*time.Second); got[0].Seq != 4 {
		t.Errorf("seq = %d, want 4", got[0].Seq)
	}
}

func TestTruncatedFileIsReadFromStart(t *testing.T) {
	e := newEnv(t, 100)
	file := e.eventsFile("rp-4.jsonl")
	appendTo(t, file, lapEvent("rp-4", 1)+lapEvent("rp-4", 2))
	e.startWatcher(t, time.Minute)
	expectEvents(t, e.input, 2, 2*time.Second)

	if err := os.WriteFile(file, []byte(lapEvent("rp-4", 9)), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := expectEvents(t, e.input, 1, 2*time.Second); got[0].Seq != 9 {
		t.Errorf("seq = %d, want 9", got[0].Seq)
	}
}

// A file rewritten with its old lines plus new ones: the old lines are
// read again but Dedup drops them, so rereading is safe.
func TestReplacedFileRereadIsSafe(t *testing.T) {
	e := newEnv(t, 100)
	file := e.eventsFile("rp-5.jsonl")
	old := lapEvent("rp-5", 1) + lapEvent("rp-5", 2)
	appendTo(t, file, old)
	e.startWatcher(t, time.Minute)
	expectEvents(t, e.input, 2, 2*time.Second)

	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	appendTo(t, file, old+lapEvent("rp-5", 3))
	if got := expectEvents(t, e.input, 1, 2*time.Second); got[0].Seq != 3 {
		t.Errorf("seq = %d, want 3", got[0].Seq)
	}
	expectNone(t, e.input, 5*poll)
	time.Sleep(5 * poll) // the writer goroutine records asynchronously
	for _, r := range e.rejected.Recent(10) {
		if r.Reason != validation.CodeDuplicateEvent {
			t.Errorf("unexpected rejection %s", r.Reason)
		}
	}
}

func TestIdleTailerIsReopenedWhenFileGrows(t *testing.T) {
	e := newEnv(t, 100)
	file := e.eventsFile("rp-6.jsonl")
	appendTo(t, file, lapEvent("rp-6", 1))
	e.startWatcher(t, 5*poll)
	expectEvents(t, e.input, 1, 2*time.Second)
	time.Sleep(15 * poll) // tailer closes for inactivity

	appendTo(t, file, lapEvent("rp-6", 2))
	expectEvents(t, e.input, 1, 2*time.Second)
}

// With a full channel the tailer waits; nothing is lost.
func TestBackpressureLosesNothing(t *testing.T) {
	e := newEnv(t, 1)
	file := e.eventsFile("rp-7.jsonl")
	var lines strings.Builder
	for seq := 1; seq <= 20; seq++ {
		lines.WriteString(lapEvent("rp-7", seq))
	}
	appendTo(t, file, lines.String())
	e.startWatcher(t, time.Minute)
	time.Sleep(10 * poll) // let the tailer block on the full channel

	got := expectEvents(t, e.input, 20, 2*time.Second)
	for i, ev := range got {
		if ev.Seq != i+1 {
			t.Fatalf("event %d has seq %d", i, ev.Seq)
		}
	}
}

func readSamplesArray(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(samplesFile)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	return "[" + strings.Join(lines, ",") + "]"
}

func post(t *testing.T, e *env, body string) (*httptest.ResponseRecorder, PostResult) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	(&EventsHandler{Intake: e.intake}).ServeHTTP(rec, req)
	var res PostResult
	if rec.Code == http.StatusAccepted {
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
	}
	return rec, res
}

func TestPostExamplesArray(t *testing.T) {
	e := newEnv(t, 100)
	rec, res := post(t, e, readSamplesArray(t))
	if rec.Code != http.StatusAccepted || res.Accepted != 22 || res.Rejected != 0 {
		t.Fatalf("status %d, result %+v", rec.Code, res)
	}
	if len(e.input) != 22 {
		t.Errorf("%d events queued, want 22", len(e.input))
	}
}

func TestPostReportsEachRejection(t *testing.T) {
	e := newEnv(t, 100)
	valid := strings.TrimSpace(lapEvent("rp-8", 1))
	unknownType := strings.Replace(strings.TrimSpace(lapEvent("rp-8", 2)), "LAP_COMPLETED", "BOOST_USED", 1)
	body := "[" + valid + "," + unknownType + "," + valid + "]"

	rec, res := post(t, e, body)
	if rec.Code != http.StatusAccepted || res.Accepted != 1 || res.Rejected != 2 {
		t.Fatalf("status %d, result %+v", rec.Code, res)
	}
	want := []EventError{{Index: 1, Reason: validation.CodeUnknownType}, {Index: 2, Reason: validation.CodeDuplicateEvent}}
	for i, w := range want {
		if res.Errors[i].Index != w.Index || res.Errors[i].Reason != w.Reason {
			t.Errorf("error %d = %+v, want %+v", i, res.Errors[i], w)
		}
	}

	// The invalid event is written to rejected.jsonl with its code.
	e.rejected.Close() // flushes the file
	f, err := os.Open(filepath.Join(e.dataDir, "rejected", "rejected.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var codes []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var r Rejection
		if err := json.Unmarshal(sc.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		codes = append(codes, string(r.Reason))
		if r.Raw == "" || r.ReceivedAt == "" {
			t.Errorf("incomplete rejection: %+v", r)
		}
	}
	if got := strings.Join(codes, ","); got != "UNKNOWN_TYPE,DUPLICATE_EVENT" {
		t.Errorf("rejected.jsonl codes = %s", got)
	}
}

func TestPostEdgeCases(t *testing.T) {
	t.Run("single object", func(t *testing.T) {
		e := newEnv(t, 10)
		if rec, res := post(t, e, lapEvent("rp-9", 1)); rec.Code != http.StatusAccepted || res.Accepted != 1 {
			t.Fatalf("status %d, result %+v", rec.Code, res)
		}
	})
	t.Run("malformed body", func(t *testing.T) {
		e := newEnv(t, 10)
		rec, res := post(t, e, `[{"seq":1},`)
		if rec.Code != http.StatusAccepted || res.Rejected != 1 || res.Errors[0].Reason != validation.CodeMalformedJSON {
			t.Fatalf("status %d, result %+v", rec.Code, res)
		}
	})
	t.Run("too many events", func(t *testing.T) {
		e := newEnv(t, 2000)
		body := "[" + strings.TrimSuffix(strings.Repeat("{},", MaxEventsPerRequest+1), ",") + "]"
		if rec, _ := post(t, e, body); rec.Code != http.StatusBadRequest {
			t.Fatalf("status %d, want 400", rec.Code)
		}
	})
	t.Run("buffer full", func(t *testing.T) {
		e := newEnv(t, 1)
		e.input <- model.Event{}
		rec, _ := post(t, e, lapEvent("rp-9", 1))
		if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") != "1" {
			t.Fatalf("status %d, Retry-After %q", rec.Code, rec.Header().Get("Retry-After"))
		}
	})
	t.Run("body too large", func(t *testing.T) {
		e := newEnv(t, 10)
		if rec, _ := post(t, e, strings.Repeat(" ", MaxBodyBytes+1)); rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status %d, want 413", rec.Code)
		}
	})
}

func TestRejectedWriterKeepsNewest(t *testing.T) {
	dir := t.TempDir()
	w, err := NewRejectedWriter(filepath.Join(dir, "rejected.jsonl"), 3)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		w.Record([]byte(fmt.Sprint(i)), &validation.ValidationError{Code: validation.CodeMalformedJSON, Detail: "x"})
	}
	w.Close()
	var raws []string
	for _, r := range w.Recent(10) {
		raws = append(raws, r.Raw)
	}
	if got := strings.Join(raws, ","); got != "5,4,3" {
		t.Errorf("Recent = %s, want 5,4,3", got)
	}
}
