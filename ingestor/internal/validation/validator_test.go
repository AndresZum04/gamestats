package validation

import (
	"bufio"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

const (
	configDir   = "../../../configs/games"
	samplesFile = "../../../data/samples/examples.jsonl"
)

// fixedNow is after every timestamp in examples.jsonl.
var fixedNow = time.Date(2026, 10, 10, 17, 0, 0, 0, time.UTC)

func newTestValidator(t *testing.T, dir string) *Validator {
	t.Helper()
	reg, err := LoadRegistry(dir)
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}
	v := NewValidator(reg)
	v.now = func() time.Time { return fixedNow }
	return v
}

func readSamples(t *testing.T) []string {
	t.Helper()
	f, err := os.Open(samplesFile)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) != "" {
			lines = append(lines, sc.Text())
		}
	}
	return lines
}

// Every sample line is valid, every registered type has a sample, and the
// accepted event re-encodes to the same JSON it came from.
func TestValidateAcceptsOneSamplePerType(t *testing.T) {
	v := newTestValidator(t, configDir)
	covered := map[string]bool{} // "gameId/TYPE" and "*/TYPE"
	for i, line := range readSamples(t) {
		ev, verr := v.Validate([]byte(line))
		if verr != nil {
			t.Fatalf("line %d rejected: %v", i+1, verr)
		}
		covered[ev.GameID+"/"+ev.Type] = true
		covered["*/"+ev.Type] = true

		out, err := json.Marshal(ev)
		if err != nil {
			t.Fatal(err)
		}
		var want, got any
		_ = json.Unmarshal([]byte(line), &want)
		_ = json.Unmarshal(out, &got)
		if !reflect.DeepEqual(want, got) {
			t.Errorf("line %d changed after validation:\n in: %s\nout: %s", i+1, line, out)
		}
	}

	// A common type needs a sample in any game; a game type, in its game.
	var common configFile
	if err := readConfig(configDir+"/"+commonFile, &common); err != nil {
		t.Fatal(err)
	}
	for _, id := range v.registry.GameIDs() {
		game, _ := v.registry.Game(id)
		for _, typ := range game.EventTypes() {
			key := id + "/" + typ
			if _, isCommon := common.Events[typ]; isCommon {
				key = "*/" + typ
			}
			if !covered[key] {
				t.Errorf("no sample for %s", key)
			}
		}
	}
}

// baseEvent is a valid LAP_COMPLETED that each case modifies.
func baseEvent() map[string]any {
	return map[string]any{
		"schemaVersion": "1.0",
		"eventId":       "0b7d3e11-55aa-4f2c-9d10-7a8b6c5d4e33",
		"timestamp":     "2026-10-10T14:01:32.410Z",
		"gameId":        "racing-pro",
		"gameVersion":   "1.0",
		"matchId":       "rp-0007",
		"seq":           14,
		"playerId":      "p-ana",
		"type":          "LAP_COMPLETED",
		"data":          map[string]any{"lap": 1, "lapTimeMs": 92410, "position": 7, "topSpeedKmh": 318.4},
	}
}

func set(key string, value any) func(map[string]any) {
	return func(e map[string]any) { e[key] = value }
}

func del(key string) func(map[string]any) {
	return func(e map[string]any) { delete(e, key) }
}

func setData(key string, value any) func(map[string]any) {
	return func(e map[string]any) { e["data"].(map[string]any)[key] = value }
}

func delData(key string) func(map[string]any) {
	return func(e map[string]any) { delete(e["data"].(map[string]any), key) }
}

