<script lang="ts">
  /** First-run setup: where you are, and how long your stints are. Under a minute. */
  import LocationPicker from './LocationPicker.svelte';
  import { app, update } from './state.svelte';

  let step = $state(1);
  const s = $derived(app.snap!.settings);
  const classic = $derived(s.stintMin === 25 && s.pitStopMin === 5);
  const long = $derived(s.stintMin === 50 && s.pitStopMin === 10);
</script>

<div class="overlay" data-testid="onboarding">
  <div class="sheet">
    <p class="step muted">Step {step} of 2</p>
    {#if step === 1}
      <h1>Where are you racing?</h1>
      <p class="muted">The car's tires follow your local weather: wets in the rain, hards when it is cold or snowing, mediums under cloud, softs in the sun.</p>
      <LocationPicker />
      <div class="actions">
        <button class="ghost" onclick={() => (step = 2)}>Skip for now</button>
        <button class="primary" onclick={() => (step = 2)} disabled={!s.location} data-testid="onboarding-next">Next</button>
      </div>
    {:else}
      <h1>Pick your race distance</h1>
      <div class="choices">
        <button class="choice" class:on={classic} onclick={() => update({ stintMin: 25, pitStopMin: 5, redFlagMin: 20 })}>
          <strong>Classic</strong>
          <span class="muted">25 min stints, 5 min pit stops, 20 min podium break after the last stint</span>
        </button>
        <button class="choice" class:on={long} onclick={() => update({ stintMin: 50, pitStopMin: 10, redFlagMin: 30 })}>
          <strong>Long run</strong>
          <span class="muted">50 min stints, 10 min pit stops, 30 min podium break after the last stint</span>
        </button>
      </div>
      <div class="units" role="group" aria-label="Stints per Grand Prix">
        <span>Stints per Grand Prix</span>
        {#each [2, 3, 4, 6] as n (n)}
          <button class:on={s.stintsPerGP === n} onclick={() => update({ stintsPerGP: n })}>{n}</button>
        {/each}
      </div>
      <div class="units">
        <span>Temperature in</span>
        <button class:on={s.units === 'C'} onclick={() => update({ units: 'C' })}>°C</button>
        <button class:on={s.units === 'F'} onclick={() => update({ units: 'F' })}>°F</button>
      </div>
      <p class="muted">You can change all of this later in Settings. Drag the car anywhere; click it to open this window.</p>
      <div class="actions">
        <button class="ghost" onclick={() => (step = 1)}>Back</button>
        <button class="primary" onclick={() => update({ onboarded: true })} data-testid="onboarding-done">To the grid</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--bg);
    overflow: auto;
    z-index: 10;
    padding: 20px 18px;
  }
  .sheet {
    display: grid;
    gap: 14px;
    max-width: 420px;
    margin: 0 auto;
  }
  h1 {
    font-size: 22px;
    margin: 0;
  }
  p {
    margin: 0;
  }
  .step {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
  }
  .choices {
    display: grid;
    gap: 8px;
  }
  .choice {
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 12px 14px;
  }
  .choice.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .units {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .units button.on {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
</style>
