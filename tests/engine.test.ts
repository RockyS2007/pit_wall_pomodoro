import { describe, expect, it } from 'vitest';
import { Engine, type Host, type Snapshot } from '../src/engine/engine';
import { dayKey } from '../src/core/stats';
import { REASONS } from '../src/core/tires';

const MIN = 60_000;
const T0 = new Date(2026, 2, 9, 9, 0).getTime();
const toronto = { name: 'Toronto', lat: 43.7, lon: -79.4, approximate: false };

function weather(over: Record<string, number> = {}) {
  return {
    current: {
      temperature_2m: 20, apparent_temperature: 20, precipitation: 0, rain: 0, showers: 0,
      snowfall: 0, weather_code: 0, cloud_cover: 5, is_day: 1, ...over,
    },
  };
}

function makeHost(disk: Map<string, unknown> = new Map()) {
  const state = {
    now: T0,
    online: true,
    response: weather() as unknown,
    requests: [] as string[],
    notifications: [] as string[],
    sounds: [] as string[],
    autostart: [] as boolean[],
    hotkeys: [] as Array<string | null>,
    disk,
  };
  const host: Host = {
    now: () => state.now,
    fetch: async (url) => {
      state.requests.push(url);
      if (!state.online) throw new Error('offline');
      return { ok: true, status: 200, json: async () => state.response };
    },
    load: async (key) => (disk.has(key) ? JSON.parse(JSON.stringify(disk.get(key))) : null),
    save: async (key, value) => {
      disk.set(key, JSON.parse(JSON.stringify(value)));
    },
    notify: (title) => state.notifications.push(title),
    playSound: (name) => state.sounds.push(name),
    setAutostart: async (on) => {
      state.autostart.push(on);
    },
    setHotkey: async (acc) => {
      state.hotkeys.push(acc);
    },
    log: () => {},
  };
  return { host, state };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function boot(disk?: Map<string, unknown>) {
  const h = makeHost(disk);
  const engine = new Engine(h.host);
  const snaps: Snapshot[] = [];
  engine.subscribe((s) => snaps.push(s));
  await engine.init();
  await flush();
  return { engine, snaps, ...h };
}

/** Advance the fake clock in one-second ticks. */
async function run(engine: Engine, state: { now: number; requests: string[] }, ms: number, stepMs = 1000) {
  const end = state.now + ms;
  while (state.now < end) {
    state.now = Math.min(end, state.now + stepMs);
    const before = state.requests.length;
    engine.tick();
    // Let a network request that just started finish before time moves on.
    if (state.requests.length !== before) await flush();
  }
  await flush();
}

describe('engine', () => {
  it('runs a stint, announces the pit stop and records stats', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'start' });
    expect(state.notifications).toEqual([]); // no notification for a start you pressed yourself
    expect(state.sounds).toEqual(['lightsOut']);
    await run(engine, state, 25 * MIN);
    const snap = engine.snapshot();
    expect(snap.timer.phase).toBe('pitStop');
    expect(state.notifications).toEqual(['Box box! Pit stop for 5 minutes']);
    expect(state.sounds).toEqual(['lightsOut', 'pitRadio']);
    expect(snap.stats.days[dayKey(T0)]).toEqual({ stints: 1, focusMs: 25 * MIN, grandPrix: 0 });
    await run(engine, state, 5 * MIN);
    expect(engine.snapshot().timer.phase).toBe('stint');
    expect(state.notifications[1]).toBe('Lights out, stint 2 begins');
  });

  it('notifies at every phase change through a full Grand Prix', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'start' });
    await run(engine, state, (4 * 25 + 3 * 5 + 20) * MIN + 1000);
    expect(state.notifications).toEqual([
      'Box box! Pit stop for 5 minutes',
      'Lights out, stint 2 begins',
      'Box box! Pit stop for 5 minutes',
      'Lights out, stint 3 begins',
      'Box box! Pit stop for 5 minutes',
      'Lights out, stint 4 begins',
      'Chequered flag! Grand Prix complete',
      'Lights out, stint 1 begins',
    ]);
    const day = engine.snapshot().stats.days[dayKey(T0)];
    expect(day.stints).toBe(4);
    expect(day.grandPrix).toBe(1);
    expect(day.focusMs).toBe(100 * MIN);
  });

  it('a 2-stint Grand Prix ends with the podium break after stint 2', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { stintMin: 50, pitStopMin: 10, stintsPerGP: 2 } });
    engine.dispatch({ type: 'start' });
    await run(engine, state, (50 + 10 + 50) * MIN + 1000);
    expect(state.notifications).toEqual([
      'Box box! Pit stop for 10 minutes',
      'Lights out, stint 2 begins',
      'Chequered flag! Grand Prix complete',
    ]);
    expect(engine.snapshot().stats.days[dayKey(T0)].grandPrix).toBe(1);
  });

  it('mute and notification switches are respected', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { soundOn: false, notifications: false } });
    engine.dispatch({ type: 'start' });
    await run(engine, state, 25 * MIN);
    expect(state.sounds).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  it('with no location: medium tires and no network requests', async () => {
    const { engine, state } = await boot();
    await run(engine, state, 60 * MIN, 10_000);
    expect(state.requests).toEqual([]);
    expect(engine.snapshot().tire).toMatchObject({ compound: 'medium', reason: REASONS.noLocation });
  });

  it('choosing a city fetches its weather at once and then at most every 15 minutes', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    expect(state.requests).toHaveLength(1);
    expect(engine.snapshot().conditions?.temperatureC).toBe(20);
    expect(engine.snapshot().tire).toMatchObject({ compound: 'soft', reason: REASONS.clear });
    await run(engine, state, 60 * MIN);
    expect(state.requests).toHaveLength(5); // t=0, 15, 30, 45, 60
  });

  it('plays the tire swap when the compound changes, after two matching fetches', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    const before = engine.snapshot().swapSeq;
    state.response = weather({ weather_code: 3, cloud_cover: 100 });
    await run(engine, state, 15 * MIN);
    expect(engine.snapshot().tire.compound).toBe('soft');
    await run(engine, state, 15 * MIN);
    expect(engine.snapshot().tire.compound).toBe('medium');
    expect(engine.snapshot().swapSeq).toBe(before + 1);
    expect(state.sounds).toContain('wheelGun');
    // Rain shows immediately.
    state.response = weather({ weather_code: 63, rain: 2 });
    await run(engine, state, 15 * MIN);
    expect(engine.snapshot().tire.compound).toBe('wet');
  });

  it('a tire change never interrupts a running stint', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    engine.dispatch({ type: 'start' });
    const endsAt = engine.snapshot().timer.endsAt;
    state.response = weather({ weather_code: 63, rain: 2 });
    await run(engine, state, 16 * MIN);
    const snap = engine.snapshot();
    expect(snap.tire.compound).toBe('wet');
    expect(snap.timer.phase).toBe('stint');
    expect(snap.timer.running).toBe(true);
    expect(snap.timer.endsAt).toBe(endsAt);
  });

  it('going offline keeps the last data with the badge, then medium after 3 hours', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    state.online = false;
    await run(engine, state, 16 * MIN);
    let snap = engine.snapshot();
    expect(snap.tire).toMatchObject({ compound: 'soft', stale: true });
    expect(snap.conditions?.temperatureC).toBe(20);
    expect(snap.weatherError).toBe('offline');
    await run(engine, state, 3 * 60 * MIN, 5000);
    snap = engine.snapshot();
    expect(snap.tire).toMatchObject({ compound: 'medium', reason: REASONS.noTelemetry, stale: true });
    state.online = true;
    await run(engine, state, 3 * MIN);
    expect(engine.snapshot().tire).toMatchObject({ compound: 'soft', stale: false });
  });

  it('refreshes on wake from sleep when the data is old', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    engine.tick();
    state.now += 2 * 60 * MIN; // lid closed for two hours
    engine.tick();
    await flush();
    expect(state.requests).toHaveLength(2);
  });

  it('manual override pins the compound and clears again', async () => {
    const { engine } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    engine.dispatch({ type: 'updateSettings', patch: { compoundOverride: 'wet' } });
    expect(engine.snapshot().tire).toEqual({ compound: 'wet', reason: REASONS.override, locked: true, stale: false });
    engine.dispatch({ type: 'updateSettings', patch: { compoundOverride: null } });
    expect(engine.snapshot().tire).toMatchObject({ compound: 'soft', locked: false });
  });

  it('changing the cold cutoff re-fits the tires straight away', async () => {
    const { engine, state } = await boot();
    state.response = weather({ apparent_temperature: 10, temperature_2m: 11 });
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    expect(engine.snapshot().tire.compound).toBe('soft');
    engine.dispatch({ type: 'updateSettings', patch: { coldThresholdC: 12 } });
    expect(engine.snapshot().tire).toMatchObject({ compound: 'hard', reason: REASONS.cold });
  });

  it('debug menu can force every compound without touching the network', async () => {
    const { engine, state } = await boot();
    engine.dispatch({ type: 'updateSettings', patch: { location: toronto } });
    await flush();
    const requests = state.requests.length;
    const seen: Record<string, string> = {};
    for (const preset of ['rain', 'snow', 'cold', 'cloudy', 'fog', 'clear', 'offline'] as const) {
      engine.dispatch({ type: 'debugWeather', preset });
      seen[preset] = engine.snapshot().tire.compound;
    }
    expect(seen).toEqual({ rain: 'wet', snow: 'hard', cold: 'hard', cloudy: 'medium', fog: 'medium', clear: 'soft', offline: 'medium' });
    expect(engine.snapshot().tire.stale).toBe(true);
    engine.dispatch({ type: 'debugWeather', preset: null });
    await flush();
    expect(engine.snapshot().tire).toMatchObject({ compound: 'soft', stale: false });
    expect(state.requests.length).toBe(requests);
  });

  it('every setting, the timer and the stats survive a restart', async () => {
    const disk = new Map<string, unknown>();
    const first = await boot(disk);
    const patch = {
      stintMin: 50, pitStopMin: 10, redFlagMin: 30, stintsPerGP: 6, units: 'F' as const, coldThresholdC: 4, soundOn: false,
      volume: 0.2, notifications: false, compoundOverride: 'hard' as const, petSize: 'L' as const, autostart: true,
      livery: 'ultraviolet' as const, carNumber: 81, hotkeyEnabled: true, hotkey: 'Alt+Shift+S', nightDim: false,
      objective: 'Organic chemistry', onboarded: true, autoStartNext: false, location: toronto,
    };
    first.engine.dispatch({ type: 'updateSettings', patch });
    await flush();
    expect(first.state.autostart).toEqual([true]);
    expect(first.state.hotkeys.at(-1)).toBe('Alt+Shift+S');
    first.engine.dispatch({ type: 'start' });
    await run(first.engine, first.state, 20 * MIN);
    first.engine.dispatch({ type: 'pause' });
    await flush();

    const second = await boot(disk);
    const snap = second.engine.snapshot();
    expect(snap.settings).toEqual({ ...first.engine.snapshot().settings });
    expect(snap.settings).toMatchObject(patch);
    expect(snap.timer.phase).toBe('stint');
    expect(snap.timer.running).toBe(false);
    expect(snap.timer.remainingMs).toBe(30 * MIN);
    expect(snap.stats.days[dayKey(T0)].focusMs).toBe(20 * MIN);
    expect(second.state.hotkeys).toEqual(['Alt+Shift+S']);
  });

  it('a stint left running while the app was closed finishes once on relaunch', async () => {
    const disk = new Map<string, unknown>();
    const first = await boot(disk);
    first.engine.dispatch({ type: 'start' });
    await flush();
    const second = makeHost(disk);
    second.state.now = T0 + 3 * 60 * MIN;
    const engine = new Engine(second.host);
    await engine.init();
    engine.tick();
    await flush();
    expect(engine.snapshot().timer.phase).toBe('pitStop');
    expect(engine.snapshot().timer.endsAt).toBe(second.state.now + 5 * MIN);
    expect(engine.snapshot().stats.days[dayKey(T0)].stints).toBe(1);
  });

  it('stats land on the right day across midnight', async () => {
    const { engine, state } = await boot();
    state.now = new Date(2026, 2, 9, 23, 50).getTime();
    engine.dispatch({ type: 'start' });
    await run(engine, state, 25 * MIN);
    const days = engine.snapshot().stats.days;
    expect(days['2026-03-10']).toEqual({ stints: 1, focusMs: 25 * MIN, grandPrix: 0 });
    expect(days['2026-03-09']).toBeUndefined();
  });

  it('ignores commands and ticks before it has loaded', () => {
    const { host } = makeHost();
    const engine = new Engine(host);
    engine.dispatch({ type: 'start' });
    engine.tick();
    expect(engine.snapshot().timer.phase).toBe('idle');
  });
});
