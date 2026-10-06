package validation

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadRegistryRealConfigs(t *testing.T) {
	reg, err := LoadRegistry(configDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(reg.GameIDs(), ","); got != "arena-clash,chess-lite,racing-pro" {
		t.Fatalf("games = %s", got)
	}
	racing, _ := reg.Game("racing-pro")
	if n := len(racing.EventTypes()); n != 15 { // 10 common + 5 own
		t.Errorf("racing-pro has %d types, want 15", n)
	}
	if r, _ := racing.Rule("MATCH_STARTED"); r.PlayerRequired {
		t.Error("MATCH_STARTED must not require playerId")
	}
	if r, _ := racing.Rule("LAP_COMPLETED"); r.Data["lapTimeMs"] != TypeNumber {
		t.Error("LAP_COMPLETED.lapTimeMs must be a number")
	}
	if _, ok := racing.Rule("MOVE"); ok {
		t.Error("chess MOVE leaked into racing-pro")
	}
}

// copyConfigs puts the real configs plus extra files in a temp dir.
func copyConfigs(t *testing.T, extra map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	entries, err := os.ReadDir(configDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(configDir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		writeFile(t, dir, e.Name(), string(data))
	}
	for name, content := range extra {
		writeFile(t, dir, name, content)
	}
	return dir
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A new game is registered by dropping a JSON file in the config dir;
// no Go code changes.
func TestLoadRegistryNewGameFromTestdata(t *testing.T) {
	card, err := os.ReadFile("testdata/card-duel.json")
	if err != nil {
		t.Fatal(err)
	}
	v := newTestValidator(t, copyConfigs(t, map[string]string{"card-duel.json": string(card)}))

	own := `{"schemaVersion":"1.0","eventId":"5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a801","timestamp":"2026-10-10T16:00:00.000Z","gameId":"card-duel","gameVersion":"0.9","matchId":"cd-1","seq":3,"playerId":"p-ana","type":"CARD_PLAYED","data":{"cardId":"fireball","cost":4}}`
	if _, verr := v.Validate([]byte(own)); verr != nil {
		t.Errorf("own type rejected: %v", verr)
	}
	common := strings.Replace(own, `"type":"CARD_PLAYED","data":{"cardId":"fireball","cost":4}`, `"type":"SCORE_CHANGED","data":{"delta":4,"total":10}`, 1)
	if _, verr := v.Validate([]byte(common)); verr != nil {
		t.Errorf("common type rejected: %v", verr)
	}
	missing := strings.Replace(own, `"cost":4`, `"mana":4`, 1)
	if _, verr := v.Validate([]byte(missing)); verr == nil || verr.Code != CodeMissingDataField {
		t.Errorf("got %v, want MISSING_DATA_FIELD", verr)
	}
}

func TestLoadRegistryErrors(t *testing.T) {
	cases := []struct {
		name    string
		files   map[string]string
		wantErr string
	}{
		{"duplicated type in a game", map[string]string{
			"dup.json": `{"gameId":"dup","versions":["1.0"],"events":{"A_B":{"playerRequired":true,"data":{}},"A_B":{"playerRequired":false,"data":{}}}}`,
		}, "duplicated key"},
		{"game redefines a common type", map[string]string{
			"clash.json": `{"gameId":"clash","versions":["1.0"],"events":{"PLAYER_LEFT":{"playerRequired":true,"data":{}}}}`,
		}, "already defined"},
		{"unknown data type", map[string]string{
			"bad.json": `{"gameId":"bad","versions":["1.0"],"events":{"SHOT":{"playerRequired":true,"data":{"x":"int"}}}}`,
		}, "invalid type"},
		{"file name differs from gameId", map[string]string{
			"other.json": `{"gameId":"golf","versions":["1.0"],"events":{"SHOT":{"playerRequired":true,"data":{}}}}`,
		}, "must be named golf.json"},
		{"no versions", map[string]string{
			"golf.json": `{"gameId":"golf","versions":[],"events":{"SHOT":{"playerRequired":true,"data":{}}}}`,
		}, "versions"},
		{"misspelled field", map[string]string{
			"golf.json": `{"gameId":"golf","versions":["1.0"],"events":{"SHOT":{"playerRequiered":true,"data":{}}}}`,
		}, "unknown field"},
		{"lowercase type", map[string]string{
			"golf.json": `{"gameId":"golf","versions":["1.0"],"events":{"shot":{"playerRequired":true,"data":{}}}}`,
		}, "UPPER_SNAKE_CASE"},
		{"invalid JSON", map[string]string{
			"golf.json": `{"gameId":"golf",`,
		}, "golf.json"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadRegistry(copyConfigs(t, tc.files))
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}

	t.Run("missing _common.json", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "golf.json", `{"gameId":"golf","versions":["1.0"],"events":{"SHOT":{"playerRequired":true,"data":{}}}}`)
		if _, err := LoadRegistry(dir); err == nil {
			t.Fatal("expected error")
		}
	})
}
