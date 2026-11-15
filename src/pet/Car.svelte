<script lang="ts">
  /**
   * The car. Original artwork, drawn as layered SVG: rear wing, body, cockpit
   * and helmet, front wing, and four tire groups. The tire sidewall stripe
   * takes its colour from the --tire-color CSS variable.
   *
   * Drawn in a 120 x 60 box, nose pointing right.
   */
  import type { Livery } from '../core/settings';

  interface Props {
    livery: Livery;
    number: number;
    tireColor: string;
    /** Wheels turning. */
    rolling?: boolean;
    fast?: boolean;
    /** 0 (fresh) to 1 (worn out). Visual only. */
    wear?: number;
    /** Wheels are off the car (mid tire change). */
    wheelsOff?: boolean;
    /** Car is up on the jack. */
    raised?: boolean;
  }

  let {
    livery,
    number,
    tireColor,
    rolling = false,
    fast = false,
    wear = 0,
    wheelsOff = false,
    raised = false,
  }: Props = $props();

  // Near-side wheels are drawn large; far-side wheels peek out behind them.
  const wheels = [
    { id: 'far-rear', x: 33.5, y: 39, r: 11.5, far: true },
    { id: 'far-front', x: 97.5, y: 40.5, r: 10.5, far: true },
    { id: 'near-rear', x: 27, y: 43, r: 13, far: false },
    { id: 'near-front', x: 92, y: 44.5, r: 11.5, far: false },
  ];
  const farWheels = wheels.filter((w) => w.far);
  const nearWheels = wheels.filter((w) => !w.far);
  const stripeOpacity = $derived(1 - Math.min(1, Math.max(0, wear)) * 0.5);
  const grainOpacity = $derived(Math.min(1, Math.max(0, wear)) * 0.45);
</script>

