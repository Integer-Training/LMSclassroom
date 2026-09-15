<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';

  import { Badge } from '@cio/ui/base/badge';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import FolderIcon from '@lucide/svelte/icons/folder';

  import AssetCard from './asset-card.svelte';
  import { t } from '$lib/utils/functions/translations';
  import type { GroupedMedia, OrganizationAsset } from '$features/media/utils';

  interface Props {
    grouped: GroupedMedia;
    /** Lookup built from `grouped.assets` — an id may appear under several units. */
    assets: Map<string, OrganizationAsset>;
    downloadingAssetId?: string | null;
    onEdit?: (asset: OrganizationAsset) => void;
    onUsage?: (asset: OrganizationAsset) => void;
    onDownload?: (asset: OrganizationAsset) => void;
    onManageThumbnails?: (asset: OrganizationAsset) => void;
    onDelete?: (asset: OrganizationAsset) => void;
  }

  let {
    grouped,
    assets,
    downloadingAssetId = null,
    onEdit = () => {},
    onUsage = () => {},
    onDownload = () => {},
    onManageThumbnails = () => {},
    onDelete = () => {}
  }: Props = $props();

  // Track collapsed sections — absence means expanded, so everything is open by default.
  const collapsed = new SvelteSet<string>();

  function toggle(key: string) {
    if (collapsed.has(key)) {
      collapsed.delete(key);
    } else {
      collapsed.add(key);
    }
  }

  // Resolve ids → assets, dropping ids missing from the lookup.
  function resolve(ids: string[]): OrganizationAsset[] {
    const seen = new SvelteSet<string>();
    const out: OrganizationAsset[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const asset = assets.get(id);
      if (asset) {
        seen.add(id);
        out.push(asset);
      }
    }
    return out;
  }

  interface ResolvedUnit {
    lessonId: string;
    unitTitle: string;
    items: OrganizationAsset[];
  }
  interface ResolvedCourse {
    courseId: string;
    courseTitle: string;
    count: number;
    units: ResolvedUnit[];
  }

  const courses = $derived<ResolvedCourse[]>(
    grouped.groups
      .map((course) => {
        const units = course.units
          .map((unit) => ({
            lessonId: unit.lessonId,
            unitTitle: unit.unitTitle,
            items: resolve(unit.assetIds)
          }))
          .filter((unit) => unit.items.length > 0);
        const count = units.reduce((sum, unit) => sum + unit.items.length, 0);
        return { courseId: course.courseId, courseTitle: course.courseTitle, count, units };
      })
      .filter((course) => course.count > 0)
  );

  const unassigned = $derived(resolve(grouped.unassignedAssetIds));
  const isEmpty = $derived(courses.length === 0 && unassigned.length === 0);

  const gridClass = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
</script>

{#if isEmpty}
  <div class="bg-card text-muted-foreground rounded-xl border p-10 text-center text-sm">
    {$t('media_manager.grouped.empty')}
  </div>
{:else}
  <div class="flex w-full flex-col gap-4">
    {#each courses as course (course.courseId)}
      {@const courseKey = `course:${course.courseId}`}
      {@const courseOpen = !collapsed.has(courseKey)}
      <section class="bg-card rounded-xl border">
        <button
          type="button"
          class="flex w-full items-center gap-2 p-4 text-left"
          aria-expanded={courseOpen}
          onclick={() => toggle(courseKey)}
        >
          {#if courseOpen}
            <ChevronDownIcon size={18} class="text-muted-foreground shrink-0" />
          {:else}
            <ChevronRightIcon size={18} class="text-muted-foreground shrink-0" />
          {/if}
          <FolderIcon size={16} class="text-muted-foreground shrink-0" />
          <span class="min-w-0 flex-1 truncate font-semibold">{course.courseTitle}</span>
          <Badge variant="secondary">{course.count}</Badge>
        </button>

        {#if courseOpen}
          <div class="flex flex-col gap-3 px-4 pb-4">
            {#each course.units as unit (unit.lessonId)}
              {@const unitKey = `unit:${course.courseId}:${unit.lessonId}`}
              {@const unitOpen = !collapsed.has(unitKey)}
              <div class="rounded-lg border">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  aria-expanded={unitOpen}
                  onclick={() => toggle(unitKey)}
                >
                  {#if unitOpen}
                    <ChevronDownIcon size={16} class="text-muted-foreground shrink-0" />
                  {:else}
                    <ChevronRightIcon size={16} class="text-muted-foreground shrink-0" />
                  {/if}
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{unit.unitTitle}</span>
                  <Badge variant="outline">{unit.items.length}</Badge>
                </button>

                {#if unitOpen}
                  <div class={`${gridClass} p-3 pt-0`}>
                    {#each unit.items as asset (asset.id)}
                      <AssetCard
                        {asset}
                        {downloadingAssetId}
                        {onEdit}
                        {onUsage}
                        {onDownload}
                        {onManageThumbnails}
                        {onDelete}
                      />
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}

    {#if unassigned.length > 0}
      {@const unassignedOpen = !collapsed.has('unassigned')}
      <section class="bg-card rounded-xl border">
        <button
          type="button"
          class="flex w-full items-center gap-2 p-4 text-left"
          aria-expanded={unassignedOpen}
          onclick={() => toggle('unassigned')}
        >
          {#if unassignedOpen}
            <ChevronDownIcon size={18} class="text-muted-foreground shrink-0" />
          {:else}
            <ChevronRightIcon size={18} class="text-muted-foreground shrink-0" />
          {/if}
          <FolderIcon size={16} class="text-muted-foreground shrink-0" />
          <span class="min-w-0 flex-1 truncate font-semibold">{$t('media_manager.grouped.unassigned')}</span>
          <Badge variant="secondary">{unassigned.length}</Badge>
        </button>

        {#if unassignedOpen}
          <div class={`${gridClass} px-4 pb-4`}>
            {#each unassigned as asset (asset.id)}
              <AssetCard {asset} {downloadingAssetId} {onEdit} {onUsage} {onDownload} {onManageThumbnails} {onDelete} />
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}
