<script lang="ts">
  // Global top loading bar. Shows an indeterminate progress line across the top of the screen
  // whenever SvelteKit is navigating between pages (e.g. opening a course/lesson while its data
  // loads). Gives every user clear feedback that a page is loading, instead of a frozen screen.
  import { navigating } from '$app/state';

  const isNavigating = $derived(Boolean(navigating.to));
</script>

{#if isNavigating}
  <div class="nav-progress" role="status" aria-live="polite" aria-label="Loading page">
    <div class="nav-progress__bar"></div>
  </div>
{/if}

<style>
  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    z-index: 2147483647; /* above modals/overlays */
    overflow: hidden;
    pointer-events: none;
    background: color-mix(in srgb, #2563eb 18%, transparent);
  }

  .nav-progress__bar {
    height: 100%;
    width: 40%;
    border-radius: 0 3px 3px 0;
    background: linear-gradient(90deg, #3b82f6, #2563eb);
    box-shadow: 0 0 8px rgba(37, 99, 235, 0.6);
    animation: nav-progress-slide 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes nav-progress-slide {
    0% {
      transform: translateX(-105%);
    }
    100% {
      transform: translateX(355%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-progress__bar {
      animation-duration: 2s;
    }
  }
</style>
