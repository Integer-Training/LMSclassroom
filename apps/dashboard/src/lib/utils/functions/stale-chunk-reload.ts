// After a deploy the old build's code files are gone. A tab opened before the deploy still runs the old build, so
// its next navigation asks for a file that no longer exists and the error page shows ("Something unexpected
// occurred" - read by learners as a failed login). Loading the page fresh picks up the new build, so on that error we
// do one full page load of the page they were going to. A short sessionStorage marker stops a reload loop if the
// file is genuinely missing for some other reason.

const RELOAD_MARKER_KEY = 'pearl_stale_chunk_reload_at';
const RELOAD_GUARD_MS = 30_000;

/** True for the errors a browser throws when it can't load a code file of this app. */
export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    message
  );
}

/** One full page load of `targetHref` (default: this page). Returns false if we already did one moments ago. */
export function reloadForNewBuild(targetHref?: string): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_MARKER_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(RELOAD_MARKER_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode): still reload once; the browser keeps us from looping within this load.
  }

  if (targetHref && targetHref !== window.location.href) {
    window.location.assign(targetHref);
  } else {
    window.location.reload();
  }
  return true;
}

let installed = false;

/** Vite fires `vite:preloadError` when a code file fails to load; reload instead of surfacing the error. */
export function installStaleChunkReload(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
