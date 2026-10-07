// Package ingest gets events into the ingestor: it tails the shared events
// folder, receives events over HTTP and records rejected ones.
package ingest

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/AndresZum04/gamestats/ingestor/internal/model"
	"github.com/AndresZum04/gamestats/ingestor/internal/validation"
)

// maxRawBytes caps how much of a rejected line is stored.
const maxRawBytes = 8 << 10

// Rejection is one line of rejected/rejected.jsonl.
type Rejection struct {
	ReceivedAt string          `json:"receivedAt"`
	Reason     validation.Code `json:"reason"`
	Detail     string          `json:"detail"`
	Raw        string          `json:"raw"`
}

// RejectedWriter appends rejections to a file. A single goroutine owns the
// file and receives rejections through a channel, so writes from many
// tailers never interleave and no lock is needed around the file.
type RejectedWriter struct {
	ch        chan Rejection
	done      chan struct{}
	closeOnce sync.Once
	keep      int

	mu     sync.RWMutex
	recent []Rejection // last keep rejections, oldest first

	countsMu sync.Mutex
	counts   map[validation.Code]int64
}

// NewRejectedWriter opens (or creates) path for appending and starts the
// writer goroutine. keep is how many rejections Recent can return.
func NewRejectedWriter(path string, keep int) (*RejectedWriter, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open rejected file: %w", err)
	}
	w := &RejectedWriter{
		ch: make(chan Rejection, 1024), done: make(chan struct{}), keep: keep,
		counts: make(map[validation.Code]int64),
	}
	go w.run(f)
	return w, nil
}

// Record queues a rejection. It must not be called after Close.
func (w *RejectedWriter) Record(raw []byte, verr *validation.ValidationError) {
	// Counted here, not in the writer goroutine, so /stats agrees with an
	// HTTP answer the moment it is returned.
	w.countsMu.Lock()
	w.counts[verr.Code]++
	w.countsMu.Unlock()
	if len(raw) > maxRawBytes {
		raw = append(raw[:maxRawBytes:maxRawBytes], "...(truncated)"...)
	}
	w.ch <- Rejection{
		ReceivedAt: model.FormatTime(time.Now()),
		Reason:     verr.Code,
		Detail:     verr.Detail,
		Raw:        string(raw),
	}
}

func (w *RejectedWriter) run(f *os.File) {
	defer close(w.done)
	defer f.Close()
	enc := json.NewEncoder(f) // Encode adds the trailing \n
	for r := range w.ch {
		if err := enc.Encode(r); err != nil {
			slog.Error("write rejected event", "err", err)
		}
		w.mu.Lock()
		w.recent = append(w.recent, r)
		if len(w.recent) > w.keep {
			w.recent = w.recent[len(w.recent)-w.keep:]
		}
		w.mu.Unlock()
	}
}

// Recent returns up to limit rejections, newest first.
func (w *RejectedWriter) Recent(limit int) []Rejection {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if limit <= 0 || limit > len(w.recent) {
		limit = len(w.recent)
	}
	out := make([]Rejection, 0, limit)
	for i := len(w.recent) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, w.recent[i])
	}
	return out
}

// Close stops accepting rejections, writes the pending ones and closes the
// file. Calling it more than once is harmless.
func (w *RejectedWriter) Close() {
	w.closeOnce.Do(func() { close(w.ch) })
	<-w.done
}

// Counts returns how many rejections were recorded per code.
func (w *RejectedWriter) Counts() map[validation.Code]int64 {
	w.countsMu.Lock()
	defer w.countsMu.Unlock()
	out := make(map[validation.Code]int64, len(w.counts))
	for c, n := range w.counts {
		out[c] = n
	}
	return out
}
