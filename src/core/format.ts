import type { Units } from './settings';
import type { Phase } from './timer';

/** "24:59" style countdown. Rounds up so the display never shows 00:00 early. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "1h 20m", "45m", "30s". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function toDisplayTemp(celsius: number, units: Units): number {
  return units === 'F' ? (celsius * 9) / 5 + 32 : celsius;
}

export function fromDisplayTemp(value: number, units: Units): number {
  return units === 'F' ? ((value - 32) * 5) / 9 : value;
}

export function formatTemp(celsius: number, units: Units): string {
  return `${Math.round(toDisplayTemp(celsius, units))} °${units}`;
}

export const PHASE_LABEL: Record<Phase, string> = {
  idle: 'On the grid',
  stint: 'Stint',
  pitStop: 'Pit stop',
  // The long break after the last stint. Called "redFlag" in the code for
  // historical reasons; on screen it is the podium.
  redFlag: 'Podium',
};
