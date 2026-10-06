package validation

import (
	"context"
	"sync"
	"time"
)

const (
	// DefaultDedupTTL is how long an eventId is remembered.
	DefaultDedupTTL = time.Hour
	// DefaultDedupCleanup is how often old entries are removed.
	DefaultDedupCleanup = 10 * time.Minute
)

// Dedup remembers accepted eventIds so the same event is never processed
// twice, for example when a file is read again after being truncated.
// Several goroutines (file tailers and HTTP handlers) call it at the same
// time, so the map is protected by a mutex.
type Dedup struct {
	mu   sync.Mutex
	seen map[string]time.Time
	ttl  time.Duration
	now  func() time.Time
}

// NewDedup creates a Dedup that forgets ids after ttl.
func NewDedup(ttl time.Duration) *Dedup {
	return &Dedup{seen: make(map[string]time.Time), ttl: ttl, now: time.Now}
}

// Check records eventID and returns DUPLICATE_EVENT if it was already
// recorded. Checking and recording happen under the same lock, so two
// copies arriving at once cannot both pass.
func (d *Dedup) Check(eventID string) *ValidationError {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, dup := d.seen[eventID]; dup {
		return reject(CodeDuplicateEvent, "eventId %s was already accepted", eventID)
	}
	d.seen[eventID] = d.now()
	return nil
}

// Cleanup removes ids older than the ttl and returns how many it removed.
func (d *Dedup) Cleanup() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	cutoff := d.now().Add(-d.ttl)
	removed := 0
	for id, at := range d.seen {
		if at.Before(cutoff) {
			delete(d.seen, id)
			removed++
		}
	}
	return removed
}

// Len returns how many ids are remembered.
func (d *Dedup) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.seen)
}

// Run calls Cleanup every interval until ctx is cancelled. It is meant to
// run in its own goroutine.
func (d *Dedup) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.Cleanup()
		}
	}
}
