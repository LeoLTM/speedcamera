// Shared formatting helpers for lap timer / speed camera displays.

/** Format a millisecond duration as `MM:SS.mmm`. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms);
  const totalSeconds = Math.floor(total / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** Format a `Date.now()` ms timestamp as a localized `HH:MM:SS` string. */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format an ISO 8601 string as a localized date + time string. */
export function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
