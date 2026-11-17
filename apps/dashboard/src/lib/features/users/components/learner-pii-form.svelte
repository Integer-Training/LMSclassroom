<script lang="ts">
  import { Input } from '@cio/ui/base/input';
  import type { LearnerProfile } from '$features/users/api/users.svelte';

  // Admin-only enrolment PII fields, shared by the Users "Edit profile" dialog and the Edit details dialog.
  // The parent owns loading/saving; this just renders and edits `form` in place.

  interface Props {
    form: LearnerProfile;
    loading?: boolean;
  }

  let { form = $bindable(), loading = false }: Props = $props();

  const PII_FIELDS: Array<{ key: keyof LearnerProfile; label: string; type: 'date' | 'text' | 'textarea' }> = [
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { key: 'niNumber', label: 'NI number', type: 'text' },
    { key: 'gender', label: 'Gender', type: 'text' },
    { key: 'ethnicity', label: 'Ethnicity', type: 'text' },
    { key: 'disability', label: 'Disability', type: 'text' },
    { key: 'address', label: 'Address', type: 'text' },
    { key: 'aebRegion', label: 'AEB region', type: 'text' },
    { key: 'collegeRef', label: 'College ref', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];
</script>

{#if loading}
  <p class="text-muted-foreground text-sm">Loading…</p>
{:else}
  {#each PII_FIELDS as f (f.key)}
    <div class="space-y-1">
      <label for={`pii-${f.key}`} class="text-sm font-medium">{f.label}</label>
      {#if f.type === 'textarea'}
        <textarea
          id={`pii-${f.key}`}
          class="border-input bg-background focus-visible:ring-ring min-h-[72px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
          value={form[f.key] ?? ''}
          oninput={(e) => (form[f.key] = e.currentTarget.value || null)}
        ></textarea>
      {:else}
        <Input
          id={`pii-${f.key}`}
          type={f.type === 'date' ? 'date' : 'text'}
          value={form[f.key] ?? ''}
          oninput={(e) => (form[f.key] = e.currentTarget.value || null)}
        />
      {/if}
    </div>
  {/each}
{/if}
