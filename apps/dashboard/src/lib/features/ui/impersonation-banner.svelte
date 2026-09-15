<script lang="ts">
  import { onMount } from 'svelte';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import { readImpersonatingName, stopImpersonating } from '$lib/utils/functions/impersonation';

  // Shown only while an admin is impersonating a learner/tutor (the readable `impersonating` cookie is set by
  // the login-as endpoint). "Return to admin" mints a login-link back to the admin's own account.
  let name = $state<string | null>(null);
  let leaving = $state(false);

  onMount(() => {
    name = readImpersonatingName();
  });

  async function back() {
    if (leaving) return;
    leaving = true;
    try {
      await stopImpersonating();
    } finally {
      leaving = false;
    }
  }
</script>

{#if name !== null}
  <div
    class="fixed inset-x-0 top-0 flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-sm font-medium text-black shadow"
    style="z-index: 300;"
    role="status"
  >
    <EyeIcon size={15} />
    <span>You are viewing as <strong>{name || 'another user'}</strong>.</span>
    <button
      type="button"
      onclick={back}
      disabled={leaving}
      class="rounded-md bg-black/85 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-60"
    >
      {leaving ? 'Returning…' : 'Return to admin'}
    </button>
  </div>
{/if}
