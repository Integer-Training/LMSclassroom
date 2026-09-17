<script lang="ts">
  interface Item {
    label: string;
    value: number;
  }
  interface Props {
    items: Item[];
    unit?: string;
    labelWidth?: string;
  }
  let { items, unit = '', labelWidth = 'w-24' }: Props = $props();

  const max = $derived(Math.max(1, ...items.map((i) => i.value)));
</script>

<div class="space-y-2">
  {#each items as it (it.label)}
    <div class="flex items-center gap-3">
      <span class="ui:text-muted-foreground {labelWidth} shrink-0 truncate text-xs" title={it.label}>{it.label}</span>
      <div class="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
        <div class="bg-primary h-full rounded-full" style="width: {(it.value / max) * 100}%"></div>
      </div>
      <span class="w-12 shrink-0 text-right text-xs font-medium tabular-nums">{it.value}{unit}</span>
    </div>
  {/each}
</div>
