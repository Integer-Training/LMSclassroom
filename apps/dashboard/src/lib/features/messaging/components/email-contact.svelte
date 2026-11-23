<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import { CopyButton } from '@cio/ui/base/copy-button';
  import MailIcon from '@lucide/svelte/icons/mail';
  import { buildMailto, isMailableAddress } from '$lib/utils/functions/mailto';

  // An "Email" button that opens the user's own mail app with To + Subject prefilled (a mailto link never sets
  // From — Outlook sends from whichever account is signed in on that PC). Nothing is sent by the server.
  // Full mode shows the address, a copy fallback and a hint; compact mode is a single icon for table rows.
  interface Props {
    email: string | null | undefined;
    name: string;
    subject: string;
    compact?: boolean;
    /** Compact mode only: show the word "Email" next to the icon (table rows where an icon alone is missed). */
    labelled?: boolean;
  }
  let { email, name, subject, compact = false, labelled = false }: Props = $props();

  const valid = $derived(isMailableAddress(email));
  const href = $derived(buildMailto(email, subject));
  const label = $derived(`Email ${name || 'contact'}`);
</script>

{#if compact && labelled}
  {#if href}
    <Button {href} variant="outline" size="sm" aria-label={label} title={label}>
      <MailIcon class="size-4" /> Email
    </Button>
  {:else}
    <Button variant="outline" size="sm" disabled aria-label="{label} (no email address)" title="No email address">
      <MailIcon class="size-4" /> Email
    </Button>
  {/if}
{:else if compact}
  {#if href}
    <Button {href} variant="ghost" size="icon-sm" aria-label={label} title={label}>
      <MailIcon class="size-4" />
    </Button>
  {:else}
    <Button variant="ghost" size="icon-sm" disabled aria-label="{label} (no email address)" title="No email address">
      <MailIcon class="size-4" />
    </Button>
  {/if}
{:else}
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      {#if href}
        <Button {href} variant="outline" size="sm" aria-label={label}>
          <MailIcon class="size-4" /> Email
        </Button>
      {:else}
        <Button variant="outline" size="sm" disabled aria-label="{label} (no email address)">
          <MailIcon class="size-4" /> Email
        </Button>
      {/if}
      {#if valid && email}
        <span class="text-muted-foreground min-w-0 text-sm break-all">{email}</span>
        <CopyButton
          text={email}
          size="icon-sm"
          tabindex={0}
          aria-label="Copy email address"
          title="Copy email address"
        />
      {:else}
        <span class="text-muted-foreground text-sm">No email address on file</span>
      {/if}
    </div>
    {#if valid}
      <p class="text-muted-foreground text-xs">Opens your mail app. Sent from your own email account.</p>
    {/if}
  </div>
{/if}
