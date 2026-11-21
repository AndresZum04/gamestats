/**
 * A UUID v4 (the eventId format of GameStats) from crypto.getRandomValues.
 *
 * crypto.randomUUID only exists in a secure context (HTTPS or localhost), so
 * on the Azure VM, served over plain HTTP with an IP, it is undefined and the
 * console would not start. getRandomValues works in any context.
 */
export function uuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // version 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
