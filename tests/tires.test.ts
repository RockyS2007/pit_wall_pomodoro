import { describe, expect, it } from 'vitest';
import {
  displayedTire,
  initialTireState,
  mapWeatherToCompound,
  nextTireState,
  OFFLINE_FALLBACK_MS,
  REASONS,
  type Compound,
  type Conditions,
  type TireState,
} from '../src/core/tires';

const opts = { coldThresholdC: 7 };
const T0 = 1_700_000_000_000;
const FIFTEEN = 15 * 60_000;

function cond(over: Partial<Conditions> = {}): Conditions {
  return {
    temperatureC: 20,
    apparentC: 20,
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    snowfallCm: 0,
    weatherCode: 0,
    cloudCover: 0,
    isDay: true,
    fetchedAt: T0,
    ...over,
  };
}

describe('mapWeatherToCompound: rule table', () => {
  const rows: Array<[string, Partial<Conditions>, Compound, string]> = [
    // Priority 1: rain
    ['light drizzle (51)', { weatherCode: 51 }, 'wet', REASONS.rain],
    ['dense drizzle (55)', { weatherCode: 55 }, 'wet', REASONS.rain],
    ['freezing drizzle (57)', { weatherCode: 57, apparentC: -2 }, 'wet', REASONS.rain],
    ['slight rain (61)', { weatherCode: 61 }, 'wet', REASONS.rain],
    ['heavy rain (65)', { weatherCode: 65 }, 'wet', REASONS.rain],
    ['freezing rain / sleet (66)', { weatherCode: 66, apparentC: -4 }, 'wet', REASONS.rain],
    ['freezing rain heavy (67)', { weatherCode: 67, apparentC: -4 }, 'wet', REASONS.rain],
    ['rain showers (80)', { weatherCode: 80 }, 'wet', REASONS.rain],
    ['violent showers (82)', { weatherCode: 82 }, 'wet', REASONS.rain],
    ['thunderstorm (95)', { weatherCode: 95 }, 'wet', REASONS.rain],
    ['thunderstorm with hail (99)', { weatherCode: 99 }, 'wet', REASONS.rain],
    ['measured rain without a rain code', { weatherCode: 3, rainMm: 0.3 }, 'wet', REASONS.rain],
    ['rain + showers together above 0.1 mm', { weatherCode: 2, rainMm: 0.06, showersMm: 0.06 }, 'wet', REASONS.rain],
    ['rain + cold: wet wins', { weatherCode: 63, apparentC: 1 }, 'wet', REASONS.rain],
    ['rain and snow mixed: wet wins', { weatherCode: 61, snowfallCm: 0.2 }, 'wet', REASONS.rain],
    // Priority 2: snow
    ['slight snow (71)', { weatherCode: 71, apparentC: -3 }, 'hard', REASONS.snow],
    ['heavy snow (75)', { weatherCode: 75, apparentC: -9 }, 'hard', REASONS.snow],
    ['snow grains (77)', { weatherCode: 77, apparentC: -1 }, 'hard', REASONS.snow],
    ['snow showers (85)', { weatherCode: 85, apparentC: 0 }, 'hard', REASONS.snow],
    ['snow showers heavy (86)', { weatherCode: 86, apparentC: 0 }, 'hard', REASONS.snow],
    ['measured snowfall without a snow code', { weatherCode: 3, snowfallCm: 0.1, apparentC: 9 }, 'hard', REASONS.snow],
    ['snow above the cold cutoff is still hard', { weatherCode: 71, apparentC: 9 }, 'hard', REASONS.snow],
    // Priority 3: cold
    ['sunny but freezing', { weatherCode: 0, apparentC: -5 }, 'hard', REASONS.cold],
    ['exactly at the cutoff (7 C)', { weatherCode: 0, apparentC: 7 }, 'hard', REASONS.cold],
    ['snow stopped, still freezing, overcast', { weatherCode: 3, cloudCover: 100, apparentC: -2 }, 'hard', REASONS.cold],
    ['cold fog', { weatherCode: 45, apparentC: 3 }, 'hard', REASONS.cold],
    ['mild air but cold wind chill', { weatherCode: 1, temperatureC: 10, apparentC: 6 }, 'hard', REASONS.cold],
    // Priority 4: cloudy
    ['partly cloudy (2)', { weatherCode: 2, cloudCover: 30 }, 'medium', REASONS.overcast],
    ['overcast (3)', { weatherCode: 3, cloudCover: 100 }, 'medium', REASONS.overcast],
    ['fog (45)', { weatherCode: 45 }, 'medium', REASONS.overcast],
    ['rime fog (48)', { weatherCode: 48 }, 'medium', REASONS.overcast],
    ['clear code but 50% cloud', { weatherCode: 1, cloudCover: 50 }, 'medium', REASONS.overcast],
    ['clear code but 80% cloud', { weatherCode: 0, cloudCover: 80 }, 'medium', REASONS.overcast],
    // Priority 5: clear
    ['clear sky (0)', { weatherCode: 0 }, 'soft', REASONS.clear],
    ['mainly clear (1)', { weatherCode: 1, cloudCover: 20 }, 'soft', REASONS.clear],
    ['just above the cold cutoff', { weatherCode: 0, apparentC: 7.1 }, 'soft', REASONS.clear],
    ['just under the cloud cutoff', { weatherCode: 1, cloudCover: 49 }, 'soft', REASONS.clear],
    ['clear night', { weatherCode: 0, isDay: false }, 'soft', REASONS.clear],
    ['hot and sunny', { weatherCode: 0, apparentC: 38 }, 'soft', REASONS.clear],
    // Priority 6: unmatched
    ['unknown code', { weatherCode: 42 }, 'medium', REASONS.mixed],
    ['trace rain at or below 0.1 mm with an odd code', { weatherCode: 4, rainMm: 0.1 }, 'medium', REASONS.mixed],
  ];

  it.each(rows)('%s', (_name, over, compound, reason) => {
    expect(mapWeatherToCompound(cond(over), null, opts)).toEqual({ compound, reason });
  });

  it('uses the configurable cold cutoff', () => {
    const c = cond({ apparentC: 10 });
    expect(mapWeatherToCompound(c, null, { coldThresholdC: 7 }).compound).toBe('soft');
    expect(mapWeatherToCompound(c, null, { coldThresholdC: 12 }).compound).toBe('hard');
  });
});

