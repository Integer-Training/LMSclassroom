<script lang="ts">
  import { enhance } from '$app/forms';
  import { REGISTRATION_HONEYPOT_FIELD } from '@cio/utils/constants';
  import * as Field from '@cio/ui/base/field';
  import { Input } from '@cio/ui/base/input';
  import { Button } from '@cio/ui/base/button';
  import type { ActionData, PageData } from './$types';

  // PearlLMS Phase 7 — public registration form (docs/ONBOARDING-MODEL.md §8). Minimal: name, email, course of
  // interest + a hidden honeypot. Submitting creates ONLY a pending application (never an account); success
  // lands on the stateless /register/thanks page.
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Register your interest</title>
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Register your interest</h1>
    <p class="text-muted-foreground text-sm">
      Tell us a little about you and the course you're interested in. Our team will review your application and be in
      touch — you won't get an account until we've approved it.
    </p>
  </div>

  <form
    method="POST"
    class="space-y-4"
    use:enhance={() => {
      loading = true;
      return async ({ update }) => {
        await update();
        loading = false;
      };
    }}
  >
    {#if form?.message}
      <div
        class="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        role="alert"
      >
        {form.message}
      </div>
    {/if}

    <Field.Field>
      <Field.Label for="fullName">Full name</Field.Label>
      <Input id="fullName" name="fullName" required autocomplete="name" value={form?.fullName ?? ''} />
    </Field.Field>

    <Field.Field>
      <Field.Label for="email">Email</Field.Label>
      <Input id="email" name="email" type="email" required autocomplete="email" value={form?.email ?? ''} />
    </Field.Field>

    <Field.Field>
      <Field.Label for="requestedCourseId">Course of interest</Field.Label>
      <select
        id="requestedCourseId"
        name="requestedCourseId"
        class="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <option value="">— Select a course (optional) —</option>
        {#each data.courses as course (course.courseId)}
          <option value={course.courseId}>{course.title ?? 'Untitled course'}</option>
        {/each}
      </select>
    </Field.Field>

    <!-- Honeypot: hidden from real users, tempting to bots. A filled value is silently dropped server-side. -->
    <div aria-hidden="true" style="position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden;">
      <label for={REGISTRATION_HONEYPOT_FIELD}>Company website</label>
      <input
        id={REGISTRATION_HONEYPOT_FIELD}
        name={REGISTRATION_HONEYPOT_FIELD}
        type="text"
        tabindex="-1"
        autocomplete="off"
      />
    </div>

    <Button type="submit" class="w-full" disabled={loading}>
      {loading ? 'Submitting…' : 'Submit registration'}
    </Button>
  </form>

  <p class="text-muted-foreground text-center text-sm">
    Already have an account? <a href="/login" class="underline">Sign in</a>
  </p>
</div>
