<script lang="ts">
  import { formatDuration } from '../core/format';
  import { streak, today, totalFocusMs, weekly } from '../core/stats';
  import { app, dispatch } from './state.svelte';

  const stats = $derived(app.snap!.stats);
  // Recompute at most once a minute; the day only changes at midnight.
  const minute = $derived(Math.floor(app.now / 60_000) * 60_000);
  const day = $derived(today(stats, minute));
  const bars = $derived(weekly(stats, minute));
  const peak = $derived(Math.max(60 * 60_000, ...bars.map((b) => b.focusMs)));
  const days = $derived(streak(stats, minute));
  let confirming = $state(false);
</script>

<section class="tiles">
  <div class="card tile">
    <span class="muted">Stints today</span>
    <strong data-testid="stints-today">{day.stints}</strong>
  </div>
  <div class="card tile">
    <span class="muted">Focus today</span>
    <strong data-testid="focus-today">{formatDuration(day.focusMs)}</strong>
  </div>
  <div class="card tile">
    <span class="muted">Streak</span>
    <strong data-testid="streak">{days} {days === 1 ? 'day' : 'days'}</strong>
    <small class="muted">days with a full Grand Prix</small>
  </div>
  <div class="card tile">
    <span class="muted">Longest time on track</span>
    <strong data-testid="fastest-lap">{stats.fastestLapMs ? formatDuration(stats.fastestLapMs) : 'none yet'}</strong>
    <small class="muted">longest focus without a pause</small>
  </div>
</section>

<section class="card">
  <h2>Focus time, last 7 days</h2>
  <div class="chart" role="img" aria-label="Focus time per day for the last 7 days">
    {#each bars as bar (bar.key)}
      <div class="col" title="{bar.label}: {formatDuration(bar.focusMs)}, {bar.stints} stints">
        <span class="value">{bar.focusMs > 0 ? formatDuration(bar.focusMs) : ''}</span>
        <div class="track">
          <div class="fill" class:today={bar.isToday} style="height: {(bar.focusMs / peak) * 100}%"></div>
        </div>
        <span class="day" class:today={bar.isToday}>{bar.label}</span>
      </div>
    {/each}
  </div>
  <p class="muted total">All-time focus: <span data-testid="total-focus">{formatDuration(totalFocusMs(stats))}</span></p>
</section>

<div class="reset">
  {#if confirming}
    <span class="muted">Clear all stats?</span>
    <button onclick={() => { dispatch({ type: 'resetStats' }); confirming = false; }}>Yes, clear</button>
    <button class="ghost" onclick={() => (confirming = false)}>Cancel</button>
  {:else}
    <button class="link" onclick={() => (confirming = true)}>Reset stats</button>
  {/if}
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .tile {
    display: grid;
    gap: 2px;
  }
  .tile strong {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
  .tile small {
    font-size: 11px;
  }
  .chart {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    height: 150px;
  }
  .col {
    display: grid;
    grid-template-rows: 16px 1fr 18px;
    gap: 3px;
    text-align: center;
    min-width: 0;
  }
  .value {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }
  .track {
    display: flex;
    align-items: flex-end;
    background: var(--card-2);
    border-radius: 5px;
    overflow: hidden;
  }
  .fill {
    width: 100%;
    background: #0e8f8a;
    border-radius: 5px 5px 0 0;
    min-height: 0;
  }
  .fill.today {
    background: var(--accent);
  }
  .day {
    font-size: 11px;
    color: var(--muted);
  }
  .day.today {
    color: var(--text);
    font-weight: 700;
  }
  .total {
    margin: 10px 0 0;
  }
  .reset {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }
</style>