describe('mapWeatherToCompound: threshold bands', () => {
  it('cold: enters hard at <= 7, leaves only at >= 8', () => {
    expect(mapWeatherToCompound(cond({ apparentC: 7.5 }), 'soft', opts).compound).toBe('soft');
    expect(mapWeatherToCompound(cond({ apparentC: 7.5 }), 'hard', opts).compound).toBe('hard');
    expect(mapWeatherToCompound(cond({ apparentC: 7.9 }), 'hard', opts).compound).toBe('hard');
    expect(mapWeatherToCompound(cond({ apparentC: 8 }), 'hard', opts).compound).toBe('soft');
  });

  it('cloud: enters medium at >= 50, returns to soft only at <= 40', () => {
    expect(mapWeatherToCompound(cond({ weatherCode: 1, cloudCover: 45 }), 'soft', opts).compound).toBe('soft');
    expect(mapWeatherToCompound(cond({ weatherCode: 1, cloudCover: 45 }), 'medium', opts).compound).toBe('medium');
    expect(mapWeatherToCompound(cond({ weatherCode: 1, cloudCover: 41 }), 'medium', opts).compound).toBe('medium');
    expect(mapWeatherToCompound(cond({ weatherCode: 1, cloudCover: 40 }), 'medium', opts).compound).toBe('soft');
  });
});

