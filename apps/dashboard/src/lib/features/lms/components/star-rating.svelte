<script lang="ts">
  import StarIcon from '@lucide/svelte/icons/star';

  // A small, accessible 1–5 star rater. `value` is 0 when unset. Used by the tutor-feedback dialog; there is
  // no reusable star rater in @cio/ui/base, so this is self-contained.

  interface Props {
    value: number;
    label: string;
    id: string;
  }

  let { value = $bindable(0), label, id }: Props = $props();

  const stars = [1, 2, 3, 4, 5];
</script>

<div class="flex items-center justify-between gap-3">
  <span id={`${id}-label`} class="text-sm">{label}</span>
  <div class="flex items-center gap-0.5" role="radiogroup" aria-labelledby={`${id}-label`}>
    {#each stars as s (s)}
      <button
        type="button"
        role="radio"
        aria-checked={value === s}
        aria-label={`${s} star${s > 1 ? 's' : ''}`}
        onclick={() => (value = s)}
        class="text-muted-foreground rounded p-0.5 transition-colors hover:text-amber-500"
      >
        <StarIcon class={`size-6 ${s <= value ? 'fill-amber-400 text-amber-400' : ''}`} />
      </button>
    {/each}
  </div>
</div>
