<script lang="ts">
  import type { AdminOverview } from '$features/admin-dashboard/api/admin-dashboard.svelte';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

  interface Props {
    unallocated: AdminOverview['unallocatedLearners'];
    // Learner pages (/caseload/:id) are staff-only (admin/tutor) — managers see plain names, not links.
    canOpenLearner: boolean;
  }

  let { unallocated, canOpenLearner }: Props = $props();

  // The API returns the exact total but only the first page of names.
  const hiddenCount = $derived(Math.max(0, unallocated.count - unallocated.learners.length));
</script>

<!-- Enrolled learners with no tutor: tutors only see allocated learners, so nobody is marking these. -->
{#if unallocated.count > 0}
  <div class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
    <div class="flex items-center gap-2 text-amber-700 dark:text-amber-400">
      <TriangleAlertIcon class="h-4 w-4 shrink-0" />
      <p class="text-sm font-semibold">
        {unallocated.count} enrolled learner{unallocated.count === 1 ? ' has' : 's have'} no tutor allocated
      </p>
    </div>
    <p class="text-muted-foreground mt-1 text-xs">
      Tutors only see learners allocated to them, so no tutor can see or mark these learners until you allocate one.
    </p>
    <ul class="mt-3 flex flex-wrap gap-2">
      {#each unallocated.learners as l (l.learnerId)}
        <li>
          {#if canOpenLearner}
            <a
              href={`/caseload/${l.learnerId}`}
              class="bg-card hover:bg-muted inline-block rounded-md border px-2 py-1 text-xs"
            >
              {l.name ?? l.email ?? l.learnerId}
            </a>
          {:else}
            <span class="bg-card inline-block rounded-md border px-2 py-1 text-xs">
              {l.name ?? l.email ?? l.learnerId}
            </span>
          {/if}
        </li>
      {/each}
      {#if hiddenCount > 0}
        <li class="text-muted-foreground px-2 py-1 text-xs">+{hiddenCount} more</li>
      {/if}
    </ul>
  </div>
{/if}
