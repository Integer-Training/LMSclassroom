<script lang="ts">
  import { preferencesApi } from '$features/notifications/api/preferences.svelte';
  import * as Field from '@cio/ui/base/field';
  import { Switch } from '@cio/ui/base/switch';
  import MailIcon from '@lucide/svelte/icons/mail';
  import InboxIcon from '@lucide/svelte/icons/inbox';

  // PearlLMS Phase 6 Step 6 — the actor's per-category EMAIL preferences. In-app notifications ALWAYS arrive;
  // these switches only control whether the matching email is also sent. Effective values (config default
  // until saved) are resolved server-side by the SAME framework function the send path uses. Writes are
  // self-only (the server takes the actor from the session) and auto-save per toggle — no save bar.
  $effect(() => {
    if (!preferencesApi.loaded) void preferencesApi.load();
  });

  function onToggle(category: string, value: boolean) {
    void preferencesApi.setCategory(category, value);
  }
</script>

<Field.Set>
  <Field.Legend class="flex items-center gap-2">
    <MailIcon class="size-5" />
    Communication emails
  </Field.Legend>
  <Field.Description>
    Choose which of these you also get by email. Turning one off never hides it in the app.
  </Field.Description>

  <div class="ui:bg-muted/40 ui:text-muted-foreground mt-3 flex items-start gap-2 rounded-md p-3 text-sm" role="note">
    <InboxIcon class="mt-0.5 size-4 shrink-0" />
    <span>In-app notifications always arrive — these switches only control email.</span>
  </div>

  <div class="mt-4 space-y-4">
    {#each preferencesApi.items as item (item.category)}
      <Field.Field orientation="horizontal">
        <Switch
          checked={item.emailEnabled}
          disabled={preferencesApi.saving === item.category}
          onCheckedChange={(value) => onToggle(item.category, value)}
        />
        <div class="space-y-0.5">
          <Field.Label>{item.label}</Field.Label>
          {#if item.isDefault}
            <Field.Description>Using the default for this notification.</Field.Description>
          {/if}
        </div>
      </Field.Field>
    {/each}

    {#if preferencesApi.loaded && preferencesApi.items.length === 0}
      <Field.Description>No communication categories to configure.</Field.Description>
    {/if}
  </div>
</Field.Set>
