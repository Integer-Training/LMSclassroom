<script lang="ts">
  interface Props {
    label: string;
    value: string | number;
    sub?: string;
  }
  let { label, value, sub }: Props = $props();
</script>

<div class="bg-card rounded-xl border p-4">
  <p class="ui:text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
  <p class="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
  {#if sub}<p class="ui:text-muted-foreground mt-0.5 text-xs">{sub}</p>{/if}
</div>
