package ingest

import (
	"context"
	"sync/atomic"

	"github.com/AndresZum/gamestats/ingestor/internal/model"
	"github.com/AndresZum/gamestats/ingestor/internal/validation"
)

// Intake is the single entry point shared by the file tailers and the HTTP
// handler: validate, drop duplicates, then queue the event for the pipeline
// or record the rejection.
type Intake struct {
	validator *validation.Validator
	dedup     *validation.Dedup
	rejected  *RejectedWriter
	out       chan<- model.Event

	received atomic.Int64 // every raw event submitted
	accepted atomic.Int64 // valid, not duplicated and queued
}

// NewIntake wires the validation steps to the pipeline input channel.
func NewIntake(v *validation.Validator, d *validation.Dedup, r *RejectedWriter, out chan<- model.Event) *Intake {
	return &Intake{validator: v, dedup: d, rejected: r, out: out}
}

// Submit processes one raw event. It returns nil if the event was queued,
// a *validation.ValidationError if it was rejected, or ctx.Err() if ctx
// ended while waiting for room in the channel. In the last case the event
// was not consumed and can be submitted again.
//
// When the channel is full Submit waits: that wait is the backpressure that
// slows the tailers down instead of losing events.
func (in *Intake) Submit(ctx context.Context, raw []byte) error {
	in.received.Add(1)
	ev, verr := in.validator.Validate(raw)
	if verr == nil {
		verr = in.dedup.Check(ev.EventID)
	}
	if verr != nil {
		in.rejected.Record(raw, verr)
		return verr
	}
	select {
	case in.out <- ev:
		in.accepted.Add(1)
		return nil
	case <-ctx.Done():
		in.received.Add(-1) // not consumed: it will be submitted again
		in.dedup.Forget(ev.EventID)
		return ctx.Err()
	}
}

// HasRoom reports whether n more events fit in the input channel right now.
// The HTTP handler uses it to answer 503 instead of making a client wait.
func (in *Intake) HasRoom(n int) bool {
	return cap(in.out)-len(in.out) >= n
}

// Received returns how many events were submitted.
func (in *Intake) Received() int64 { return in.received.Load() }

// Accepted returns how many events passed validation and were queued.
func (in *Intake) Accepted() int64 { return in.accepted.Load() }
