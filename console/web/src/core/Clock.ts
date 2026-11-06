/** Source of the current time in milliseconds. Tests inject a fixed clock. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
