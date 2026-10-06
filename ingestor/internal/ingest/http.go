package ingest

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/AndresZum/gamestats/ingestor/internal/validation"
)

const (
	// MaxBodyBytes limits a POST /api/v1/events body.
	MaxBodyBytes = 5 << 20
	// MaxEventsPerRequest limits the size of an array of events.
	MaxEventsPerRequest = 1000
)

// EventError describes one rejected element of a POST.
type EventError struct {
	Index  int             `json:"index"`
	Reason validation.Code `json:"reason"`
	Detail string          `json:"detail"`
}

// PostResult is the 202 body of POST /api/v1/events.
type PostResult struct {
	Accepted int          `json:"accepted"`
	Rejected int          `json:"rejected"`
	Errors   []EventError `json:"errors"`
}

// EventsHandler serves POST /api/v1/events. It accepts one event object or
// an array of up to MaxEventsPerRequest events.
type EventsHandler struct {
	Intake *Intake
}

func (h *EventsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": fmt.Sprintf("body exceeds %d bytes", MaxBodyBytes)})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read body"})
		return
	}

	// An array is split into its elements. Anything else, including a
	// broken array, is treated as one event so the validator reports the
	// exact problem and it is recorded in rejected.jsonl.
	items := [][]byte{body}
	if trimmed := bytes.TrimSpace(body); len(trimmed) > 0 && trimmed[0] == '[' {
		var arr []json.RawMessage
		if json.Unmarshal(trimmed, &arr) == nil {
			items = make([][]byte, len(arr))
			for i, raw := range arr {
				items[i] = raw
			}
		}
	}
	if len(items) > MaxEventsPerRequest {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("at most %d events per request", MaxEventsPerRequest)})
		return
	}
	// Backpressure: if the pipeline is behind, tell the client to retry
	// instead of holding the connection open.
	if !h.Intake.HasRoom(len(items)) {
		w.Header().Set("Retry-After", "1")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "input buffer is full, retry later"})
		return
	}

	result := PostResult{Errors: []EventError{}}
	for i, raw := range items {
		err := h.Intake.Submit(r.Context(), raw)
		var verr *validation.ValidationError
		switch {
		case err == nil:
			result.Accepted++
		case errors.As(err, &verr):
			result.Rejected++
			result.Errors = append(result.Errors, EventError{Index: i, Reason: verr.Code, Detail: verr.Detail})
		default:
			// The client went away mid-request; nothing to answer.
			return
		}
	}
	writeJSON(w, http.StatusAccepted, result)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
