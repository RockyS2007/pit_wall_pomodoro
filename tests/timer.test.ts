import { describe, expect, it } from 'vitest';
import * as t from '../src/core/timer';
import type { TimerConfig, TimerEvent, TimerState } from '../src/core/timer';

const MIN = 60_000;
const config: TimerConfig = {
  stintMs: 25 * MIN,
  pitStopMs: 5 * MIN,
  redFlagMs: 20 * MIN,
  stintsPerGrandPrix: 4,
  autoStartNext: true,
};
const T0 = 1_700_000_000_000;

/** Run the clock forward until the current phase ends, collecting events. */
function finishPhase(state: TimerState, cfg = config): { state: TimerState; events: TimerEvent[]; now: number } {
  const now = state.endsAt!;
  const r = t.tick(state, cfg, now);
  return { ...r, now };
}

describe('timer transitions', () => {
  it('starts idle with the stint length showing', () => {
    const s = t.createTimer(config);
    expect(s.phase).toBe('idle');
    expect(t.remaining(s, T0)).toBe(25 * MIN);
    expect(t.isPaused(s)).toBe(false);
  });

  it('idle -> stint on start', () => {
    const r = t.start(t.createTimer(config), config, T0);
    expect(r.state.phase).toBe('stint');
    expect(r.state.running).toBe(true);
    expect(r.state.endsAt).toBe(T0 + 25 * MIN);
    expect(r.state.lap).toBe(1);
    expect(r.events).toEqual([{ type: 'phaseChanged', from: 'idle', to: 'stint', cause: 'start', lap: 1 }]);
  });

  it('does nothing before the end time', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const r = t.tick(s, config, T0 + 25 * MIN - 1);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it('stint -> pit stop -> stint, with a completed stint and focus time', () => {
    const s1 = t.start(t.createTimer(config), config, T0).state;
    const a = finishPhase(s1);
    expect(a.state.phase).toBe('pitStop');
    expect(a.state.endsAt).toBe(a.now + 5 * MIN);
    expect(a.events).toContainEqual({ type: 'focus', ms: 25 * MIN, endedAt: a.now });
    expect(a.events).toContainEqual({ type: 'stintComplete', lap: 1, early: false, endedAt: a.now });
    const b = finishPhase(a.state);
    expect(b.state.phase).toBe('stint');
    expect(b.state.lap).toBe(2);
  });

  it('gives a red flag after every 4th stint, then starts a new Grand Prix', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    const phases: string[] = [];
    const all: TimerEvent[] = [];
    for (let i = 0; i < 16; i += 1) {
      const r = finishPhase(s);
      s = r.state;
      phases.push(s.phase);
      all.push(...r.events);
    }
    expect(phases).toEqual([
      'pitStop', 'stint', 'pitStop', 'stint', 'pitStop', 'stint', 'redFlag', 'stint',
      'pitStop', 'stint', 'pitStop', 'stint', 'pitStop', 'stint', 'redFlag', 'stint',
    ]);
    expect(all.filter((e) => e.type === 'grandPrixComplete')).toHaveLength(2);
    expect(all.filter((e) => e.type === 'stintComplete')).toHaveLength(8);
    expect(s.lap).toBe(1);
    expect(s.creditedInSet).toBe(0);
  });

  it('red flag lasts the long break length', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    for (let i = 0; i < 7; i += 1) s = finishPhase(s).state;
    expect(s.phase).toBe('redFlag');
    expect(s.durationMs).toBe(20 * MIN);
    expect(s.lap).toBe(4);
  });
});

