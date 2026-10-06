package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// OffsetStore remembers how many bytes of each events file were already
// processed, so a restart continues where it left off. Keys are paths
// relative to the events folder, with forward slashes.
type OffsetStore struct {
	path string

	mu      sync.Mutex
	offsets map[string]int64
	dirty   bool
}

// LoadOffsets reads path if it exists. A missing file means a first run.
// A corrupt file is logged and ignored: rereading is safe because the
// tailers start from 0 and duplicates are rejected.
func LoadOffsets(path string) *OffsetStore {
	s := &OffsetStore{path: path, offsets: make(map[string]int64)}
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s
	}
	if err == nil {
		err = json.Unmarshal(raw, &s.offsets)
	}
	if err != nil {
		slog.Warn("ignoring unreadable offsets file", "path", path, "err", err)
		s.offsets = make(map[string]int64)
	}
	return s
}

// Get returns the saved offset of key.
func (s *OffsetStore) Get(key string) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	off, ok := s.offsets[key]
	return off, ok
}

// Set updates the offset of key; it is written on the next Save.
func (s *OffsetStore) Set(key string, offset int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.offsets[key]; ok && old == offset {
		return
	}
	s.offsets[key] = offset
	s.dirty = true
}

// Save writes the offsets if they changed. It writes a temp file and
// renames it, so a crash in the middle never leaves a half written file.
func (s *OffsetStore) Save() error {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return nil
	}
	raw, err := json.MarshalIndent(s.offsets, "", "  ")
	s.dirty = false
	s.mu.Unlock()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		s.mu.Lock()
		s.dirty = true
		s.mu.Unlock()
		return fmt.Errorf("save offsets: %w", err)
	}
	return nil
}

// Run saves every interval until ctx ends. The final save is done by the
// caller after the tailers stop, so their last offsets are included.
func (s *OffsetStore) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Save(); err != nil {
				slog.Error("save offsets", "err", err)
			}
		}
	}
}
