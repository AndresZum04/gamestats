package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/ingest"
	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/sender"
	"github.com/AndresZum04/gamestats/ingestor/internal/state"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
)

const valid = `{"schemaVersion":"1.0","eventId":"0b7d3e11-55aa-4f2c-9d10-7a8b6c5d4e33","timestamp":"2026-09-10T14:01:32.410Z","gameId":"snake","gameVersion":"1.0","matchId":"sn-0007","seq":14,"playerId":"p-kev","type":"FOOD_EATEN","data":{"foodType":"APPLE","length":5,"points":10}}`

func newServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	reg, err := validation.LoadRegistry("../../../configs/games")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	rej, err := ingest.NewRejectedWriter(filepath.Join(dir, "rejected.jsonl"), 200)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(rej.Close)
	ob, err := sender.NewOutbox(filepath.Join(dir, "outbox"))
	if err != nil {
		t.Fatal(err)
	}
	matches := state.NewRegistry()
	s := &Server{
		Intake:   ingest.NewIntake(validation.NewValidator(reg), validation.NewDedup(time.Hour), rej, make(chan model.Event, 10)),
		Rejected: rej,
		Registry: matches,
		Sender:   sender.New(sender.DefaultConfig("http://unused", 1), matches, ob),
	}
	return s, s.Handler()
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

func TestStatsCountsEventsAndRejections(t *testing.T) {
	_, h := newServer(t)
	unknown := strings.Replace(valid, `"snake"`, `"tetris"`, 1)
	do(t, h, http.MethodPost, "/api/v1/events", "["+valid+","+valid+","+unknown+"]")

	rec := do(t, h, http.MethodGet, "/api/v1/stats", "")
	var st Stats
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Received != 3 || st.Accepted != 1 || st.Rejected != 2 {
		t.Fatalf("stats = %+v", st)
	}
	if st.RejectedByCode[validation.CodeDuplicateEvent] != 1 || st.RejectedByCode[validation.CodeUnknownGame] != 1 {
		t.Errorf("by code = %v", st.RejectedByCode)
	}
	if st.Goroutines < 1 {
		t.Error("goroutines must be reported")
	}
}

func TestRejectedEndpoint(t *testing.T) {
	_, h := newServer(t)
	for i := 0; i < 3; i++ {
		do(t, h, http.MethodPost, "/api/v1/events", `{"broken":`)
	}
	time.Sleep(50 * time.Millisecond) // the writer goroutine fills Recent

	rec := do(t, h, http.MethodGet, "/api/v1/rejected?limit=2", "")
	var got []ingest.Rejection
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || len(got) != 2 || got[0].Reason != validation.CodeMalformedJSON {
		t.Fatalf("status %d, %+v", rec.Code, got)
	}
	for _, bad := range []string{"0", "201", "abc"} {
		if rec := do(t, h, http.MethodGet, "/api/v1/rejected?limit="+bad, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("limit=%s: status %d, want 400", bad, rec.Code)
		}
	}
}

func TestMatchEndpoints(t *testing.T) {
	s, h := newServer(t)
	s.Registry.Put(state.Snapshot{
		MatchID: "sn-1", GameID: "snake", State: state.StatusOpen, EventCount: 4, ActivePlayers: 1,
		Players: map[string]state.PlayerStatus{"p-ana": state.PlayerActive, "p-luis": state.PlayerLeft},
	})

	var list []MatchSummary
	_ = json.Unmarshal(do(t, h, http.MethodGet, "/api/v1/matches", "").Body.Bytes(), &list)
	if len(list) != 1 || list[0].EventCount != 4 {
		t.Fatalf("list = %+v", list)
	}
	var d MatchDetail
	_ = json.Unmarshal(do(t, h, http.MethodGet, "/api/v1/matches/sn-1", "").Body.Bytes(), &d)
	if len(d.ConnectedPlayers) != 1 || d.LeftPlayers[0] != "p-luis" {
		t.Fatalf("detail = %+v", d)
	}
	if rec := do(t, h, http.MethodGet, "/api/v1/matches/nope", ""); rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404", rec.Code)
	}
}

func TestRoutingAndHealth(t *testing.T) {
	_, h := newServer(t)
	if rec := do(t, h, http.MethodGet, "/health", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Errorf("health: %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, http.MethodGet, "/api/v1/events", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET events: status %d, want 405", rec.Code)
	}
}

//dashboard test
func TestStatsAllowsTheDashboard(t *testing.T) {
	_, h := newServer(t)
	rec := do(t, h, http.MethodGet, "/api/v1/stats", "")
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", got)
	}
}