describe('stints per Grand Prix', () => {
  /** Phases visited from the start of a race until the next race begins. */
  function race(n: number): string[] {
    const cfg = { ...config, stintsPerGrandPrix: n };
    let s = t.start(t.createTimer(cfg), cfg, T0).state;
    const phases = ['stint'];
    while (true) {
      const r = finishPhase(s, cfg);
      s = r.state;
      if (s.phase === 'stint' && s.lap === 1) return phases;
      phases.push(s.phase);
    }
  }

  it.each([
    [1, ['stint', 'redFlag']],
    [2, ['stint', 'pitStop', 'stint', 'redFlag']],
    [3, ['stint', 'pitStop', 'stint', 'pitStop', 'stint', 'redFlag']],
    [6, ['stint', 'pitStop', 'stint', 'pitStop', 'stint', 'pitStop', 'stint', 'pitStop', 'stint', 'pitStop', 'stint', 'redFlag']],
  ])('%i stints: red flag after the last one', (n, phases) => {
    expect(race(n)).toEqual(phases);
  });

  it('counts a Grand Prix as complete after the chosen number of stints', () => {
    const cfg = { ...config, stintsPerGrandPrix: 2 };
    let s = t.start(t.createTimer(cfg), cfg, T0).state;
    const events: TimerEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = finishPhase(s, cfg);
      s = r.state;
      events.push(...r.events);
    }
    expect(s.phase).toBe('redFlag');
    expect(events.filter((e) => e.type === 'grandPrixComplete')).toHaveLength(1);
  });

  it('lowering the count mid-race ends the race after the current stint', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    for (let i = 0; i < 4; i += 1) s = finishPhase(s).state; // now on lap 3 of 4
    expect(s.lap).toBe(3);
    const two = { ...config, stintsPerGrandPrix: 2 };
    const r = finishPhase(s, two);
    expect(r.state.phase).toBe('redFlag');
    expect(r.events.some((e) => e.type === 'grandPrixComplete')).toBe(true);
  });

  it('raising the count mid-race adds more laps before the red flag', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    for (let i = 0; i < 6; i += 1) s = finishPhase(s).state; // lap 4 of 4
    const six = { ...config, stintsPerGrandPrix: 6 };
    s = finishPhase(s, six).state;
    expect(s.phase).toBe('pitStop');
    s = finishPhase(s, six).state;
    expect(s.lap).toBe(5);
  });
});

describe('pause and resume', () => {
  it('pause freezes the remaining time and resume continues from it', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const p = t.pause(s, T0 + 10 * MIN);
    expect(p.state.running).toBe(false);
    expect(t.isPaused(p.state)).toBe(true);
    expect(p.state.remainingMs).toBe(15 * MIN);
    expect(p.events).toEqual([{ type: 'focus', ms: 10 * MIN, endedAt: T0 + 10 * MIN }]);
    // An hour passes while paused: nothing moves.
    expect(t.remaining(p.state, T0 + 70 * MIN)).toBe(15 * MIN);
    expect(t.tick(p.state, config, T0 + 70 * MIN).events).toEqual([]);
    const r = t.resume(p.state, T0 + 70 * MIN);
    expect(r.state.endsAt).toBe(T0 + 85 * MIN);
    const done = t.tick(r.state, config, T0 + 85 * MIN);
    // Second unbroken segment is the remaining 15 minutes.
    expect(done.events).toContainEqual({ type: 'focus', ms: 15 * MIN, endedAt: T0 + 85 * MIN });
    expect(done.state.phase).toBe('pitStop');
  });

  it('several pauses add up exactly', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    let now = T0;
    let focus = 0;
    for (let i = 0; i < 5; i += 1) {
      now += 3 * MIN;
      const p = t.pause(s, now);
      focus += p.events.reduce((n, e) => n + (e.type === 'focus' ? e.ms : 0), 0);
      now += 7 * MIN;
      s = t.resume(p.state, now).state;
    }
    expect(focus).toBe(15 * MIN);
    expect(t.remaining(s, now)).toBe(10 * MIN);
  });

  it('pausing twice or resuming while running changes nothing', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    expect(t.resume(s, T0 + MIN).state).toBe(s);
    const p = t.pause(s, T0 + MIN).state;
    expect(t.pause(p, T0 + 2 * MIN).state).toBe(p);
  });

  it('toggle starts, pauses and resumes', () => {
    const a = t.toggle(t.createTimer(config), config, T0).state;
    expect(a.running).toBe(true);
    const b = t.toggle(a, config, T0 + MIN).state;
    expect(b.running).toBe(false);
    const c = t.toggle(b, config, T0 + 2 * MIN).state;
    expect(c.running).toBe(true);
    expect(c.phase).toBe('stint');
  });

  it('breaks can be paused too and never report focus time', () => {
    const s = finishPhase(t.start(t.createTimer(config), config, T0).state).state;
    const p = t.pause(s, s.endsAt! - 2 * MIN);
    expect(p.events).toEqual([]);
    expect(p.state.remainingMs).toBe(2 * MIN);
  });
});

