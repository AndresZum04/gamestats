// Package validation checks raw events against the common envelope and the
// game registry, and detects duplicated events.
package validation

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/AndresZum/gamestats/ingestor/internal/model"
)

// Code is a rejection reason, written to rejected.jsonl.
type Code string

const (
	CodeMalformedJSON    Code = "MALFORMED_JSON"
	CodeMissingField     Code = "MISSING_FIELD"
	CodeInvalidField     Code = "INVALID_FIELD"
	CodeUnknownGame      Code = "UNKNOWN_GAME"
	CodeUnknownType      Code = "UNKNOWN_TYPE"
	CodeMissingPlayer    Code = "MISSING_PLAYER"
	CodeMissingDataField Code = "MISSING_DATA_FIELD"
	CodeDuplicateEvent   Code = "DUPLICATE_EVENT"
	CodeLateEvent        Code = "LATE_EVENT"
)

// ValidationError is a rejected event: a code plus a human readable detail.
type ValidationError struct {
	Code   Code
	Detail string
}

func (e *ValidationError) Error() string { return string(e.Code) + ": " + e.Detail }

func reject(code Code, format string, args ...any) *ValidationError {
	return &ValidationError{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// SupportedSchemaVersions lists the envelope versions this ingestor reads.
var SupportedSchemaVersions = []string{"1.0"}

// MaxFutureSkew is how far in the future a timestamp may be.
const MaxFutureSkew = 5 * time.Minute

// Patterns shared with schemas/event.schema.json.
var (
	uuidV4Pattern  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	gameIDPattern  = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	matchIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	typePattern    = regexp.MustCompile(`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`)
)

// requiredFields are the mandatory envelope fields, in the order they are
// reported when missing.
var requiredFields = []string{
	"schemaVersion", "eventId", "timestamp", "gameId", "gameVersion",
	"matchId", "seq", "type", "data",
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// rawEvent mirrors the envelope with pointers, so a missing field (nil) can
// be told apart from a zero value.
type rawEvent struct {
	SchemaVersion *string        `json:"schemaVersion"`
	EventID       *string        `json:"eventId"`
	Timestamp     *string        `json:"timestamp"`
	GameID        *string        `json:"gameId"`
	GameVersion   *string        `json:"gameVersion"`
	MatchID       *string        `json:"matchId"`
	Seq           *int           `json:"seq"`
	PlayerID      *string        `json:"playerId"`
	Type          *string        `json:"type"`
	Action        *string        `json:"action"`
	Source        *model.Source  `json:"source"`
	Data          map[string]any `json:"data"`
}

// Validator checks raw events. It only reads the registry, so one Validator
// can be shared by every goroutine.
type Validator struct {
	registry *Registry
	now      func() time.Time
}

// NewValidator creates a Validator that uses the real clock.
func NewValidator(registry *Registry) *Validator {
	return &Validator{registry: registry, now: time.Now}
}

// Validate decodes one event and applies the rules in the order of the
// rejection code table. Duplicates and late events are not checked here:
// see Dedup and the pipeline dispatcher.
func (v *Validator) Validate(raw []byte) (model.Event, *ValidationError) {
	raw = bytes.TrimPrefix(raw, utf8BOM)

	// 1. MALFORMED_JSON: must be exactly one JSON object.
	var fields map[string]json.RawMessage
	err := decodeStrict(raw, &fields)
	var notObject *json.UnmarshalTypeError
	if errors.As(err, &notObject) || (err == nil && fields == nil) {
		return model.Event{}, reject(CodeMalformedJSON, "event must be a JSON object")
	} else if err != nil {
		return model.Event{}, reject(CodeMalformedJSON, "%v", err)
	}
	var r rawEvent
	typeErr := decodeStrict(raw, &r)

	// 2. MISSING_FIELD: absent, null or empty string.
	if missing := missingFields(fields, r); len(missing) > 0 {
		return model.Event{}, reject(CodeMissingField, "missing or empty: %s", strings.Join(missing, ", "))
	}

	// 3. INVALID_FIELD: wrong JSON type or value out of the rules.
	var ute *json.UnmarshalTypeError
	if errors.As(typeErr, &ute) {
		return model.Event{}, reject(CodeInvalidField, "%s must be %s, got %s", ute.Field, jsonKind(ute.Type), ute.Value)
	} else if typeErr != nil {
		return model.Event{}, reject(CodeInvalidField, "%v", typeErr)
	}
	ts, verr := v.checkFields(r)
	if verr != nil {
		return model.Event{}, verr
	}

	// 4. UNKNOWN_GAME and 5. UNKNOWN_TYPE.
	game, ok := v.registry.Game(*r.GameID)
	if !ok {
		return model.Event{}, reject(CodeUnknownGame, "gameId %q is not registered", *r.GameID)
	}
	if !game.SupportsVersion(*r.GameVersion) {
		return model.Event{}, reject(CodeUnknownGame, "gameVersion %q is not registered for %s", *r.GameVersion, game.ID())
	}
	rule, ok := game.Rule(*r.Type)
	if !ok {
		return model.Event{}, reject(CodeUnknownType, "type %s is not allowed for %s", *r.Type, game.ID())
	}

	// 6. MISSING_PLAYER. An empty playerId counts as absent.
	if r.PlayerID != nil && *r.PlayerID == "" {
		r.PlayerID = nil
	}
	if rule.PlayerRequired && r.PlayerID == nil {
		return model.Event{}, reject(CodeMissingPlayer, "type %s requires playerId", *r.Type)
	}

	// 7. MISSING_DATA_FIELD.
	if verr := checkData(*r.Type, rule, r.Data); verr != nil {
		return model.Event{}, verr
	}

	event := model.Event{
		SchemaVersion: *r.SchemaVersion,
		EventID:       *r.EventID,
		Timestamp:     *r.Timestamp,
		GameID:        *r.GameID,
		GameVersion:   *r.GameVersion,
		MatchID:       *r.MatchID,
		Seq:           *r.Seq,
		PlayerID:      r.PlayerID,
		Type:          *r.Type,
		Source:        r.Source,
		Data:          r.Data,
		Time:          ts,
	}
	if r.Action != nil {
		event.Action = *r.Action
	}
	return event, nil
}

// decodeStrict decodes exactly one JSON value and fails on trailing data.
// Numbers inside data stay as json.Number so they are forwarded unchanged.
func decodeStrict(raw []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if _, err := dec.Token(); err == nil {
		return errors.New("unexpected data after the JSON object")
	}
	return nil
}

func missingFields(fields map[string]json.RawMessage, r rawEvent) []string {
	empty := map[string]*string{
		"schemaVersion": r.SchemaVersion, "eventId": r.EventID, "timestamp": r.Timestamp,
		"gameId": r.GameID, "gameVersion": r.GameVersion, "matchId": r.MatchID, "type": r.Type,
	}
	var missing []string
	for _, name := range requiredFields {
		value, present := fields[name]
		if !present || string(value) == "null" {
			missing = append(missing, name)
		} else if s := empty[name]; s != nil && *s == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

// checkFields applies the INVALID_FIELD value rules and returns the parsed
// timestamp.
func (v *Validator) checkFields(r rawEvent) (time.Time, *ValidationError) {
	supported := false
	for _, sv := range SupportedSchemaVersions {
		supported = supported || sv == *r.SchemaVersion
	}
	if !supported {
		return time.Time{}, reject(CodeInvalidField, "schemaVersion %q is not supported", *r.SchemaVersion)
	}
	if !uuidV4Pattern.MatchString(*r.EventID) {
		return time.Time{}, reject(CodeInvalidField, "eventId %q is not a lowercase UUID v4", *r.EventID)
	}
	ts, err := time.Parse(model.TimeLayout, *r.Timestamp)
	if err != nil {
		return time.Time{}, reject(CodeInvalidField, "timestamp %q must look like 2026-10-10T14:03:22.120Z", *r.Timestamp)
	}
	if limit := v.now().Add(MaxFutureSkew); ts.After(limit) {
		return time.Time{}, reject(CodeInvalidField, "timestamp %s is more than %s in the future", *r.Timestamp, MaxFutureSkew)
	}
	if *r.Seq < 1 {
		return time.Time{}, reject(CodeInvalidField, "seq must be >= 1, got %d", *r.Seq)
	}
	if !matchIDPattern.MatchString(*r.MatchID) {
		return time.Time{}, reject(CodeInvalidField, "matchId %q may only contain letters, digits, - and _ (max 128)", *r.MatchID)
	}
	return ts, nil
}

func checkData(eventType string, rule EventRule, data map[string]any) *ValidationError {
	keys := make([]string, 0, len(rule.Data))
	for k := range rule.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys) // stable error messages
	for _, key := range keys {
		want := rule.Data[key]
		value, ok := data[key]
		if !ok || value == nil {
			return reject(CodeMissingDataField, "%s requires data.%s (%s)", eventType, key, want)
		}
		if got := jsonType(value); got != want {
			return reject(CodeMissingDataField, "data.%s must be %s, got %s", key, want, got)
		}
	}
	return nil
}

// jsonKind describes the JSON value expected for a Go destination type.
func jsonKind(t reflect.Type) string {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Int, reflect.Int64:
		return "an integer"
	case reflect.String:
		return "a string"
	default:
		return "an object"
	}
}

// jsonType names the JSON type of a value decoded with UseNumber.
func jsonType(value any) DataType {
	switch value.(type) {
	case json.Number:
		return TypeNumber
	case string:
		return TypeString
	case bool:
		return TypeBoolean
	case []any:
		return TypeArray
	case map[string]any:
		return TypeObject
	}
	return "null"
}
