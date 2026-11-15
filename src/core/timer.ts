/**
 * Timer engine: a pure state machine for the stint / pit stop / red flag cycle.
 *
 * Everything here is a plain function of (state, config, now). Time is always
 * derived from wall-clock timestamps (`endsAt`), never from counting ticks, so
 * the timer stays correct if the machine sleeps or the window is throttled.
 */

export type Phase = 'idle' | 'stint' | 'pitStop' | 'redFlag';

export interface TimerConfig {
  stintMs: number;
  pitStopMs: number;
  redFlagMs: number;
  /** Stints in one Grand Prix. The long red flag break follows the last one. */
  stintsPerGrandPrix: number;
  /** When a phase runs out, start the next one straight away. */
  autoStartNext: boolean;
}

export interface TimerState {
  phase: Phase;
  /** True while the clock is counting down. A non-idle phase that is not running is paused. */
  running: boolean;
  /** Wall-clock time (ms) the phase ends. Only meaningful while running. */
  endsAt: number | null;
  /** Time left (ms). Only meaningful while not running. */
  remainingMs: number;
  /** Full length of the current phase (ms). */
  durationMs: number;
  /** 1-based stint number inside the current Grand Prix. */
  lap: number;
  /** Stints in this Grand Prix that were finished properly (not skipped). */
  creditedInSet: number;
  /** Start of the current unbroken focus segment, while a stint is running. */
  segmentStartedAt: number | null;
}

export type ChangeCause = 'start' | 'complete' | 'skip' | 'boxBox' | 'reset';

export type TimerEvent =
  | { type: 'phaseChanged'; from: Phase; to: Phase; cause: ChangeCause; lap: number }
  /** An unbroken stretch of focus time just ended (pause, stint end, skip, reset). */
  | { type: 'focus'; ms: number; endedAt: number }
  | { type: 'stintComplete'; lap: number; early: boolean; endedAt: number }
  | { type: 'grandPrixComplete'; endedAt: number };

export interface TimerResult {
  state: TimerState;
  events: TimerEvent[];
}

export function createTimer(config: TimerConfig): TimerState {
  return {
    phase: 'idle',
    running: false,
    endsAt: null,
    remainingMs: config.stintMs,
    durationMs: config.stintMs,
    lap: 1,
    creditedInSet: 0,
    segmentStartedAt: null,
  };
}

export function isPaused(state: TimerState): boolean {
  return state.phase !== 'idle' && !state.running;
}

/** Time left in the current phase, in ms, never negative. */
export function remaining(state: TimerState, now: number): number {
  if (state.running && state.endsAt !== null) return Math.max(0, state.endsAt - now);
  return Math.max(0, state.remainingMs);
}

/** 0..1 progress through the current phase. */
export function progress(state: TimerState, now: number): number {
  if (state.phase === 'idle' || state.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remaining(state, now) / state.durationMs));
}

function durationFor(phase: Phase, config: TimerConfig): number {
  if (phase === 'pitStop') return config.pitStopMs;
  if (phase === 'redFlag') return config.redFlagMs;
  return config.stintMs;
}

function enter(
  prev: TimerState,
  phase: Exclude<Phase, 'idle'>,
  lap: number,
  creditedInSet: number,
  config: TimerConfig,
  now: number,
  run: boolean,
): TimerState {
  const durationMs = durationFor(phase, config);
  return {
    ...prev,
    phase,
    lap,
    creditedInSet,
    durationMs,
    running: run,
    endsAt: run ? now + durationMs : null,
    remainingMs: durationMs,
    segmentStartedAt: run && phase === 'stint' ? now : null,
  };
}

/** Close the current unbroken focus segment, if one is open. */
function closeSegment(state: TimerState, at: number, events: TimerEvent[]): void {
  if (state.phase !== 'stint' || !state.running || state.segmentStartedAt === null) return;
  const end = state.endsAt !== null ? Math.min(at, state.endsAt) : at;
  const ms = Math.max(0, end - state.segmentStartedAt);
  if (ms > 0) events.push({ type: 'focus', ms, endedAt: end });
}

/**
 * Leave the current phase and move to the next one in the cycle.
 * `credit` says whether a stint counts as completed (true for natural end and box box).
 */
