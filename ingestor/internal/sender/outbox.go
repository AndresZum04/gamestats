package sender

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/AndresZum/gamestats/ingestor/internal/model"
)

// Outbox keeps batches that could not be delivered, one JSON file per
// match, so they survive a restart and are retried later.
type Outbox struct {
	dir string
	mu  sync.Mutex // serializes writes and removals in dir
}

// NewOutbox creates dir if needed.
func NewOutbox(dir string) (*Outbox, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Outbox{dir: dir}, nil
}

// Save writes the batch to {matchId}.json, replacing an older one. It
// writes a temp file and renames it, so a reader never sees half a file.
// matchId is safe as a file name because the validator restricts it.
func (o *Outbox) Save(b model.MatchBatch) error {
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	path := filepath.Join(o.dir, b.MatchID+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// entry is one batch file found in the outbox.
type entry struct {
	path string
	info os.FileInfo
}

// entries lists the pending batch files, oldest first.
func (o *Outbox) entries() ([]entry, error) {
	files, err := os.ReadDir(o.dir)
	if err != nil {
		return nil, err
	}
	var out []entry
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		info, err := f.Info()
		if err != nil {
			continue // removed meanwhile
		}
		out = append(out, entry{path: filepath.Join(o.dir, f.Name()), info: info})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].info.ModTime().Before(out[j].info.ModTime()) })
	return out, nil
}

// Size returns how many batches are waiting.
func (o *Outbox) Size() int {
	e, _ := o.entries()
	return len(e)
}

func (o *Outbox) load(e entry) (model.MatchBatch, error) {
	var b model.MatchBatch
	raw, err := os.ReadFile(e.path)
	if err == nil {
		err = json.Unmarshal(raw, &b)
	}
	return b, err
}

// removeIfUnchanged deletes the file only if nobody rewrote it since it
// was listed: a newer batch saved meanwhile must not be lost.
func (o *Outbox) removeIfUnchanged(e entry) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	now, err := os.Stat(e.path)
	if err != nil {
		return nil // already gone
	}
	if !now.ModTime().Equal(e.info.ModTime()) || now.Size() != e.info.Size() {
		return nil
	}
	return os.Remove(e.path)
}

// quarantine renames a file that can never be delivered (corrupt, or
// refused with a 4xx), so it is kept for inspection but not retried.
func (o *Outbox) quarantine(e entry, reason string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	dst := e.path + ".failed"
	if err := os.Rename(e.path, dst); err != nil {
		return fmt.Errorf("quarantine %s (%s): %w", e.path, reason, err)
	}
	return nil
}
