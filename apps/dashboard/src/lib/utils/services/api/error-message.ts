const FALLBACK = 'Something went wrong. Please try again.';

type Issue = { message?: unknown; path?: unknown };

function issuesToMessage(issues: unknown): string | undefined {
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const parts = (issues as Issue[])
    .map((issue) => {
      const message = typeof issue?.message === 'string' ? issue.message.trim() : '';
      if (!message) return '';
      // A default zod message ("Invalid input", "Too big: ...") is more useful with its field name.
      const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
      const isCustom = /[a-z]{3,} .*[a-z]{3,}/i.test(message) && !/^(Invalid|Too (big|small)|Expected)/i.test(message);
      return path && !isCustom ? `${path}: ${message}` : message;
    })
    .filter(Boolean);
  return parts.length ? Array.from(new Set(parts)).join('. ') : undefined;
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Turn whatever the API (or the network layer) handed us into ONE human-readable string, so UI callbacks
 * can always show it. Handles: plain strings (incl. JSON text), `{ error: string }`,
 * `{ error: ZodError | { issues } }` (the @hono/zod-validator 400 body), `{ issues }`, `{ message }`.
 */
export function normalizeErrorMessage(input: unknown, depth = 0): string {
  if (depth > 4 || input === null || input === undefined) return FALLBACK;

  if (typeof input === 'string') {
    const parsed = parseMaybeJson(input);
    if (typeof parsed === 'string') {
      const text = parsed.trim();
      // A proxy/web-server error page (e.g. nginx "413 Request Entity Too Large") is HTML — never show markup;
      // return the generic message so callers can fall back to a status-specific one.
      if (!text || /^<(!doctype|html|head|body|\?xml)/i.test(text) || /<\/(html|body|title)>/i.test(text))
        return FALLBACK;
      return text;
    }
    return normalizeErrorMessage(parsed, depth + 1);
  }

  if (input instanceof Error) {
    return normalizeErrorMessage(input.message, depth + 1);
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;

    const fromIssues = issuesToMessage(obj.issues);
    if (fromIssues) return fromIssues;

    // ZodError serialised by hono: message is a JSON string of the issues array.
    if (obj.name === 'ZodError' && typeof obj.message === 'string') {
      const parsed = parseMaybeJson(obj.message);
      if (Array.isArray(parsed)) {
        const m = issuesToMessage(parsed);
        if (m) return m;
      }
    }

    if (obj.error !== undefined && obj.error !== null) {
      const nested = normalizeErrorMessage(obj.error, depth + 1);
      if (nested !== FALLBACK) return nested;
    }

    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message;
  }

  return FALLBACK;
}

export const GENERIC_ERROR_MESSAGE = FALLBACK;

/**
 * The text to show for an `onError` payload from BaseApi.execute — a plain string, or an object whose `error` is
 * already a readable string (see toErrorPayload). Never returns empty, so a failed action is never silent.
 */
export function errorText(result: unknown): string {
  return typeof result === 'string' ? result.trim() || FALLBACK : normalizeErrorMessage(result);
}
