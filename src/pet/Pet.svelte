<script lang="ts">
  /**
   * The desktop pet: a small transparent window with the car in it.
   * This window also hosts the engine, so the timer keeps running whether or
   * not the Pit Wall panel is open.
   */
  import { onMount } from 'svelte';
  import Car from './Car.svelte';
  import { Engine, type Command, type Snapshot } from '../engine/engine';
  import { COMPOUND_INFO, type Compound } from '../core/tires';
  import { isPaused, progress, remaining } from '../core/timer';
  import { formatClock, formatTemp, PHASE_LABEL } from '../core/format';
  import { liveryFor, PET_BASE, PET_SCALE } from '../core/settings';
  import { isDrag } from '../core/position';
  import * as platform from '../lib/platform';
  import { playSound, unlockAudio } from '../lib/sound';
  import { restorePosition, startDrag, watchMoves, resizePet, showContextMenu } from './window';

  const engine = new Engine({
    now: () => Date.now(),
    fetch: platform.fetchJson,
    load: platform.loadKey,
    save: platform.saveKey,
    notify: (title, body) => void platform.notify(title, body).catch(() => {}),
    playSound: (name, volume) => {
      // If this window may not make sound yet, let the Pit Wall play it.
      if (!playSound(name, volume)) void platform.send('play-sound', { name, volume });
    },
    setAutostart: platform.setAutostart,
    setHotkey: (accelerator) => platform.setHotkey(accelerator, () => engine.dispatch({ type: 'toggle' })),
    log: (message) => console.info(message),
  });

  let snap = $state<Snapshot>(engine.snapshot());
  let now = $state(Date.now());

  // ---- tire change animation ------------------------------------------------
  let shownCompound = $state<Compound>(engine.snapshot().tire.compound);
  let wheelsOff = $state(false);
  let swapping = $state(false);
  let lastSwapSeq = engine.snapshot().swapSeq;
  let swapTimers: ReturnType<typeof setTimeout>[] = [];
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Two-second pit-crew swap: wheels off, new compound on, wheels back. */
  function playSwap(next: Compound) {
    swapTimers.forEach(clearTimeout);
    swapTimers = [];
    if (reducedMotion) {
      shownCompound = next;
      return;
    }
    swapping = true;
    wheelsOff = true;
    swapTimers.push(
      setTimeout(() => (shownCompound = next), 900),
      setTimeout(() => (wheelsOff = false), 1000),
      setTimeout(() => (swapping = false), 2000),
    );
  }

  // ---- derived view state ---------------------------------------------------
  const phase = $derived(snap.timer.phase);
  const paused = $derived(isPaused(snap.timer));
  const left = $derived(remaining(snap.timer, now));
  const done = $derived(progress(snap.timer, now));
  const running = $derived(snap.timer.running);
  const stintRunning = $derived(phase === 'stint' && running);
  const finalLap = $derived(stintRunning && left <= 60_000);
  const inPit = $derived(phase === 'pitStop');
  const wear = $derived(phase === 'stint' ? done : 0);
  const livery = $derived(liveryFor(snap.settings.livery));
  const night = $derived(snap.settings.nightDim && snap.conditions !== null && !snap.conditions.isDay);
  const flag = $derived(
    paused ? 'yellow' : finalLap || phase === 'redFlag' ? 'chequered' : null,
  );
  const ringColor = $derived(
    phase === 'stint' ? '#34d399' : phase === 'pitStop' ? '#ffb020' : phase === 'redFlag' ? '#ffd60a' : '#9aa3af',
  );
  const RING = 2 * Math.PI * 11;

  /** Never show more laps done than the race has (if the count was lowered mid-race). */
  const lapTotal = $derived(Math.max(snap.timer.lap, snap.settings.stintsPerGP));

  const tooltip = $derived.by(() => {
    const info = COMPOUND_INFO[snap.tire.compound];
    const temp = snap.conditions ? `, ${formatTemp(snap.conditions.temperatureC, snap.settings.units)}` : '';
    const tires = `${info.label}: ${snap.tire.reason}${temp}${snap.tire.stale ? ' (no telemetry)' : ''}`;
    if (phase === 'idle') return `Parked. Click to open the Pit Wall.\n${tires}`;
    const lap = phase === 'redFlag' ? '' : ` ${snap.timer.lap}/${lapTotal}`;
    return `${PHASE_LABEL[phase]}${lap}: ${formatClock(left)} left${paused ? ' (paused)' : ''}\n${tires}`;
  });

  // ---- idle engine wobble and pit stop loop, driven by slow timers -----------
  let revving = $state(false);
  let pitTimer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    // During a pit stop the crew keeps swapping tires every few seconds.
    if (inPit && running && !reducedMotion) {
      playSwap(shownCompound);
      pitTimer = setInterval(() => playSwap(snap.tire.compound), 5000);
      return () => {
        if (pitTimer) clearInterval(pitTimer);
      };
    }
  });

  // ---- dragging --------------------------------------------------------------
  let pressAt: { x: number; y: number } | null = null;
  let dragging = $state(false);
  let tilt = $state(0);

  function onPointerDown(event: PointerEvent) {
    unlockAudio();
    if (event.button !== 0) return;
    pressAt = { x: event.screenX, y: event.screenY };
    dragging = false;
  }

  function onPointerMove(event: PointerEvent) {
    if (!pressAt || dragging || event.buttons !== 1) return;
    const here = { x: event.screenX, y: event.screenY };
    if (isDrag(pressAt, here)) {
      dragging = true;
      tilt = here.x >= pressAt.x ? 5 : -5;
      void startDrag();
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (event.button !== 0) return;
    const wasDrag = dragging;
    pressAt = null;
    dragging = false;
    tilt = 0;
    // A press that never moved past the threshold is a click.
    if (!wasDrag) void platform.togglePanel();
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    pressAt = null;
    void showContextMenu({
      running,
      idle: phase === 'idle',
      toggle: () => engine.dispatch({ type: 'toggle' }),
      skip: () => engine.dispatch({ type: 'skip' }),
      openPanel: () => void platform.showPanel(),
      hidePet: () => void platform.setPetVisible(false),
      quit: () => void platform.quitApp(),
    });
  }

  // ---- lifecycle -------------------------------------------------------------
  onMount(() => {
    const cleanups: Array<() => void> = [];
    let size = engine.snapshot().settings.petSize;

    cleanups.push(
      engine.subscribe((s) => {
        snap = s;
        now = Date.now();
        void platform.send('snapshot', s);
        if (s.swapSeq !== lastSwapSeq) {
          lastSwapSeq = s.swapSeq;
          playSwap(s.tire.compound);
        } else if (!swapping && shownCompound !== s.tire.compound) {
          shownCompound = s.tire.compound;
        }
        if (s.settings.petSize !== size) {
          size = s.settings.petSize;
          void resizePet(PET_SCALE[size]);
        }
      }),
    );

    const beat = () => {
      engine.tick();
      now = Date.now();
    };
    const interval = setInterval(beat, 500);
    cleanups.push(() => clearInterval(interval));
    const wobble = setInterval(() => {
      if (phase !== 'idle' || reducedMotion) return;
      revving = true;
      setTimeout(() => (revving = false), 450);
    }, 3600);
    cleanups.push(() => clearInterval(wobble));

    void (async () => {
      // The native side sends a heartbeat every second, so the timer still
      // advances if the system throttles this window's own timers.
      cleanups.push(await platform.on('heartbeat', beat));
      cleanups.push(await platform.on<Command>('command', (cmd) => engine.dispatch(cmd)));
      cleanups.push(
        await watchMoves((dx) => {
          if (dragging && dx !== 0) tilt = dx > 0 ? 5 : -5;
        }, () => {
          dragging = false;
          tilt = 0;
        }),
      );
      await engine.init();
      shownCompound = engine.snapshot().tire.compound;
      size = engine.snapshot().settings.petSize;
      await resizePet(PET_SCALE[size]);
      await restorePosition();
      if (!engine.snapshot().settings.onboarded) void platform.showPanel();
    })();

    (window as unknown as { __pitwall: unknown }).__pitwall = { engine };
    return () => cleanups.forEach((fn) => fn());
  });
</script>

<div
  class="pet"
  class:night
  role="button"
  tabindex="-1"
  title={tooltip}
  aria-label="Pit Wall Pomodoro car"
  data-phase={phase}
  data-paused={paused}
  data-compound={shownCompound}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  oncontextmenu={onContextMenu}
>
  <svg viewBox="0 0 {PET_BASE.width} {PET_BASE.height}" xmlns="http://www.w3.org/2000/svg">

    <!-- speed lines -->
    {#if stintRunning}
      <g class="speed" class:fast={finalLap} stroke="#fff" stroke-linecap="round">
        <line x1="2" y1="62" x2="13" y2="62" stroke-width="1.6" />
        <line x1="0" y1="74" x2="9" y2="74" stroke-width="1.6" />
        <line x1="3" y1="85" x2="12" y2="85" stroke-width="1.6" />
      </g>
    {/if}

    <ellipse cx="76" cy="97.5" rx="58" ry="3.6" fill="#000" opacity=".22" />

    <!-- jack stands under a raised car -->
    {#if inPit || swapping}
      <g fill="#f5c542">
        <path d="M58 97 L62 89 H68 L72 97 Z" />
        <rect x="56" y="96" width="18" height="2" rx="1" />
      </g>
    {/if}

    <g class="car-wrap" class:revving style="--tilt: {tilt}deg">
      <g transform="translate(15 40)">
        <Car
          {livery}
          number={snap.settings.carNumber}
          tireColor={COMPOUND_INFO[shownCompound].color}
          rolling={stintRunning}
          fast={finalLap}
          {wear}
          {wheelsOff}
          raised={inPit || swapping}
        />
      </g>
    </g>

    <!-- pit crew: two small figures with wheel guns -->
    {#if inPit || swapping}
      <g class="crew">
        {#each [{ x: 9, flip: 1 }, { x: 141, flip: -1 }] as c (c.x)}
          <g transform="translate({c.x} 80) scale({c.flip} 1)" class:working={wheelsOff}>
            <rect x="-5" y="3" width="10" height="13" rx="4" fill={livery.bodyDark} />
            <rect x="-5" y="8" width="10" height="3" fill={livery.accent} />
            <circle cx="0" cy="-1" r="5" fill={livery.accent} />
            <rect x="0" y="-2.5" width="5" height="3" rx="1.5" fill="#14161a" />
            <rect class="gun" x="4" y="6" width="9" height="3" rx="1.5" fill="#d7dbe2" />
          </g>
        {/each}
      </g>
    {/if}

    <!-- trophy, shown during the podium break at the end of a Grand Prix -->
    {#if phase === 'redFlag'}
      <g class="trophy" transform="translate(129 60)">
        <path d="M-7.5 -9 H7.5 V-3 C7.5 3 4 6.5 0 6.5 C-4 6.5 -7.5 3 -7.5 -3 Z" fill="#ffd60a" />
        <path d="M-7.5 -7 H-11 C-11 -1.5 -9 1 -6 1.6" fill="none" stroke="#ffd60a" stroke-width="2" stroke-linecap="round" />
        <path d="M7.5 -7 H11 C11 -1.5 9 1 6 1.6" fill="none" stroke="#ffd60a" stroke-width="2" stroke-linecap="round" />
        <path d="M-4.5 -7 V-3 C-4.5 0 -3.5 2 -2 3.4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.3" stroke-linecap="round" />
        <rect x="-1.6" y="6" width="3.2" height="5" fill="#e0a800" />
        <rect x="-6" y="10.5" width="12" height="3.2" rx="1" fill="#e0a800" />
        <rect x="-8" y="13.2" width="16" height="4" rx="1.2" fill="#2b3340" />
      </g>
    {/if}

    <!-- flag -->
    {#if flag}
      <g class="flag" data-flag={flag}>
        <rect x="6" y="5" width="2.2" height="27" rx="1.1" fill="#d7dbe2" />
        <g class="cloth">
          {#if flag === 'chequered'}
            <rect x="8.2" y="6" width="20" height="14" fill="#fff" />
            {#each [0, 1, 2, 3] as col (col)}
              {#each [0, 1, 2] as row (row)}
                {#if (col + row) % 2 === 0}
                  <rect x={8.2 + col * 5} y={6 + row * 4.67} width="5" height="4.67" fill="#14161a" />
                {/if}
              {/each}
            {/each}
          {:else}
            <rect x="8.2" y="6" width="20" height="14" rx="1" fill="#ffd60a" />
          {/if}
        </g>
      </g>
    {/if}

    <!-- time left -->
    {#if phase !== 'idle'}
      <g class="pill">
        <rect x="40" y="7" width="58" height="20" rx="10" fill="#14161a" opacity=".86" />
        <text x="69" y="21.5" text-anchor="middle">{formatClock(left)}</text>
      </g>
      <!-- progress ring with the lap number -->
      <g transform="translate(127 17)">
        <circle r="14" fill="#14161a" opacity=".86" />
        <circle r="11" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="3" />
        {#if done > 0.004}
          <circle
            r="11"
            fill="none"
            stroke={ringColor}
            stroke-width="3"
            stroke-linecap="round"
            stroke-dasharray="{RING * done} {RING}"
            transform="rotate(-90)"
          />
        {/if}
        <text class="lap" y="3.4" text-anchor="middle">
          {phase === 'redFlag' ? 'GP' : `${snap.timer.lap}/${lapTotal}`}
        </text>
      </g>
    {/if}

    <!-- badges: compound pinned, no telemetry -->
    <g transform="translate(140 42)">
      {#if snap.tire.locked}
        <g class="badge" data-badge="lock">
          <circle r="6.5" fill="#14161a" opacity=".86" />
          <rect x="-3" y="-0.8" width="6" height="4.6" rx="1" fill="#ffd60a" />
          <path d="M-1.9 -0.8 V-2.2 A1.9 1.9 0 0 1 1.9 -2.2 V-0.8" fill="none" stroke="#ffd60a" stroke-width="1.2" />
        </g>
      {/if}
      {#if snap.tire.stale}
        <g class="badge" data-badge="no-telemetry" transform="translate({snap.tire.locked ? -15 : 0} 0)">
          <circle r="6.5" fill="#14161a" opacity=".86" />
          <g stroke="#ff8a3d" stroke-width="1.3" stroke-linecap="round" fill="none">
            <path d="M-3.4 -0.6 A4.6 4.6 0 0 1 3.4 -0.6" />
            <path d="M-1.8 1.3 A2.4 2.4 0 0 1 1.8 1.3" />
            <line x1="-3.6" y1="-3.6" x2="3.6" y2="3.6" />
          </g>
          <circle cy="3" r="0.9" fill="#ff8a3d" />
        </g>
      {/if}
    </g>
  </svg>
</div>

<style>
  .pet {
    width: 100vw;
    height: 100vh;
    cursor: grab;
    outline: none;
    touch-action: none;
  }
  .pet:active {
    cursor: grabbing;
  }
  .pet.night {
    filter: brightness(0.84) saturate(0.92);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .car-wrap {
    transform-origin: 75px 90px;
    transform: rotate(var(--tilt, 0deg));
    transition: transform 0.18s ease-out;
  }
  .car-wrap.revving {
    animation: rev 0.15s linear 3;
  }
  @keyframes rev {
    0%,
    100% {
      translate: 0 0;
    }
    50% {
      translate: 0 -0.7px;
    }
  }
  .speed line {
    animation: streak 0.7s linear infinite;
    opacity: 0;
  }
  .speed line:nth-child(2) {
    animation-delay: 0.23s;
  }
  .speed line:nth-child(3) {
    animation-delay: 0.46s;
  }
  .speed.fast line {
    animation-duration: 0.35s;
  }
  @keyframes streak {
    0% {
      transform: translateX(8px);
      opacity: 0;
    }
    30% {
      opacity: 0.85;
    }
    100% {
      transform: translateX(-6px);
      opacity: 0;
    }
  }
  .cloth {
    transform-origin: 8px 13px;
    animation: wave 1.6s ease-in-out infinite;
  }
  @keyframes wave {
    0%,
    100% {
      transform: skewY(-4deg);
    }
    50% {
      transform: skewY(4deg);
    }
  }
  .crew .gun {
    transform-origin: 4px 7.5px;
  }
  .crew .working .gun {
    animation: gun 0.12s linear infinite;
  }
  @keyframes gun {
    50% {
      transform: rotate(-9deg);
    }
  }
  .pill text {
    font: 700 13px/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    fill: #fff;
    font-variant-numeric: tabular-nums;
  }
  .lap {
    font: 800 8.5px/1 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
    fill: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    .speed {
      display: none;
    }
    .car-wrap,
    .car-wrap.revving,
    .cloth,
    .crew .working .gun {
      animation: none;
      transition: none;
    }
  }
</style>
