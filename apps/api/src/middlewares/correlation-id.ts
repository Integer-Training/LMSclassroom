import type { MiddlewareHandler } from 'hono';

/**
 * PearlLMS Phase-10 HP/SA-5 — request correlation id for sanitised error hygiene.
 *
 * Every request gets a correlation id (a fresh UUID, or an inbound `x-correlation-id` if it already looks like a
 * safe token — so the dashboard proxy can thread one through). It is:
 *   - stashed on the context (`c.get('correlationId')`) for the error handlers to include in the response body,
 *   - echoed back in the `x-correlation-id` response header,
 * and the error handlers log it alongside the (server-side only) error detail. A user who sees "something went
 * wrong (ref: <id>)" gives support that id; support greps the logs for it — WITHOUT any stack, path, or query
 * ever reaching the client.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

const SAFE_INBOUND_ID = /^[A-Za-z0-9._-]{8,128}$/;

export const correlationId = (): MiddlewareHandler => async (c, next) => {
  const inbound = c.req.header(CORRELATION_ID_HEADER);
  const id = inbound && SAFE_INBOUND_ID.test(inbound) ? inbound : crypto.randomUUID();

  c.set('correlationId', id);
  c.header(CORRELATION_ID_HEADER, id);

  await next();
};
