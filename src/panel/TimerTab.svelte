<script lang="ts">
  import { formatClock, formatTemp, PHASE_LABEL } from '../core/format';
  import { isPaused, progress, remaining } from '../core/timer';
  import { COMPOUND_INFO } from '../core/tires';
  import { describeWeather } from '../core/weather';
  import { unlockAudio } from '../lib/sound';
  import TireIcon from './TireIcon.svelte';
  import { app, dispatch, update } from './state.svelte';

  let { openSettings }: { openSettings: () => void } = $props();

  const snap = $derived(app.snap!);
  const t = $derived(snap.timer);
  const paused = $derived(isPaused(t));
  const left = $derived(remaining(t, app.now));
  const done = $derived(progress(t, app.now));
  const phaseText = $derived(
    paused ? `${PHASE_LABEL[t.phase]} (paused)` : t.phase === 'stint' && t.running && left <= 60_000 ? 'Final lap' : PHASE_LABEL[t.phase],
  );
  const primaryLabel = $derived(t.running ? 'Pause' : t.phase === 'idle' ? 'Lights out' : 'Resume');
  const info = $derived(COMPOUND_INFO[snap.tire.compound]);
  const lapTotal = $derived(Math.max(t.lap, snap.settings.stintsPerGP));

  // The objective box keeps its own text while you type.
  let objective = $state('');
  let editing = $state(false);
  $effect(() => {
    if (!editing) objective = snap.settings.objective;
  });

  function primary() {
    unlockAudio();
    dispatch({ type: 'toggle' });
  }
</script>

<section class="timer" data-phase={t.phase} data-paused={paused}>
  <div class="top">
    <span class="phase" data-testid="phase">{phaseText}</span>
    {#if t.phase !== 'redFlag'}
      <span class="lap" data-testid="lap">
        Stint {t.lap}/{lapTotal}
        <span class="dots" aria-hidden="true">
          {#each Array(lapTotal) as _, i (i)}
            <i class:done={i < t.creditedInSet} class:now={t.phase === 'stint' && i === t.lap - 1}></i>
          {/each}
        </span>
      </span>
    {:else}
      <span class="lap">🏆 Grand Prix complete</span>
    {/if}
  </div>

  <div class="clock" data-testid="clock" role="timer" aria-live="off">{formatClock(left)}</div>
  <div class="bar" aria-hidden="true"><div style="width: {done * 100}%"></div></div>

  <div class="controls">
    <button class="primary big" onclick={primary} data-testid="primary">{primaryLabel}</button>
    <button onclick={() => dispatch({ type: 'boxBox' })} disabled={t.phase !== 'stint'} title="End this stint early and go to the pit stop">
      Box box
    </button>
    <button onclick={() => dispatch({ type: 'skip' })} disabled={t.phase === 'idle'} title="Skip to the next stint or break">Skip</button>
    <button onclick={() => dispatch({ type: 'reset' })} disabled={t.phase === 'idle'} title="Back to the grid">Reset</button>
  </div>

  <label class="objective">
    <span class="muted">Race objective</span>
    <input
      type="text"
      placeholder="What are you studying?"
      maxlength="200"
      bind:value={objective}
      onfocus={() => (editing = true)}
      onblur={() => {
        editing = false;
        if (objective !== snap.settings.objective) update({ objective });
      }}
    />
  </label>
</section>

<section class="card weather" data-testid="weather-card">
  <div class="tire">
    <TireIcon compound={snap.tire.compound} size={44} />
    <div>
      <div class="compound" data-testid="compound">
        <span style="color: {info.color}">{info.label}</span> tires
        {#if snap.tire.locked}<span class="chip" title="Pinned in settings">🔒 Driver's choice</span>{/if}
      </div>
      <div class="muted" data-testid="reason">{snap.tire.locked ? 'Pinned, ignoring the weather' : snap.tire.reason}</div>
    </div>
  </div>
  <div class="conditions">
    {#if snap.settings.location}
      <div class="place">
        <span>{snap.settings.location.name}</span>
        {#if snap.settings.location.approximate}<span class="chip">approximate</span>{/if}
        {#if snap.tire.stale}<span class="chip warn" data-testid="no-telemetry">No telemetry</span>{/if}
      </div>
      {#if snap.conditions}
        <div class="now">
          <strong data-testid="temperature">{formatTemp(snap.conditions.temperatureC, snap.settings.units)}</strong>
          <span>{describeWeather(snap.conditions.weatherCode)}</span>
          <span class="muted">feels like {formatTemp(snap.conditions.apparentC, snap.settings.units)}</span>
        </div>
      {:else if snap.tire.stale}
        <div class="muted">Weather is not reachable. Using medium tires for now.</div>
      {:else}
        <div class="muted">Checking the weather…</div>
      {/if}
    {:else}
      <div class="muted">
        No location set, so the car is on mediums.
        <button class="link" onclick={openSettings}>Set your location</button>
      </div>
    {/if}
  </div>
</section>

<style>
  .timer {
    display: grid;
    gap: 10px;
    --tone: var(--muted);
  }
  .timer[data-phase='stint'] {
    --tone: var(--green);
  }
  .timer[data-phase='pitStop'] {
    --tone: var(--amber);
  }
  .timer[data-phase='redFlag'] {
    --tone: #ffd60a;
  }
  .timer[data-paused='true'] {
    --tone: #ffd60a;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .phase {
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .lap {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-weight: 600;
  }
  .dots {
    display: inline-flex;
    gap: 4px;
  }
  .dots i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
  }
  .dots i.done {
    background: var(--green);
    border-color: var(--green);
  }
  .dots i.now {
    border-color: var(--text);
  }
  .clock {
    font: 800 clamp(56px, 22vw, 84px) / 1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    text-align: center;
    letter-spacing: -0.02em;
    padding: 4px 0;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--card-2);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--tone);
    border-radius: 3px;
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .big {
    grid-column: 1 / -1;
    padding: 12px;
    font-size: 16px;
  }
  .objective {
    display: grid;
    gap: 4px;
  }
  .weather {
    display: grid;
    gap: 10px;
  }
  .tire {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .compound {
    font-size: 16px;
    font-weight: 700;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .place,
  .now {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  }
  .conditions {
    display: grid;
    gap: 4px;
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }
</style>
