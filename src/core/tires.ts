/**
 * Weather -> tire compound mapping.
 *
 * `mapWeatherToCompound` is the pure rule table (first match wins).
 * `nextTireState` wraps it with the no-flicker rules, offline handling and
 * fallbacks. Both are pure and fully unit-tested.
 */

export type Compound = 'soft' | 'medium' | 'hard' | 'wet';

/** Current conditions, always metric (the UI converts for display). */
export interface Conditions {
  temperatureC: number;
  apparentC: number;
  precipitationMm: number;
  rainMm: number;
  showersMm: number;
  snowfallCm: number;
  /** WMO weather interpretation code. */
  weatherCode: number;
  /** 0..100 */
  cloudCover: number;
  isDay: boolean;
  fetchedAt: number;
}

export interface MapOptions {
  /** "Feels like" temperature at or below which the track counts as cold. */
  coldThresholdC: number;
}

export interface CompoundResult {
  compound: Compound;
  reason: string;
}

export const COMPOUND_INFO: Record<Compound, { label: string; color: string; letter: string }> = {
  soft: { label: 'Soft', color: '#ff3b30', letter: 'S' },
  medium: { label: 'Medium', color: '#ffd60a', letter: 'M' },
  hard: { label: 'Hard', color: '#f5f5f7', letter: 'H' },
  wet: { label: 'Wet', color: '#2f80ff', letter: 'W' },
};

export const REASONS = {
  rain: 'Rain on track',
  snow: 'Snow on track',
  cold: 'Cold track temps',
  overcast: 'Overcast',
  clear: 'Clear skies',
  mixed: 'Mixed conditions',
  noTelemetry: 'No telemetry',
  noLocation: 'Set your location',
  override: "Driver's choice",
} as const;

const COLD_BAND_C = 1; // enter Hard at <= threshold, leave at >= threshold + 1
const CLOUD_ENTER = 50; // enter Medium at >= 50% cloud
const CLOUD_LEAVE = 40; // return to Soft at <= 40% cloud
const RAIN_MM = 0.1;
export const OFFLINE_FALLBACK_MS = 3 * 60 * 60 * 1000;
/** Readings further apart than this are not treated as consecutive. */
export const DATA_GAP_MS = 35 * 60 * 1000;

const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

export function isRainCode(code: number): boolean {
  return inRange(code, 51, 57) || inRange(code, 61, 67) || inRange(code, 80, 82) || inRange(code, 95, 99);
}

export function isSnowCode(code: number): boolean {
  return inRange(code, 71, 77) || inRange(code, 85, 86);
}

export function isCloudyCode(code: number): boolean {
  return code === 2 || code === 3 || code === 45 || code === 48;
}

/**
 * The rule table from the plan, in priority order. `previous` is the compound
 * currently fitted for weather reasons; it only matters near a threshold,
 * where it keeps the result from flickering (1 degree cold band, 50/40 cloud band).
 */
export function mapWeatherToCompound(
  c: Conditions,
  previous: Compound | null,
  opts: MapOptions,
): CompoundResult {
  // 1. Rain of any kind, including freezing rain and thunderstorms.
  if (isRainCode(c.weatherCode) || c.rainMm + c.showersMm > RAIN_MM) {
    return { compound: 'wet', reason: REASONS.rain };
  }
  // 2. Snow.
  if (isSnowCode(c.weatherCode) || c.snowfallCm > 0) {
    return { compound: 'hard', reason: REASONS.snow };
  }
  // 3. Cold.
  const coldLimit = previous === 'hard' ? opts.coldThresholdC + COLD_BAND_C : opts.coldThresholdC;
  const cold = previous === 'hard' ? c.apparentC < coldLimit : c.apparentC <= coldLimit;
  if (cold) return { compound: 'hard', reason: REASONS.cold };
  // 4. Cloudy.
  const cloudLimit = previous === 'medium' ? CLOUD_LEAVE : CLOUD_ENTER;
  const cloudy = previous === 'medium' ? c.cloudCover > cloudLimit : c.cloudCover >= cloudLimit;
  if (isCloudyCode(c.weatherCode) || cloudy) return { compound: 'medium', reason: REASONS.overcast };
  // 5. Clear.
  if (c.weatherCode === 0 || c.weatherCode === 1) return { compound: 'soft', reason: REASONS.clear };
  // 6. Anything else.
  return { compound: 'medium', reason: REASONS.mixed };
}

export interface TireState {
  compound: Compound;
  reason: string;
  /** 'weather' when the compound came from real conditions, 'fallback' otherwise. */
  basis: 'weather' | 'fallback';
  /** A different result seen once, waiting for a second fetch to confirm it. */
  pending: Compound | null;
  /** When weather data last arrived successfully. */
  lastGoodAt: number | null;
  /** True when the latest fetch failed ("no telemetry" badge). */
  stale: boolean;
}

export type TireInput =
  | { kind: 'conditions'; conditions: Conditions }
  | { kind: 'error' }
  | { kind: 'noLocation' };

export function initialTireState(): TireState {
  return {
    compound: 'medium',
    reason: REASONS.noLocation,
    basis: 'fallback',
    pending: null,
    lastGoodAt: null,
    stale: false,
  };
}

/**
 * Fold one weather update into the tire state.
 *
 * - A change must hold for 2 consecutive fetches, except a change to Wet,
 *   which applies at once.
 * - On a failed fetch the last compound is kept for up to 3 hours, then Medium.
 * - With no location: Medium.
 */
export function nextTireState(
  prev: TireState,
  input: TireInput,
  now: number,
  opts: MapOptions,
): TireState {
  if (input.kind === 'noLocation') return initialTireState();

  if (input.kind === 'error') {
    const expired = prev.lastGoodAt === null || now - prev.lastGoodAt > OFFLINE_FALLBACK_MS;
    if (expired || prev.basis === 'fallback') {
      return {
        ...prev,
        compound: 'medium',
        reason: REASONS.noTelemetry,
        basis: 'fallback',
        pending: null,
        stale: true,
      };
    }
    return { ...prev, stale: true };
  }

  const fromWeather = prev.basis === 'weather';
  const result = mapWeatherToCompound(input.conditions, fromWeather ? prev.compound : null, opts);
  const base = { basis: 'weather' as const, lastGoodAt: now, stale: false };

  // First real data (or first data after a fallback): fit it straight away.
  if (!fromWeather) return { ...result, ...base, pending: null };
  // Same after a long gap (app was closed, computer asleep, offline): the
  // "two fetches in a row" rule only makes sense for back-to-back readings.
  if (prev.lastGoodAt === null || now - prev.lastGoodAt > DATA_GAP_MS) {
    return { ...result, ...base, pending: null };
  }

  if (result.compound === prev.compound) {
    // Same compound; the reason may still change (for example snow -> cold).
    return { ...result, ...base, pending: null };
  }
  if (result.compound === 'wet' || prev.pending === result.compound) {
    return { ...result, ...base, pending: null };
  }
  // Seen once: remember it and wait for the next fetch to agree.
  return { ...prev, ...base, pending: result.compound };
}

export interface DisplayedTire extends CompoundResult {
  /** True when the driver pinned the compound in settings. */
  locked: boolean;
  stale: boolean;
}

/** What the car should actually show, after the manual override. */
export function displayedTire(state: TireState, override: Compound | null): DisplayedTire {
  if (override) {
    return { compound: override, reason: REASONS.override, locked: true, stale: state.stale };
  }
  return { compound: state.compound, reason: state.reason, locked: false, stale: state.stale };
}