describe('skip, box box and reset', () => {
  it('skip moves on without counting the stint', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const r = t.skip(s, config, T0 + 5 * MIN);
    expect(r.state.phase).toBe('pitStop');
    expect(r.state.running).toBe(true);
    expect(r.state.creditedInSet).toBe(0);
    expect(r.events.some((e) => e.type === 'stintComplete')).toBe(false);
    expect(r.events).toContainEqual({ type: 'focus', ms: 5 * MIN, endedAt: T0 + 5 * MIN });
  });

  it('skip from a break starts the next stint', () => {
    const s = finishPhase(t.start(t.createTimer(config), config, T0).state).state;
    const r = t.skip(s, config, s.endsAt! - MIN);
    expect(r.state.phase).toBe('stint');
    expect(r.state.lap).toBe(2);
  });

  it('skip does nothing when idle', () => {
    const s = t.createTimer(config);
    expect(t.skip(s, config, T0).state).toBe(s);
  });

  it('a Grand Prix with a skipped stint is not counted as complete', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    const all: TimerEvent[] = [];
    const skipped = t.skip(s, config, T0 + MIN);
    s = skipped.state;
    for (let i = 0; i < 6; i += 1) {
      const r = finishPhase(s);
      s = r.state;
      all.push(...r.events);
    }
    expect(s.phase).toBe('redFlag');
    expect(all.some((e) => e.type === 'grandPrixComplete')).toBe(false);
  });

  it('box box ends the stint early, counts it and starts the pit stop', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const r = t.boxBox(s, config, T0 + 18 * MIN);
    expect(r.state.phase).toBe('pitStop');
    expect(r.state.endsAt).toBe(T0 + 23 * MIN);
    expect(r.state.creditedInSet).toBe(1);
    expect(r.events).toContainEqual({ type: 'stintComplete', lap: 1, early: true, endedAt: T0 + 18 * MIN });
    expect(r.events).toContainEqual({ type: 'focus', ms: 18 * MIN, endedAt: T0 + 18 * MIN });
    expect(r.events).toContainEqual({ type: 'phaseChanged', from: 'stint', to: 'pitStop', cause: 'boxBox', lap: 1 });
  });

  it('box box works on a paused stint and is ignored during a break or idle', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const p = t.pause(s, T0 + MIN).state;
    expect(t.boxBox(p, config, T0 + 2 * MIN).state.phase).toBe('pitStop');
    const brk = finishPhase(s).state;
    expect(t.boxBox(brk, config, brk.endsAt! - 1).state).toBe(brk);
    const idle = t.createTimer(config);
    expect(t.boxBox(idle, config, T0).state).toBe(idle);
  });

  it('box box on the 4th stint goes to the red flag', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    for (let i = 0; i < 6; i += 1) s = finishPhase(s).state;
    expect(s.lap).toBe(4);
    const r = t.boxBox(s, config, s.endsAt! - MIN);
    expect(r.state.phase).toBe('redFlag');
    expect(r.events.some((e) => e.type === 'grandPrixComplete')).toBe(true);
  });

  it('reset returns to idle from anywhere and reports focus so far', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const r = t.reset(s, config, T0 + 4 * MIN);
    expect(r.state).toEqual(t.createTimer(config));
    expect(r.events).toContainEqual({ type: 'focus', ms: 4 * MIN, endedAt: T0 + 4 * MIN });
    expect(r.events).toContainEqual({ type: 'phaseChanged', from: 'stint', to: 'idle', cause: 'reset', lap: 1 });
    expect(t.reset(t.createTimer(config), config, T0).events).toEqual([]);
  });
});

describe('sleep / wake and clock jumps', () => {
  it('a 10 minute jump mid-stint just takes 10 minutes off the clock', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    expect(t.remaining(s, T0 + 5 * MIN)).toBe(20 * MIN);
    // Laptop sleeps for 10 minutes; no ticks happen in between.
    const r = t.tick(s, config, T0 + 15 * MIN);
    expect(r.state).toBe(s);
    expect(t.remaining(r.state, T0 + 15 * MIN)).toBe(10 * MIN);
  });

  it('waking 10 minutes after the stint ended completes it once and starts the break from now', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const wake = T0 + 35 * MIN;
    const r = t.tick(s, config, wake);
    expect(r.state.phase).toBe('pitStop');
    // The break starts at wake time, it is not already used up.
    expect(r.state.endsAt).toBe(wake + 5 * MIN);
    // Focus is credited only up to the real end of the stint.
    expect(r.events).toContainEqual({ type: 'focus', ms: 25 * MIN, endedAt: T0 + 25 * MIN });
    expect(r.events.filter((e) => e.type === 'phaseChanged')).toHaveLength(1);
    // A second tick at the same moment changes nothing.
    expect(t.tick(r.state, config, wake).events).toEqual([]);
  });

  it('stays within a second of real time over a 25 minute run with irregular ticks', () => {
    let s = t.start(t.createTimer(config), config, T0).state;
    let now = T0;
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let endedAt: number | null = null;
    while (endedAt === null) {
      // Ticks arrive anywhere between 50 ms and 900 ms apart (throttled window).
      now += 50 + Math.floor(rand() * 850);
      const r = t.tick(s, config, now);
      s = r.state;
      if (r.events.some((e) => e.type === 'phaseChanged')) endedAt = now;
    }
    expect(endedAt - (T0 + 25 * MIN)).toBeGreaterThanOrEqual(0);
    expect(endedAt - (T0 + 25 * MIN)).toBeLessThan(1000);
  });

  it('a clock that jumps backwards never produces negative focus or remaining time', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const p = t.pause(s, T0 - 5 * MIN);
    expect(p.events).toEqual([]);
    expect(p.state.remainingMs).toBeGreaterThanOrEqual(0);
  });
});

