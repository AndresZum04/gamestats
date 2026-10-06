package state

import (
	"testing"
	"time"

	"github.com/AndresZum/gamestats/ingestor/internal/model"
)

var base = time.Date(2026, 9, 10, 14, 0, 0, 0, time.UTC)

func ev(seq int, typ string, player string, data map[string]any) model.Event {
	e := model.Event{
		MatchID: "rp-1", GameID: "racing-pro", GameVersion: "1.0",
		Seq: seq, Type: typ, Data: data,
		Time: base.Add(time.Duration(seq) * time.Second),
	}
	e.Timestamp = model.FormatTime(e.Time)
	if player != "" {
		e.PlayerID = &player
	}
	return e
}

func TestApplyTracksPlayers(t *testing.T) {
	m := NewMatchState(ev(1, "MATCH_STARTED", "", nil))
	now := time.Now()
	// PLAYER_LEFT arrives before MATCH_STARTED: it must not be undone.
	m.Apply(ev(5, "PLAYER_LEFT", "p-luis", map[string]any{"reason": "QUIT"}), now)
	m.Apply(ev(1, "MATCH_STARTED", "", map[string]any{"players": []any{"p-ana", "p-luis", "p-sofi"}}), now)
	m.Apply(ev(2, "PLAYER_DISCONNECTED", "p-sofi", nil), now)
	m.Apply(ev(3, "LAP_COMPLETED", "p-nuevo", nil), now)

	want := map[string]PlayerStatus{
		"p-ana": PlayerActive, "p-luis": PlayerLeft, "p-sofi": PlayerDisconnected, "p-nuevo": PlayerActive,
	}
	for id, st := range want {
		if m.Players[id] != st {
			t.Errorf("%s = %s, want %s", id, m.Players[id], st)
		}
	}
	if s := m.Snapshot(); s.ActivePlayers != 2 || s.EventCount != 4 || s.State != StatusOpen {
		t.Errorf("snapshot = %+v", s)
	}

	m.Apply(ev(4, "PLAYER_RECONNECTED", "p-sofi", nil), now)
	if m.Players["p-sofi"] != PlayerActive {
		t.Error("p-sofi should be active after reconnecting")
	}
}

func TestCompleteNeedsEverySeq(t *testing.T) {
	m := NewMatchState(ev(1, "MATCH_STARTED", "", nil))
	now := time.Now()
	m.Apply(ev(1, "MATCH_STARTED", "", nil), now)
	m.Apply(ev(3, "MATCH_FINISHED", "", nil), now)
	if m.Complete() {
		t.Fatal("seq 2 is missing, match must not be complete")
	}
	m.Apply(ev(2, "LAP_COMPLETED", "p-ana", nil), now)
	if !m.Complete() || m.State != StatusFinished {
		t.Fatalf("complete=%v state=%s", m.Complete(), m.State)
	}
}

func TestBatchSortsAndFillsTimes(t *testing.T) {
	m := NewMatchState(ev(1, "MATCH_STARTED", "", nil))
	now := time.Now()
	for _, seq := range []int{4, 2, 5, 3} {
		m.Apply(ev(seq, "LAP_COMPLETED", "p-ana", nil), now)
	}

	// No MATCH_STARTED and PARTIAL: start is the earliest event, no end.
	b := m.Batch("b-1", model.StatusPartial, now)
	for i, e := range b.Events {
		if e.Seq != i+2 {
			t.Fatalf("event %d has seq %d", i, e.Seq)
		}
	}
	if b.StartedAt != model.FormatTime(base.Add(2*time.Second)) || b.FinishedAt != nil {
		t.Errorf("startedAt=%s finishedAt=%v", b.StartedAt, b.FinishedAt)
	}
	if m.Events[0].Seq != 4 {
		t.Error("Batch must not reorder the stored events")
	}

	m.Apply(ev(6, "MATCH_FINISHED", "", nil), now)
	b = m.Batch("b-2", model.StatusComplete, now)
	if b.FinishedAt == nil || *b.FinishedAt != model.FormatTime(base.Add(6*time.Second)) {
		t.Errorf("finishedAt = %v", b.FinishedAt)
	}
	if b.EventCount != 5 || len(b.Players) != 1 || b.Players[0] != "p-ana" {
		t.Errorf("batch = %+v", b)
	}
}

func TestRegistrySetStateAndCounts(t *testing.T) {
	r := NewRegistry()
	r.Put(Snapshot{MatchID: "a", State: StatusOpen})
	r.Put(Snapshot{MatchID: "b", State: StatusOpen})
	r.SetState("a", StatusSent)
	r.SetState("missing", StatusSent) // ignored
	c := r.CountByState()
	if c[StatusOpen] != 1 || c[StatusSent] != 1 || len(r.List()) != 2 {
		t.Errorf("counts = %v", c)
	}
}
