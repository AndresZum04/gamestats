package validation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
)

// commonFile holds the event types shared by every game.
const commonFile = "_common.json"

// DataType is the JSON type required for a key inside data.
type DataType string

const (
	TypeNumber  DataType = "number"
	TypeString  DataType = "string"
	TypeBoolean DataType = "boolean"
	TypeArray   DataType = "array"
	TypeObject  DataType = "object"
)

func (t DataType) valid() bool {
	switch t {
	case TypeNumber, TypeString, TypeBoolean, TypeArray, TypeObject:
		return true
	}
	return false
}

// EventRule describes one event type of a game: whether it needs a
// playerId and which data keys are mandatory.
type EventRule struct {
	PlayerRequired bool                `json:"playerRequired"`
	Data           map[string]DataType `json:"data"`
}

// Game is a registered game with its common and own event types merged.
type Game struct {
	id       string
	versions []string
	events   map[string]EventRule
}

// ID returns the gameId.
func (g *Game) ID() string { return g.id }

// SupportsVersion reports whether version is listed in the game config.
func (g *Game) SupportsVersion(version string) bool {
	return slices.Contains(g.versions, version)
}

// Rule returns the rule for an event type, if the game allows it.
func (g *Game) Rule(eventType string) (EventRule, bool) {
	r, ok := g.events[eventType]
	return r, ok
}

// EventTypes returns the allowed event types, sorted.
func (g *Game) EventTypes() []string {
	types := make([]string, 0, len(g.events))
	for t := range g.events {
		types = append(types, t)
	}
	sort.Strings(types)
	return types
}

// Registry is the read-only set of games loaded at startup. It is never
// modified after LoadRegistry returns, so it is safe for concurrent use.
type Registry struct {
	games map[string]*Game
}

// Game looks up a game by its id.
func (r *Registry) Game(gameID string) (*Game, bool) {
	g, ok := r.games[gameID]
	return g, ok
}

// GameIDs returns the registered game ids, sorted.
func (r *Registry) GameIDs() []string {
	ids := make([]string, 0, len(r.games))
	for id := range r.games {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// configFile is the shape of a file in configs/games/.
type configFile struct {
	GameID   string               `json:"gameId"`
	Versions []string             `json:"versions"`
	Events   map[string]EventRule `json:"events"`
}

// LoadRegistry reads _common.json and every other *.json in dir, and merges
// the common events into each game. Any problem in a file stops the load:
// it is better for the ingestor not to start than to validate with
// ambiguous rules.
func LoadRegistry(dir string) (*Registry, error) {
	var common configFile
	if err := readConfig(filepath.Join(dir, commonFile), &common); err != nil {
		return nil, err
	}
	if err := checkEvents(commonFile, common.Events); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read config dir: %w", err)
	}
	games := make(map[string]*Game)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || name == commonFile || filepath.Ext(name) != ".json" {
			continue
		}
		var cfg configFile
		if err := readConfig(filepath.Join(dir, name), &cfg); err != nil {
			return nil, err
		}
		game, err := buildGame(name, cfg, common.Events)
		if err != nil {
			return nil, err
		}
		games[game.id] = game
	}
	if len(games) == 0 {
		return nil, fmt.Errorf("no games found in %s", dir)
	}
	return &Registry{games: games}, nil
}

func buildGame(fileName string, cfg configFile, common map[string]EventRule) (*Game, error) {
	if !gameIDPattern.MatchString(cfg.GameID) {
		return nil, fmt.Errorf("%s: invalid gameId %q", fileName, cfg.GameID)
	}
	// The file name must match the gameId so the config is easy to find.
	if want := cfg.GameID + ".json"; fileName != want {
		return nil, fmt.Errorf("%s: file for gameId %q must be named %s", fileName, cfg.GameID, want)
	}
	if len(cfg.Versions) == 0 || slices.Contains(cfg.Versions, "") {
		return nil, fmt.Errorf("%s: versions must be a non-empty list of non-empty strings", fileName)
	}
	if err := checkEvents(fileName, cfg.Events); err != nil {
		return nil, err
	}

	events := make(map[string]EventRule, len(common)+len(cfg.Events))
	for t, rule := range common {
		events[t] = rule
	}
	for t, rule := range cfg.Events {
		if _, clash := common[t]; clash {
			return nil, fmt.Errorf("%s: type %s is already defined in %s", fileName, t, commonFile)
		}
		events[t] = rule
	}
	return &Game{id: cfg.GameID, versions: cfg.Versions, events: events}, nil
}

func checkEvents(fileName string, events map[string]EventRule) error {
	if len(events) == 0 {
		return fmt.Errorf("%s: events must not be empty", fileName)
	}
	for t, rule := range events {
		if !typePattern.MatchString(t) {
			return fmt.Errorf("%s: event type %q must be UPPER_SNAKE_CASE", fileName, t)
		}
		for key, dt := range rule.Data {
			if key == "" || !dt.valid() {
				return fmt.Errorf("%s: %s.data.%s has invalid type %q", fileName, t, key, dt)
			}
		}
	}
	return nil
}

// readConfig decodes a config file strictly: no duplicated keys and no
// unknown fields, so a typo like "playerRequiered" is caught at startup.
func readConfig(path string, dst *configFile) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}
	name := filepath.Base(path)
	if err := checkDuplicateKeys(raw); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

// checkDuplicateKeys walks the JSON tokens and fails if an object repeats a
// key. encoding/json would silently keep the last one.
func checkDuplicateKeys(raw []byte) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	var walk func(path string) error
	walk = func(path string) error {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		delim, ok := tok.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := make(map[string]bool)
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return err
				}
				key, _ := keyTok.(string)
				if seen[key] {
					return fmt.Errorf("duplicated key %q in %s", key, path)
				}
				seen[key] = true
				if err := walk(path + "." + key); err != nil {
					return err
				}
			}
		case '[':
			for i := 0; dec.More(); i++ {
				if err := walk(fmt.Sprintf("%s[%d]", path, i)); err != nil {
					return err
				}
			}
		}
		_, err = dec.Token() // closing } or ]
		return err
	}
	return walk("$")
}
