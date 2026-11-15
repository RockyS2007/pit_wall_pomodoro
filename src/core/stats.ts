/**
 * Study statistics. Pure functions over a small JSON-friendly record keyed by
 * local calendar day ("YYYY-MM-DD").
 */

export interface DayStats {
  stints: number;
  focusMs: number;
  grandPrix: number;
}

export interface StatsData {
  days: Record<string, DayStats>;
  /** Longest unbroken stretch of focus (no pause), in ms. */
  fastestLapMs: number;
}

export function emptyStats(): StatsData {
  return { days: {}, fastestLapMs: 0 };
}

/** Local calendar day for a timestamp, as YYYY-MM-DD. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  // Noon avoids daylight-saving edge cases when stepping by whole days.
  const date = new Date(y, m - 1, d + delta, 12);
  return dayKey(date.getTime());
}

function withDay(data: StatsData, key: string, change: (d: DayStats) => DayStats): StatsData {
  const day = data.days[key] ?? { stints: 0, focusMs: 0, grandPrix: 0 };
  return { ...data, days: { ...data.days, [key]: change(day) } };
}

/** Record an unbroken stretch of focus that ended at `endedAt`. */
export function recordFocus(data: StatsData, ms: number, endedAt: number): StatsData {
  if (ms <= 0) return data;
  const next = withDay(data, dayKey(endedAt), (d) => ({ ...d, focusMs: d.focusMs + ms }));
  return { ...next, fastestLapMs: Math.max(next.fastestLapMs, ms) };
}

export function recordStint(data: StatsData, endedAt: number): StatsData {
  return withDay(data, dayKey(endedAt), (d) => ({ ...d, stints: d.stints + 1 }));
}

export function recordGrandPrix(data: StatsData, endedAt: number): StatsData {
  return withDay(data, dayKey(endedAt), (d) => ({ ...d, grandPrix: d.grandPrix + 1 }));
}

export function today(data: StatsData, now: number): DayStats {
  return data.days[dayKey(now)] ?? { stints: 0, focusMs: 0, grandPrix: 0 };
}

export function totalFocusMs(data: StatsData): number {
  return Object.values(data.days).reduce((sum, d) => sum + d.focusMs, 0);
}

/**
 * Days in a row with at least one Grand Prix. Today counts if it already has
 * one; if not, the streak running up to yesterday is still alive.
 */
export function streak(data: StatsData, now: number): number {
  let key = dayKey(now);
  if (!(data.days[key]?.grandPrix > 0)) key = shiftDay(key, -1);
  let count = 0;
  while (data.days[key]?.grandPrix > 0) {
    count += 1;
    key = shiftDay(key, -1);
  }
  return count;
}

export interface WeekBar {
  key: string;
  /** Short weekday label, e.g. "Mon". */
  label: string;
  focusMs: number;
  stints: number;
  isToday: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The last 7 days, oldest first, ending today. */
export function weekly(data: StatsData, now: number): WeekBar[] {
  const todayKey = dayKey(now);
  const bars: WeekBar[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = shiftDay(todayKey, -i);
    const [y, m, d] = key.split('-').map(Number);
    const day = data.days[key];
    bars.push({
      key,
      label: WEEKDAYS[new Date(y, m - 1, d, 12).getDay()],
      focusMs: day?.focusMs ?? 0,
      stints: day?.stints ?? 0,
      isToday: key === todayKey,
    });
  }
  return bars;
}

/** Drop days older than about a year so the file never grows without bound. */
export function prune(data: StatsData, now: number, keepDays = 400): StatsData {
  const cutoff = shiftDay(dayKey(now), -keepDays);
  const days: Record<string, DayStats> = {};
  for (const [key, value] of Object.entries(data.days)) {
    if (key >= cutoff) days[key] = value;
  }
  return { ...data, days };
}
