<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { caseloadApi } from '$features/caseload/api/caseload.svelte';

  // Tutor caseload landing (PearlLMS Phase 3 Step 4). Allocated learners only + an "awaiting marking"
  // queue (oldest-first). Read-only; result entry arrives in Step 5.

  let view = $state<'awaiting' | 'learners'>('awaiting');

  onMount(() => caseloadApi.loadCaseload());

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function waitingDays(iso: string): number {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }
</script>

<div class="mx-auto w-full max-w-4xl p-6">
  <div class="mb-6">
    <h1 class="text-xl font-semibold">Caseload</h1>
    <p class="text-muted-foreground text-sm">The learners allocated to you and their coursework.</p>
  </div>

  {#if caseloadApi.learners.length === 0}
    <div class="rounded-md border p-8 text-center">
      <UsersIcon class="text-muted-foreground mx-auto mb-3 size-6" />
      <p class="font-medium">No learners are allocated to you yet</p>
      <p class="text-muted-foreground mt-1 text-sm">Your manager assigns learners to you. They will appear here.</p>
    </div>
  {:else}
    <div class="mb-5 flex items-center gap-2">
      <Button variant={view === 'awaiting' ? 'default' : 'outline'} size="sm" onclick={() => (view = 'awaiting')}>
        <ClockIcon class="mr-1.5 size-4" />
        Awaiting marking ({caseloadApi.awaiting.length})
      </Button>
      <Button variant={view === 'learners' ? 'default' : 'outline'} size="sm" onclick={() => (view = 'learners')}>
        All learners ({caseloadApi.learners.length})
      </Button>
    </div>

    {#if view === 'awaiting'}
      {#if caseloadApi.awaiting.length === 0}
        <div class="text-muted-foreground rounded-md border p-8 text-center text-sm">
          {caseloadApi.isLoading ? 'Loading…' : 'Nothing awaiting marking. You are all caught up.'}
        </div>
      {:else}
        <ul class="space-y-2">
          {#each caseloadApi.awaiting as item (item.submissionId)}
            <li>
              <a
                href={`/caseload/${item.learnerId}`}
                class="hover:bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-3 transition-colors"
              >
                <div class="min-w-0">
                  <p class="truncate font-medium">{item.learnerName || 'Learner'}</p>
                  <p class="text-muted-foreground truncate text-sm">
                    {item.unitTitle} · {item.courseTitle} · v{item.version}
                  </p>
                </div>
                <div class="shrink-0 text-right">
                  <Badge variant="secondary">Awaiting marking</Badge>
                  <p class="text-muted-foreground mt-1 text-xs">
                    Submitted {formatDate(item.submittedAt)} · {waitingDays(item.submittedAt)}d
                  </p>
                </div>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <ul class="space-y-2">
        {#each caseloadApi.learners as learner (learner.learnerId)}
          <li>
            <a
              href={`/caseload/${learner.learnerId}`}
              class="hover:bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-3 transition-colors"
            >
              <div class="min-w-0">
                <p class="truncate font-medium">{learner.name || learner.email || 'Learner'}</p>
                <p class="text-muted-foreground truncate text-sm">{learner.email}</p>
              </div>
              <div class="shrink-0 text-right">
                {#if learner.submissionCount === 0}
                  <span class="text-muted-foreground text-sm">Nothing submitted yet</span>
                {:else}
                  <span class="text-sm"
                    >{learner.submissionCount} submission{learner.submissionCount === 1 ? '' : 's'}</span
                  >
                {/if}
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