describe('resizePhase: changing the length of the phase in progress', () => {
  it('keeps the time already used (running)', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const at = T0 + 10 * MIN;
    const r = t.resizePhase(s, 50 * MIN, at);
    expect(t.remaining(r, at)).toBe(40 * MIN);
    expect(r.durationMs).toBe(50 * MIN);
    expect(r.endsAt).toBe(T0 + 50 * MIN);
    expect(t.progress(r, at)).toBeCloseTo(0.2);
  });

  it('keeps the time already used (paused) and stays paused', () => {
    const s = t.pause(t.start(t.createTimer(config), config, T0).state, T0 + 10 * MIN).state;
    const r = t.resizePhase(s, 15 * MIN, T0 + 30 * MIN);
    expect(r.running).toBe(false);
    expect(r.endsAt).toBeNull();
    expect(r.remainingMs).toBe(5 * MIN);
    expect(r.durationMs).toBe(15 * MIN);
  });

  it('leaves one minute when the new length is shorter than what is done', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const at = T0 + 20 * MIN;
    const r = t.resizePhase(s, 10 * MIN, at);
    expect(t.remaining(r, at)).toBe(MIN);
    expect(r.endsAt).toBe(at + MIN);
    expect(t.progress(r, at)).toBeLessThan(1);
    // And the phase then ends normally.
    expect(t.tick(r, config, at + MIN).state.phase).toBe('pitStop');
  });

  it('works on a break, and does nothing when idle', () => {
    const brk = finishPhase(t.start(t.createTimer(config), config, T0).state).state;
    const at = brk.endsAt! - 2 * MIN; // 3 of 5 minutes used
    const r = t.resizePhase(brk, 10 * MIN, at);
    expect(t.remaining(r, at)).toBe(7 * MIN);
    const idle = t.createTimer(config);
    expect(t.resizePhase(idle, 50 * MIN, T0)).toBe(idle);
  });

  it('keeps focus accounting right after an extension', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    const r = t.resizePhase(s, 40 * MIN, T0 + 10 * MIN);
    const done = t.tick(r, config, r.endsAt!);
    expect(done.events).toContainEqual({ type: 'focus', ms: 40 * MIN, endedAt: T0 + 40 * MIN });
  });
});

describe('auto-start off and config changes', () => {
  const manual = { ...config, autoStartNext: false };

  it('waits at the start of the next phase when auto-start is off', () => {
    const s = t.start(t.createTimer(manual), manual, T0).state;
    const r = finishPhase(s, manual);
    expect(r.state.phase).toBe('pitStop');
    expect(r.state.running).toBe(false);
    expect(r.state.remainingMs).toBe(5 * MIN);
    const go = t.start(r.state, manual, r.now + 3 * MIN);
    expect(go.state.endsAt).toBe(r.now + 8 * MIN);
  });

  it('new durations apply to an idle timer at once and to a running one from the next phase', () => {
    const longer = { ...config, stintMs: 50 * MIN, pitStopMs: 10 * MIN };
    expect(t.applyConfig(t.createTimer(config), longer).remainingMs).toBe(50 * MIN);
    const running = t.start(t.createTimer(config), config, T0).state;
    expect(t.applyConfig(running, longer)).toBe(running);
    const next = finishPhase(running, longer).state;
    expect(next.durationMs).toBe(10 * MIN);
  });

  it('progress goes from 0 to 1', () => {
    const s = t.start(t.createTimer(config), config, T0).state;
    expect(t.progress(s, T0)).toBe(0);
    expect(t.progress(s, T0 + 12.5 * MIN)).toBeCloseTo(0.5);
    expect(t.progress(s, T0 + 99 * MIN)).toBe(1);
    expect(t.progress(t.createTimer(config), T0)).toBe(0);
  });
});
