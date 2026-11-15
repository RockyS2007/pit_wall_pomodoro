<script lang="ts">
  /** The Pit Wall: timer, weather, stats and settings. */
  import { onMount } from 'svelte';
  import { unlockAudio } from '../lib/sound';
  import Onboarding from './Onboarding.svelte';
  import SettingsTab from './SettingsTab.svelte';
  import StatsTab from './StatsTab.svelte';
  import TimerTab from './TimerTab.svelte';
  import { app, connect } from './state.svelte';

  type Tab = 'timer' | 'stats' | 'settings';
  let tab = $state<Tab>('timer');
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'timer', label: 'Timer' },
    { id: 'stats', label: 'Stats' },
    { id: 'settings', label: 'Settings' },
  ];

  onMount(() => {
    let off = () => {};
    void connect().then((fn) => (off = fn));
    return () => off();
  });
</script>

<svelte:window onpointerdown={unlockAudio} onkeydown={unlockAudio} />

{#if !app.snap || !app.snap.ready}
  <div class="waiting muted">Warming the tires…</div>
{:else}
  {#if !app.snap.settings.onboarded}
    <Onboarding />
  {/if}
  <div class="shell">
    <div class="tabs" role="tablist" aria-label="Pit Wall">
      {#each tabs as t (t.id)}
        <button role="tab" aria-selected={tab === t.id} class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </div>
    <main>
      {#if tab === 'timer'}
        <TimerTab openSettings={() => (tab = 'settings')} />
      {:else if tab === 'stats'}
        <StatsTab />
      {:else}
        <SettingsTab />
      {/if}
    </main>
  </div>
{/if}

<style>
  .waiting {
    display: grid;
    place-items: center;
    height: 100%;
  }
  .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 10px 14px 0;
  }
  .tabs button {
    border: 0;
    background: transparent;
    border-radius: 9px 9px 0 0;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-weight: 600;
    padding: 8px;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  main {
    overflow-y: auto;
    padding: 14px;
    display: grid;
    gap: 12px;
    align-content: start;
  }
</style>