func TestValidateRejections(t *testing.T) {
	v := newTestValidator(t, configDir)

	// raw cases: the body is used as is.
	rawCases := []struct {
		name string
		raw  string
		want Code
	}{
		{"truncated JSON", `{"schemaVersion":"1.0","seq":`, CodeMalformedJSON},
		{"empty line", ``, CodeMalformedJSON},
		{"array instead of object", `[1,2,3]`, CodeMalformedJSON},
		{"JSON null", `null`, CodeMalformedJSON},
		{"string instead of object", `"LAP_COMPLETED"`, CodeMalformedJSON},
		{"two objects on one line", `{} {}`, CodeMalformedJSON},
	}
	for _, tc := range rawCases {
		t.Run(tc.name, func(t *testing.T) {
			_, verr := v.Validate([]byte(tc.raw))
			if verr == nil || verr.Code != tc.want {
				t.Fatalf("got %v, want %s", verr, tc.want)
			}
		})
	}

	inFuture := fixedNow.Add(10 * time.Minute).Format("2006-01-02T15:04:05.000Z")
	cases := []struct {
		name   string
		mutate func(map[string]any)
		want   Code
	}{
		{"no eventId", del("eventId"), CodeMissingField},
		{"no data", del("data"), CodeMissingField},
		{"null timestamp", set("timestamp", nil), CodeMissingField},
		{"empty matchId", set("matchId", ""), CodeMissingField},
		{"empty type", set("type", ""), CodeMissingField},

		{"unsupported schemaVersion", set("schemaVersion", "2.0"), CodeInvalidField},
		{"eventId not a UUID", set("eventId", "event-1"), CodeInvalidField},
		{"eventId UUID v1", set("eventId", "0b7d3e11-55aa-1f2c-9d10-7a8b6c5d4e33"), CodeInvalidField},
		{"eventId uppercase", set("eventId", "0B7D3E11-55AA-4F2C-9D10-7A8B6C5D4E33"), CodeInvalidField},
		{"timestamp without millis", set("timestamp", "2026-10-10T14:01:32Z"), CodeInvalidField},
		{"timestamp with offset", set("timestamp", "2026-10-10T14:01:32.410+00:00"), CodeInvalidField},
		{"timestamp with space", set("timestamp", "2026-10-10 14:01:32.410Z"), CodeInvalidField},
		{"timestamp in the future", set("timestamp", inFuture), CodeInvalidField},
		{"seq zero", set("seq", 0), CodeInvalidField},
		{"seq as string", set("seq", "14"), CodeInvalidField},
		{"seq with decimals", set("seq", 1.5), CodeInvalidField},
		{"matchId with path", set("matchId", "../etc"), CodeInvalidField},
		{"data is a list", set("data", []any{1}), CodeInvalidField},
		{"playerId is a number", set("playerId", 7), CodeInvalidField},
		{"source is a string", set("source", "sim-01"), CodeInvalidField},

		{"unknown gameId", set("gameId", "tetris"), CodeUnknownGame},
		{"unknown gameVersion", set("gameVersion", "9.9"), CodeUnknownGame},

		{"unknown type", set("type", "BOOST_USED"), CodeUnknownType},
		{"type from another game", set("type", "PLAYER_ELIMINATED"), CodeUnknownType},

		{"null playerId", set("playerId", nil), CodeMissingPlayer},
		{"no playerId", del("playerId"), CodeMissingPlayer},
		{"empty playerId", set("playerId", ""), CodeMissingPlayer},

		{"missing data key", delData("lap"), CodeMissingDataField},
		{"null data key", setData("lapTimeMs", nil), CodeMissingDataField},
		{"string instead of number", setData("position", "7"), CodeMissingDataField},
		{"boolean instead of number", setData("topSpeedKmh", true), CodeMissingDataField},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := baseEvent()
			tc.mutate(ev)
			raw, _ := json.Marshal(ev)
			_, verr := v.Validate(raw)
			if verr == nil || verr.Code != tc.want {
				t.Fatalf("got %v, want %s", verr, tc.want)
			}
			if verr.Detail == "" {
				t.Error("rejection without detail")
			}
		})
	}
}

// Rules are applied in table order: with several problems, the first rule
// in the table wins.
func TestValidateRuleOrder(t *testing.T) {
	v := newTestValidator(t, configDir)
	ev := baseEvent()
	delete(ev, "matchId")   // MISSING_FIELD
	ev["seq"] = 0           // INVALID_FIELD
	ev["gameId"] = "tetris" // UNKNOWN_GAME
	raw, _ := json.Marshal(ev)
	if _, verr := v.Validate(raw); verr == nil || verr.Code != CodeMissingField {
		t.Fatalf("got %v, want MISSING_FIELD", verr)
	}
}

func TestValidateTolerances(t *testing.T) {
	v := newTestValidator(t, configDir)
	nearFuture := fixedNow.Add(4 * time.Minute).Format("2006-01-02T15:04:05.000Z")
	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"unknown extra field is ignored", set("region", "LATAM")},
		{"extra data key is kept", setData("weather", "RAIN")},
		{"timestamp 4 minutes ahead", set("timestamp", nearFuture)},
		{"action and source", func(e map[string]any) {
			e["action"] = "CLEAN"
			e["source"] = map[string]any{"consoleId": "c-1", "sessionId": "s-1"}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := baseEvent()
			tc.mutate(ev)
			raw, _ := json.Marshal(ev)
			if _, verr := v.Validate(raw); verr != nil {
				t.Fatalf("rejected: %v", verr)
			}
		})
	}

	t.Run("BOM and CRLF", func(t *testing.T) {
		raw, _ := json.Marshal(baseEvent())
		raw = append([]byte{0xEF, 0xBB, 0xBF}, raw...)
		raw = append(raw, '\r', '\n')
		if _, verr := v.Validate(raw); verr != nil {
			t.Fatalf("rejected: %v", verr)
		}
	})

	t.Run("MATCH_STARTED without playerId", func(t *testing.T) {
		ev := baseEvent()
		delete(ev, "playerId")
		ev["type"] = "MATCH_STARTED"
		ev["data"] = map[string]any{"players": []any{"p-ana"}, "mode": "GRAND_PRIX"}
		raw, _ := json.Marshal(ev)
		got, verr := v.Validate(raw)
		if verr != nil {
			t.Fatalf("rejected: %v", verr)
		}
		if got.PlayerID != nil {
			t.Errorf("PlayerID = %q, want nil", *got.PlayerID)
		}
	})
}

func TestValidateKeepsNumbersExact(t *testing.T) {
	v := newTestValidator(t, configDir)
	ev := baseEvent()
	ev["data"].(map[string]any)["lapTimeMs"] = json.Number("9007199254740993") // > 2^53
	raw, _ := json.Marshal(ev)
	got, verr := v.Validate(raw)
	if verr != nil {
		t.Fatal(verr)
	}
	out, _ := json.Marshal(got.Data)
	if !strings.Contains(string(out), `"lapTimeMs":9007199254740993`) {
		t.Errorf("number changed: %s", out)
	}
	if got.Time != time.Date(2026, 10, 10, 14, 1, 32, 410e6, time.UTC) {
		t.Errorf("Time = %v", got.Time)
	}
}