function advance(
  state: TimerState,
  config: TimerConfig,
  now: number,
  cause: 'complete' | 'skip' | 'boxBox',
  run: boolean,
): TimerResult {
  const events: TimerEvent[] = [];
  const endedAt = cause === 'complete' && state.endsAt !== null ? state.endsAt : now;
  closeSegment(state, endedAt, events);

  let next: TimerState;
  if (state.phase === 'stint') {
    const credit = cause !== 'skip';
    const credited = state.creditedInSet + (credit ? 1 : 0);
    if (credit) {
      events.push({ type: 'stintComplete', lap: state.lap, early: cause === 'boxBox', endedAt });
    }
    const lastOfSet = state.lap >= config.stintsPerGrandPrix;
    if (lastOfSet && credited >= config.stintsPerGrandPrix) {
      events.push({ type: 'grandPrixComplete', endedAt });
    }
    next = enter(state, lastOfSet ? 'redFlag' : 'pitStop', state.lap, credited, config, now, run);
  } else if (state.phase === 'pitStop') {
    next = enter(state, 'stint', state.lap + 1, state.creditedInSet, config, now, run);
  } else {
    // After a red flag a new Grand Prix begins.
    next = enter(state, 'stint', 1, 0, config, now, run);
  }
  events.push({ type: 'phaseChanged', from: state.phase, to: next.phase, cause, lap: next.lap });
  return { state: next, events };
}

/** Start from idle, or resume when paused. */
export function start(state: TimerState, config: TimerConfig, now: number): TimerResult {
  if (state.phase === 'idle') {
    const next = enter(state, 'stint', 1, 0, config, now, true);
    return {
      state: next,
      events: [{ type: 'phaseChanged', from: 'idle', to: 'stint', cause: 'start', lap: 1 }],
    };
  }
  return resume(state, now);
}

export function pause(state: TimerState, now: number): TimerResult {
  if (!state.running) return { state, events: [] };
  const events: TimerEvent[] = [];
  closeSegment(state, now, events);
  return {
    state: {
      ...state,
      running: false,
      remainingMs: remaining(state, now),
      endsAt: null,
      segmentStartedAt: null,
    },
    events,
  };
}

export function resume(state: TimerState, now: number): TimerResult {
  if (state.phase === 'idle' || state.running) return { state, events: [] };
  return {
    state: {
      ...state,
      running: true,
      endsAt: now + state.remainingMs,
      segmentStartedAt: state.phase === 'stint' ? now : null,
    },
    events: [],
  };
}

export function toggle(state: TimerState, config: TimerConfig, now: number): TimerResult {
  return state.running ? pause(state, now) : start(state, config, now);
}

/** Jump to the next phase. A skipped stint is not counted as completed. */
export function skip(state: TimerState, config: TimerConfig, now: number): TimerResult {
  if (state.phase === 'idle') return { state, events: [] };
  return advance(state, config, now, 'skip', true);
}

/** "Box box": end the current stint early, count it, and go straight to the break. */
export function boxBox(state: TimerState, config: TimerConfig, now: number): TimerResult {
  if (state.phase !== 'stint') return { state, events: [] };
  return advance(state, config, now, 'boxBox', true);
}

export function reset(state: TimerState, config: TimerConfig, now: number): TimerResult {
  if (state.phase === 'idle') return { state: createTimer(config), events: [] };
  const events: TimerEvent[] = [];
  closeSegment(state, now, events);
  events.push({ type: 'phaseChanged', from: state.phase, to: 'idle', cause: 'reset', lap: 1 });
  return { state: createTimer(config), events };
}

/**
 * Call regularly (any cadence). If the running phase has reached its end time,
 * moves on to the next phase. Only one transition happens per call, and the
 * next phase starts from `now`, so waking from a long sleep never burns
 * through several phases at once.
 */
export function tick(state: TimerState, config: TimerConfig, now: number): TimerResult {
  if (!state.running || state.endsAt === null || now < state.endsAt) return { state, events: [] };
  return advance(state, config, now, 'complete', config.autoStartNext);
}

/** Keep an idle timer in step with changed durations. */
export function applyConfig(state: TimerState, config: TimerConfig): TimerState {
  if (state.phase !== 'idle') return state;
  return { ...state, remainingMs: config.stintMs, durationMs: config.stintMs };
}
