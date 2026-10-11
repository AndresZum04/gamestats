package main

import (
	"bytes"
	"context"
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"
	"time"

	"github.com/AndresZum04/gamestats/simulator/internal/inject"
	"github.com/AndresZum04/gamestats/simulator/internal/match"
)

func fileOptions(out string) options {
	return options{mode: "file", out: out, trivia: 3, snake: 3, blackjack: 3, seed: 42,
		speed: 60, invalidRate: 0.03, batch: 50, scenarios: true}
}

// Criterion of T09: same seed, identical file.
func TestFileModeIsReproducible(t *testing.T) {
	dir := t.TempDir()
	run := func(name string, seed int64) []byte {
		o := fileOptions(filepath.Join(dir, name))
		o.seed = seed
		if err := runRound(context.Background(), o, seed, ""); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(o.out)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	a, b, c := run("a.jsonl", 42), run("b.jsonl", 42), run("c.jsonl", 7)
	if !bytes.Equal(a, b) {
		t.Fatal("two runs with seed 42 differ")
	}
	if bytes.Equal(a, c) {
		t.Fatal("seeds 42 and 7 produced the same file")
	}
}

// rule mirrors one event entry of configs/games/*.json.
type rule struct {
	PlayerRequired bool              `json:"playerRequired"`
	Data           map[string]string `json:"data"`
}

// loadFormat reads the published game configs, the only contract the
// simulator shares with GameStats.
func loadFormat(t *testing.T) map[string]map[string]rule {
	t.Helper()
	read := func(name string) (string, map[string]rule) {
		raw, err := os.ReadFile(filepath.Join("../../../configs/games", name))
		if err != nil {
			t.Fatal(err)
		}
		var cfg struct {
			GameID string          `json:"gameId"`
			Events map[string]rule `json:"events"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			t.Fatal(err)
		}
		return cfg.GameID, cfg.Events
	}
	_, common := read("_common.json")
	games := map[string]map[string]rule{}
	for _, name := range []string{"trivia.json", "snake.json", "blackjack.json"} {
		id, own := read(name)
		all := map[string]rule{}
		for k, v := range common {
			all[k] = v
		}
		for k, v := range own {
			all[k] = v
		}
		games[id] = all
	}
	return games
}

var (
	uuidV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	tsRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
)

func jsonType(v any) string {
	switch v.(type) {
	case float64:
		return "number"
	case string:
		return "string"
	case bool:
		return "boolean"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	}
	return "null"
}

func generate(t *testing.T, o options) []match.Match {
	t.Helper()
	jobs := plan(o, rand.New(rand.NewSource(o.seed)), "")
	out := make([]match.Match, len(jobs))
	for i, j := range jobs {
		b := match.NewBuilder(rand.New(rand.NewSource(o.seed*1_000_003+int64(i))), j.gameID, j.matchID)
		j.build(b)
		out[i] = b.Build()
	}
	return out
}

// Every generated event (without injected problems) follows the format,
// and each match has seq 1..n with MATCH_STARTED first and MATCH_FINISHED
// last.
func TestEventsFollowPublishedFormat(t *testing.T) {
	format := loadFormat(t)
	o := fileOptions("")
	o.trivia, o.snake, o.blackjack = 8, 8, 12
	types := map[string]bool{}
	for _, m := range generate(t, o) {
		ids := map[string]bool{}
		for i, e := range m.Events {
			var ev map[string]any
			if err := json.Unmarshal(match.Render(e, fileBase), &ev); err != nil {
				t.Fatal(err)
			}
			where := m.ID + " " + e.Type
			if !uuidV4.MatchString(ev["eventId"].(string)) || ids[e.EventID] {
				t.Fatalf("%s: bad or repeated eventId %v", where, ev["eventId"])
			}
			ids[e.EventID] = true
			if !tsRe.MatchString(ev["timestamp"].(string)) {
				t.Fatalf("%s: bad timestamp %v", where, ev["timestamp"])
			}
			if int(ev["seq"].(float64)) != i+1 {
				t.Fatalf("%s: event %d has seq %v", where, i, ev["seq"])
			}
			r, ok := format[m.GameID][e.Type]
			if !ok {
				t.Fatalf("%s: type not allowed for %s", where, m.GameID)
			}
			types[m.GameID+"/"+e.Type] = true
			if r.PlayerRequired && ev["playerId"] == nil {
				t.Fatalf("%s: missing playerId", where)
			}
			data := ev["data"].(map[string]any)
			for key, want := range r.Data {
				if got := jsonType(data[key]); got != want {
					t.Fatalf("%s: data.%s is %s, want %s", where, key, got, want)
				}
			}
		}
		if m.Events[0].Type != "MATCH_STARTED" || m.Events[len(m.Events)-1].Type != "MATCH_FINISHED" {
			t.Fatalf("%s: starts with %s, ends with %s", m.ID, m.Events[0].Type, m.Events[len(m.Events)-1].Type)
		}
	}
	// Every type each game is expected to use shows up at least once.
	// PLAYER_ACTION is for games without their own types, so none of the
	// three uses it.
	lifecycle := []string{"MATCH_STARTED", "MATCH_FINISHED", "PLAYER_JOINED"}
	expected := map[string][]string{
		"trivia": append([]string{"QUESTION_SHOWN", "ANSWER_SUBMITTED", "ANSWER_TIMEOUT", "QUESTION_CLOSED",
			"SCORE_CHANGED", "PLAYER_DISCONNECTED", "PLAYER_RECONNECTED"}, lifecycle...),
		"snake": append([]string{"FOOD_EATEN", "POWERUP_PICKED", "LEVEL_UP", "SNAKE_DIED", "PLAYER_RESPAWNED",
			"SCORE_CHANGED"}, lifecycle...),
		"blackjack": append([]string{"ROUND_STARTED", "BET_PLACED", "CARD_DEALT", "DEALER_CARD", "DECISION", "BUST",
			"BLACKJACK", "HAND_RESULT", "TURN_STARTED", "TURN_ENDED", "PLAYER_LEFT"}, lifecycle...),
	}
	var missing []string
	for game, list := range expected {
		for _, typ := range list {
			if !types[game+"/"+typ] {
				missing = append(missing, game+"/"+typ)
			}
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("types never generated: %v", missing)
	}
}

// Each injected problem breaks exactly one rule, so the expected
// rejections can be compared with the ingestor's stats.
func TestInjectedProblems(t *testing.T) {
	o := fileOptions("")
	o.trivia, o.snake, o.blackjack = 6, 6, 6
	o.invalidRate = 0.05
	var total inject.Counts
	defects := map[string]int{}
	lateOK := true
	for _, m := range generate(t, o) {
		m := m
		if m.ID[3:6] == "scn" {
			continue
		}
		total = total.Add(inject.Apply(&m, o.invalidRate))
		seen := map[string]int{}
		finished := 0
		for _, e := range m.Events {
			if e.Defect.Kind != "" {
				defects[e.Defect.Kind]++
				raw := match.Render(e, fileBase)
				if e.Defect.Kind == match.DefectMissingField && bytes.Contains(raw, []byte(`"`+e.Defect.Field+`":`)) {
					t.Fatalf("field %s still present", e.Defect.Field)
				}
				continue
			}
			seen[e.EventID]++
			if e.Type == "MATCH_FINISHED" && finished == 0 {
				finished = e.Seq
			} else if finished > 0 && e.Seq > finished && seen[e.EventID] == 1 {
				lateOK = lateOK && e.Offset > m.Duration
			}
		}
		for _, n := range seen {
			if n > 2 {
				t.Fatal("an event was duplicated more than once")
			}
		}
	}
	if defects[match.DefectMissingField] != total.MissingField || defects[match.DefectUnknownType] != total.UnknownType ||
		defects[match.DefectBadTimestamp] != total.BadTimestamp || defects[match.DefectUnknownGame] != total.UnknownGame {
		t.Fatalf("defects %v do not match counts %+v", defects, total)
	}
	if total.Rejections() == 0 || total.Duplicates == 0 || !lateOK {
		t.Fatalf("counts %+v, late after the end: %v", total, lateOK)
	}
}

func TestNothingHappensAfterTheEnd(t *testing.T) {
	o := fileOptions("")
	o.trivia, o.snake, o.blackjack = 10, 10, 10
	for _, m := range generate(t, o) {
		last := m.Events[len(m.Events)-1]
		for _, e := range m.Events[:len(m.Events)-1] {
			if e.Offset > last.Offset {
				t.Fatalf("%s: %s at %s after MATCH_FINISHED at %s", m.ID, e.Type, e.Offset, last.Offset)
			}
		}
		if last.Data["durationMs"] != int(last.Offset/time.Millisecond) {
			t.Fatalf("%s: durationMs %v, finish at %s", m.ID, last.Data["durationMs"], last.Offset)
		}
	}
}