{#snippet tire(w: { id: string; x: number; y: number; r: number; far: boolean })}
  <g class="tire" class:off={wheelsOff} data-tire={w.id} transform="translate({w.x} {w.y})">
    <g class="tire-drop">
      <g class="spin" class:rolling class:fast>
        <circle r={w.r} fill={w.far ? '#0b0c0f' : '#17191e'} />
        <circle r={w.r - 0.6} fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2" />
        <!-- sidewall stripe: two arcs, so you can see the wheel turn -->
        <circle
          class="stripe"
          r={w.r * 0.72}
          fill="none"
          stroke-width={w.r * 0.2}
          stroke-dasharray="{w.r * 0.72 * Math.PI * 0.8} {w.r * 0.72 * Math.PI * 0.2}"
          opacity={w.far ? stripeOpacity * 0.75 : stripeOpacity}
        />
        <circle r={w.r * 0.46} fill={w.far ? '#3a3f4a' : '#c9ced6'} />
        {#if !w.far}
          <g stroke="#7d848f" stroke-width="1.3" stroke-linecap="round">
            <line x1="0" y1={-w.r * 0.4} x2="0" y2={w.r * 0.4} />
            <line x1={-w.r * 0.35} y1={-w.r * 0.2} x2={w.r * 0.35} y2={w.r * 0.2} />
            <line x1={-w.r * 0.35} y1={w.r * 0.2} x2={w.r * 0.35} y2={-w.r * 0.2} />
          </g>
          <circle r={w.r * 0.15} fill={livery.accent} />
        {/if}
      </g>
      <!-- wear: graining that builds up on the tread through a stint -->
      <circle
        class="grain"
        r={w.r - 1.1}
        fill="none"
        stroke="#7a7f88"
        stroke-width="1.3"
        opacity={grainOpacity}
      />
    </g>
  </g>
{/snippet}

<g class="car" style="--tire-color: {tireColor}">
  {#each farWheels as w (w.id)}
    {@render tire(w)}
  {/each}

  <g class="chassis" class:raised>
    <!-- rear wing -->
    <path d="M17 32 L22 20 L26 20 L24 32 Z" fill={livery.wing} />
    <path d="M5 14 H19 L21 34 H9 Z" fill={livery.wing} />
    <rect x="2.5" y="11" width="19.5" height="5" rx="2" fill={livery.accent} />
    <rect x="6.5" y="19" width="12" height="2.2" rx="1.1" fill={livery.accent} opacity=".55" />

    <!-- floor -->
    <path d="M15 45 H105 L111 48.5 H18 Z" fill="#14161a" />

    <!-- main body -->
    <path
      d="M13 39 C13 31 21 28 33 27 L45 24 C51 21 58 20.5 64 22.5 L71 27.5
         C84 29.5 99 34 111 40.5 C114.5 42.5 113 46 108.5 46 L17.5 46 C14.5 46 13 43 13 39 Z"
      fill={livery.body}
    />
    <!-- lower body shade -->
    <path d="M13.6 42 H112.6 C113 44.4 111.4 46 108.5 46 L17.5 46 C15.2 46 13.9 44.3 13.6 42 Z" fill="#000" opacity=".16" />
    <!-- sidepod stripe -->
    <path d="M30 36.5 H80 L92 40.5 H28 Z" fill={livery.accent} />
    <!-- nose tip -->
    <path d="M101 36.8 C105 38.3 108.5 39.8 111 41.2 C113.6 42.8 113 46 108.5 46 H101 Z" fill={livery.bodyDark} />

    <!-- engine cover and air intake -->
    <path d="M33 27 C36 17 46 12.5 55 14 L57.5 23 L45 24 Z" fill={livery.bodyDark} />
    <ellipse cx="53.8" cy="16.6" rx="2.6" ry="2" fill="#0d0f13" />

    <!-- driver -->
    <circle cx="63.5" cy="20.5" r="6.3" fill={livery.helmet} />
    <path d="M63.2 17.6 H69 A6.3 6.3 0 0 1 69.6 22 H63.2 Z" fill="#14161a" />
    <path d="M57.4 19 A6.3 6.3 0 0 1 63.5 14.2" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round" />
    <!-- cockpit rim and halo -->
    <path d="M55.5 25.5 C60 23.5 68 23.5 73 27.5 L56 28 Z" fill={livery.bodyDark} />
    <path d="M56 24.5 C60 12.5 72 12.5 78 28.5" fill="none" stroke="#14161a" stroke-width="2.1" stroke-linecap="round" />

    <!-- number -->
    <text x="43.5" y="34.2" class="number" fill={livery.number} text-anchor="middle">{number}</text>

    <!-- front wing -->
    <path d="M100 47 H117.5 C120 47 120 51.5 117.5 51.5 H97 Z" fill={livery.wing} />
    <rect x="113.5" y="42.5" width="4.5" height="9" rx="1.6" fill={livery.accent} />
  </g>

  {#each nearWheels as w (w.id)}
    {@render tire(w)}
  {/each}
</g>

<style>
  .stripe {
    stroke: var(--tire-color);
    transition: stroke 0.15s linear;
  }
  .number {
    font: 800 7.5px/1 ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif;
    letter-spacing: -0.3px;
  }
  .chassis {
    transition: transform 0.28s ease-out;
  }
  .chassis.raised {
    transform: translateY(-3.5px);
  }
  .tire-drop {
    transition:
      transform 0.38s cubic-bezier(0.3, 0, 0.4, 1),
      opacity 0.3s linear;
  }
  .tire.off .tire-drop {
    transform: translate(-5px, 9px) scale(0.86);
    opacity: 0;
  }
  .spin.rolling {
    animation: roll 0.9s linear infinite;
  }
  .spin.rolling.fast {
    animation-duration: 0.65s;
  }
  @keyframes roll {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin.rolling {
      animation: none;
    }
    .tire-drop,
    .chassis {
      transition: none;
    }
  }
</style>
