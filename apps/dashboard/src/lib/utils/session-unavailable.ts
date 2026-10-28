// PearlLMS scalability Phase C3 — the response for "the session check itself failed" (API down, timeout, 5xx).
//
// Deliberately NOT a redirect: the login page calls get-session too, so bouncing a signed-in user to /login while the
// API is unavailable would loop and would look like a logout. Instead answer 503 + Retry-After with a static page
// (no scripts, no dependency on the failing API) that retries on its own and has a manual retry link.

const RETRY_AFTER_SECONDS = '3';

const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="${RETRY_AFTER_SECONDS}" />
    <title>Temporarily unavailable</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111827; background: #fff; }
      main { max-width: 480px; margin: 0 auto; padding: 4rem 1.5rem; text-align: center; }
      h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem; }
      p { color: #4b5563; line-height: 1.5; margin: 0 0 1.5rem; }
      a { display: inline-block; padding: 0.625rem 1.25rem; border-radius: 0.375rem; background: #1d4ed8; color: #fff; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>We could not check your session just now</h1>
      <p>This is a temporary problem on our side and you have not been signed out. This page will retry automatically.</p>
      <a href="">Try again</a>
    </main>
  </body>
</html>`;

export function sessionUnavailableResponse(kind: 'page' | 'api'): Response {
  const headers = new Headers({
    'Retry-After': RETRY_AFTER_SECONDS,
    'Cache-Control': 'no-store'
  });

  if (kind === 'api') {
    headers.set('Content-Type', 'application/json');

    return new Response(
      JSON.stringify({ success: false, error: 'Session service temporarily unavailable', code: 'SERVICE_UNAVAILABLE' }),
      { status: 503, headers }
    );
  }

  headers.set('Content-Type', 'text/html; charset=utf-8');

  return new Response(PAGE_HTML, { status: 503, headers });
}