describe('nextTireState: hysteresis', () => {
  const feed = (state: TireState, over: Partial<Conditions>, at: number) =>
    nextTireState(state, { kind: 'conditions', conditions: cond({ ...over, fetchedAt: at }) }, at, opts);

  it('fits the first reading straight away', () => {
    const s = feed(initialTireState(), { weatherCode: 0 }, T0);
    expect(s).toMatchObject({ compound: 'soft', reason: REASONS.clear, basis: 'weather', stale: false, lastGoodAt: T0 });
  });

  it('needs two fetches in a row before changing compound', () => {
    let s = feed(initialTireState(), { weatherCode: 0 }, T0);
    s = feed(s, { weatherCode: 3, cloudCover: 100 }, T0 + FIFTEEN);
    expect(s.compound).toBe('soft');
    expect(s.pending).toBe('medium');
    s = feed(s, { weatherCode: 3, cloudCover: 100 }, T0 + 2 * FIFTEEN);
    expect(s.compound).toBe('medium');
    expect(s.reason).toBe(REASONS.overcast);
    expect(s.pending).toBeNull();
  });

  it('a one-off blip does not change the tires', () => {
    let s = feed(initialTireState(), { weatherCode: 0 }, T0);
    s = feed(s, { weatherCode: 3, cloudCover: 100 }, T0 + FIFTEEN);
    s = feed(s, { weatherCode: 0 }, T0 + 2 * FIFTEEN);
    expect(s.compound).toBe('soft');
    expect(s.pending).toBeNull();
    // And the count starts again from scratch.
    s = feed(s, { weatherCode: 3, cloudCover: 100 }, T0 + 3 * FIFTEEN);
    expect(s.compound).toBe('soft');
  });

  it('two different candidates in a row do not count as confirmation', () => {
    let s = feed(initialTireState(), { weatherCode: 0 }, T0);
    s = feed(s, { weatherCode: 3, cloudCover: 100 }, T0 + FIFTEEN);
    s = feed(s, { weatherCode: 0, apparentC: 2 }, T0 + 2 * FIFTEEN);
    expect(s.compound).toBe('soft');
    expect(s.pending).toBe('hard');
  });

  it('switches to wet immediately', () => {
    let s = feed(initialTireState(), { weatherCode: 0 }, T0);
    s = feed(s, { weatherCode: 63, rainMm: 2 }, T0 + FIFTEEN);
    expect(s.compound).toBe('wet');
    expect(s.reason).toBe(REASONS.rain);
  });

  it('leaving wet still needs two fetches', () => {
    let s = feed(initialTireState(), { weatherCode: 63 }, T0);
    s = feed(s, { weatherCode: 3, cloudCover: 90 }, T0 + FIFTEEN);
    expect(s.compound).toBe('wet');
    s = feed(s, { weatherCode: 3, cloudCover: 90 }, T0 + 2 * FIFTEEN);
    expect(s.compound).toBe('medium');
  });

  it('hovering around the cold cutoff does not flicker', () => {
    let s = feed(initialTireState(), { apparentC: 6.8 }, T0);
    expect(s.compound).toBe('hard');
    for (const [i, temp] of [7.2, 7.6, 6.9, 7.8, 7.4].entries()) {
      s = feed(s, { apparentC: temp }, T0 + (i + 1) * FIFTEEN);
      expect(s.compound).toBe('hard');
      expect(s.pending).toBeNull();
    }
    s = feed(s, { apparentC: 8.2 }, T0 + 6 * FIFTEEN);
    s = feed(s, { apparentC: 8.4 }, T0 + 7 * FIFTEEN);
    expect(s.compound).toBe('soft');
  });

  it('hovering around the cloud cutoff does not flicker', () => {
    let s = feed(initialTireState(), { weatherCode: 1, cloudCover: 60 }, T0);
    expect(s.compound).toBe('medium');
    for (const [i, cloud] of [48, 52, 44, 41, 55].entries()) {
      s = feed(s, { weatherCode: 1, cloudCover: cloud }, T0 + (i + 1) * FIFTEEN);
      expect(s.compound).toBe('medium');
    }
    s = feed(s, { weatherCode: 1, cloudCover: 38 }, T0 + 6 * FIFTEEN);
    s = feed(s, { weatherCode: 1, cloudCover: 35 }, T0 + 7 * FIFTEEN);
    expect(s.compound).toBe('soft');
  });

  it('keeps the compound but updates the reason (snow stops, still freezing)', () => {
    let s = feed(initialTireState(), { weatherCode: 73, apparentC: -4 }, T0);
    expect(s.reason).toBe(REASONS.snow);
    s = feed(s, { weatherCode: 3, cloudCover: 100, apparentC: -4 }, T0 + FIFTEEN);
    expect(s.compound).toBe('hard');
    expect(s.reason).toBe(REASONS.cold);
  });

  it('after a long gap in data the new reading applies at once', () => {
    let s = feed(initialTireState(), { weatherCode: 0 }, T0);
    s = feed(s, { weatherCode: 3, cloudCover: 100 }, T0 + 10 * 60 * 60_000);
    expect(s.compound).toBe('medium');
  });
});

