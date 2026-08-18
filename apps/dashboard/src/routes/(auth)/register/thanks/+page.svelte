<script lang="ts">
  // PearlLMS Phase 7 — stateless thanks page (docs/ONBOARDING-MODEL.md). It carries NO registration state: it
  // reads nothing, exposes nothing about the application. Just a confirmation + a route back to login.
</script>

<svelte:head>
  <title>Thanks — registration received</title>
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-10 text-center">
  <h1 class="text-2xl font-semibold">Thanks — we've got your details</h1>
  <p class="text-muted-foreground text-sm">
    Your registration has been received. Our team will review it and be in touch. You don't have an account yet — if
    your application is approved, you'll get an email with a link to set your password.
  </p>
  <div>
    <a href="/login" class="text-sm underline">Back to sign in</a>
  </div>
</div>
