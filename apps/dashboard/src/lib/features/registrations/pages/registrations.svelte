<script lang="ts">
  import { registrationsApi, type RegistrationRow } from '$features/registrations/api/registrations.svelte';
  import { Button } from '@cio/ui/base/button';

  // PearlLMS Phase 7 Step 3 — Manager/Admin approval queue. Pending oldest-first (server-ordered); a filter
  // shows the decided record. Approve composes onboarding (course adjustable, defaulting to the requested one);
  // reject requires a note.
  $effect(() => {
    if (!registrationsApi.loaded) {
      void registrationsApi.load('pending');
      void registrationsApi.loadCourses();
    }
  });

  // Per-row transient UI state.
  let chosenCourse = $state<Record<string, string>>({});
  let rejectingId = $state<string | null>(null);
  let rejectNote = $state('');

  function courseFor(row: RegistrationRow): string {
    return chosenCourse[row.id] ?? row.requestedCourseId ?? '';
  }

  async function approve(row: RegistrationRow) {
    const courseId = courseFor(row);
    if (!courseId) return;
    await registrationsApi.approve(row.id, courseId);
  }

  async function confirmReject(row: RegistrationRow) {
    if (!rejectNote.trim()) return;
    await registrationsApi.reject(row.id, rejectNote.trim());
    rejectingId = null;
    rejectNote = '';
  }

  function fmt(dt: string): string {
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt;
    }
  }

  const filters: { key: 'pending' | 'approved' | 'rejected'; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' }
  ];
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6">
  <div class="mb-4">
    <h1 class="text-2xl font-semibold">Registrations</h1>
    <p class="text-muted-foreground text-sm">
      Review learner applications. Approving creates the account and sends a set-password invite.
    </p>
  </div>

  <div class="mb-4 flex gap-2">
    {#each filters as f (f.key)}
      <button
        class="rounded-md border px-3 py-1.5 text-sm {registrationsApi.status === f.key
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background hover:bg-muted'}"
        onclick={() => registrationsApi.load(f.key)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  {#if registrationsApi.isLoading && !registrationsApi.loaded}
    <p class="text-muted-foreground text-sm">Loading…</p>
  {:else if registrationsApi.items.length === 0}
    <p class="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
      No {registrationsApi.status} applications.
    </p>
  {:else}
    <ul class="space-y-3">
      {#each registrationsApi.items as row (row.id)}
        <li class="rounded-lg border p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-0.5">
              <p class="font-medium">{row.fullName}</p>
              <p class="text-muted-foreground text-sm">{row.email}</p>
              <p class="text-muted-foreground text-sm">
                Interested in: {row.requestedCourseTitle ?? '— none selected —'}
              </p>
              <p class="text-muted-foreground text-xs">Submitted {fmt(row.createdAt)}</p>
            </div>

            {#if row.status === 'pending'}
              <div class="flex flex-col items-end gap-2">
                <label class="sr-only" for={`course-${row.id}`}>Course</label>
                <select
                  id={`course-${row.id}`}
                  class="border-input bg-background h-9 rounded-md border px-2 text-sm"
                  value={courseFor(row)}
                  onchange={(e) => (chosenCourse[row.id] = (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">Select a course…</option>
                  {#each registrationsApi.courses as c (c.courseId)}
                    <option value={c.courseId}>{c.title ?? 'Untitled'}</option>
                  {/each}
                </select>
                <div class="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!courseFor(row) || registrationsApi.deciding === row.id}
                    onclick={() => approve(row)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={registrationsApi.deciding === row.id}
                    onclick={() => {
                      rejectingId = rejectingId === row.id ? null : row.id;
                      rejectNote = '';
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            {:else}
              <div class="text-right">
                <span
                  class="rounded-full px-2 py-0.5 text-xs {row.status === 'approved'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'}"
                >
                  {row.status}
                </span>
                {#if row.decidedAt}<p class="text-muted-foreground mt-1 text-xs">{fmt(row.decidedAt)}</p>{/if}
              </div>
            {/if}
          </div>

          {#if row.status === 'rejected' && row.decisionNote}
            <p class="text-muted-foreground mt-2 border-t pt-2 text-sm">
              <span class="font-medium">Note:</span>
              {row.decisionNote}
            </p>
          {/if}

          {#if rejectingId === row.id}
            <div class="mt-3 space-y-2 border-t pt-3">
              <label class="text-sm font-medium" for={`note-${row.id}`}>Reason for rejection (required)</label>
              <textarea
                id={`note-${row.id}`}
                class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                rows="2"
                bind:value={rejectNote}
              ></textarea>
              <div class="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!rejectNote.trim() || registrationsApi.deciding === row.id}
                  onclick={() => confirmReject(row)}
                >
                  Confirm reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => {
                    rejectingId = null;
                    rejectNote = '';
                  }}>Cancel</Button
                >
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
