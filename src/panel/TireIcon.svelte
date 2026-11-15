<script lang="ts">
  import { COMPOUND_INFO, type Compound } from '../core/tires';

  let { compound, size = 34 }: { compound: Compound; size?: number } = $props();
  const info = $derived(COMPOUND_INFO[compound]);
</script>

<svg width={size} height={size} viewBox="-20 -20 40 40" aria-hidden="true">
  <circle r="19" fill="#0b0c0f" />
  <circle r="14" fill="none" stroke={info.color} stroke-width="3.6" stroke-dasharray="35 9" />
  <circle r="8.5" fill="#c9ced6" />
  <text y="3.6" text-anchor="middle" font-size="10" font-weight="800" fill="#14161a">{info.letter}</text>
</svg>