describe('nextTireState: offline and fallbacks', () => {
  const good = nextTireState(initialTireState(), { kind: 'conditions', conditions: cond() }, T0, opts);

  it('keeps the last compound and shows the badge when a fetch fails', () => {
    const s = nextTireState(good, { kind: 'error' }, T0 + FIFTEEN, opts);
    expect(s.compound).toBe('soft');
    expect(s.reason).toBe(REASONS.clear);
    expect(s.stale).toBe(true);
  });

  it('still keeps it just under 3 hours offline', () => {
    const s = nextTireState(good, { kind: 'error' }, T0 + OFFLINE_FALLBACK_MS, opts);
    expect(s.compound).toBe('soft');
    expect(s.stale).toBe(true);
  });

  it('falls back to medium after 3 hours offline', () => {
    const s = nextTireState(good, { kind: 'error' }, T0 + OFFLINE_FALLBACK_MS + 1, opts);
    expect(s).toMatchObject({ compound: 'medium', reason: REASONS.noTelemetry, stale: true, basis: 'fallback' });
  });

  it('is medium with the badge when there has never been any data', () => {
    const s = nextTireState(initialTireState(), { kind: 'error' }, T0, opts);
    expect(s).toMatchObject({ compound: 'medium', reason: REASONS.noTelemetry, stale: true });
  });

  it('recovers at once when data returns', () => {
    let s = nextTireState(good, { kind: 'error' }, T0 + OFFLINE_FALLBACK_MS + 1, opts);
    s = nextTireState(s, { kind: 'conditions', conditions: cond({ weatherCode: 0 }) }, T0 + OFFLINE_FALLBACK_MS + FIFTEEN, opts);
    expect(s).toMatchObject({ compound: 'soft', stale: false, basis: 'weather' });
  });

  it('a short outage clears the badge on the next good fetch', () => {
    let s = nextTireState(good, { kind: 'error' }, T0 + FIFTEEN, opts);
    s = nextTireState(s, { kind: 'conditions', conditions: cond() }, T0 + FIFTEEN + 2 * 60_000, opts);
    expect(s.stale).toBe(false);
    expect(s.compound).toBe('soft');
  });

  it('no location: medium with a prompt to set one', () => {
    const s = nextTireState(good, { kind: 'noLocation' }, T0, opts);
    expect(s).toMatchObject({ compound: 'medium', reason: REASONS.noLocation, stale: false });
  });
});

describe('displayedTire: manual override', () => {
  it("shows the pinned compound with a lock and Driver's choice", () => {
    const s = nextTireState(initialTireState(), { kind: 'conditions', conditions: cond({ weatherCode: 63 }) }, T0, opts);
    expect(displayedTire(s, null)).toEqual({ compound: 'wet', reason: REASONS.rain, locked: false, stale: false });
    expect(displayedTire(s, 'soft')).toEqual({ compound: 'soft', reason: REASONS.override, locked: true, stale: false });
  });
});
