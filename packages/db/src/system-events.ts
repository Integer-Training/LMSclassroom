// recordSystemEvent — the one server-side way to write a system_event_log row.
//
// Best-effort: logging must NEVER throw into a request path or block navigation, so every failure is
// swallowed (console only). PII hygiene (docs/HARDENING-PLAN.md LOG-1): the raw IP is masked here and
// message/stack are length-capped; callers pass raw values and never store a raw IP or secret themselves.

import { insertSystemEvent } from './queries/system-events/system-events';

export type SystemEventSeverity = 'info' | 'warn' | 'error';

export interface RecordSystemEventInput {
  eventType: string;
  severity: SystemEventSeverity;
  userId?: string | null;
  userEmail?: string | null;
  /** Raw client IP — masked by the writer, never stored raw. */
  ip?: string | null;
  path?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  message?: string | null;
  stack?: string | null;
  organizationId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const SYSTEM_EVENT_MESSAGE_MAX = 2000;
export const SYSTEM_EVENT_STACK_MAX = 4000;

/**
 * Mask an IP for storage. IPv4 -> last octet zeroed (203.0.113.7 -> 203.0.113.0). IPv6 -> first 3 hextets
 * then '::' (2001:db8:85a3:8d3:1319:8a2e:370:7348 -> 2001:db8:85a3::). IPv4-mapped IPv6 is treated as IPv4.
 * Returns null for empty/unparseable input (never echoes an unmasked value).
 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // x-forwarded-for style lists: take the first hop.
  let value = ip.split(',')[0].trim();
  if (!value) return null;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) value = mapped[1];

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.');
    parts[3] = '0';
    return parts.join('.');
  }

  if (value.includes(':')) {
    const bare = value.replace(/^\[|\]$/g, '').split('%')[0];
    const head: string[] = [];
    for (const hextet of bare.split(':')) {
      if (hextet === '') break; // reached '::' compression
      head.push(hextet);
      if (head.length === 3) break;
    }
    return head.length ? `${head.join(':')}::` : '::';
  }

  return null;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// Write throttling. A failing endpoint (or a client stuck in an error loop) would otherwise insert one row per
// request. Only the high-volume error families are throttled: one row per (eventType, path, status) per window,
// with the suppressed repeats counted into a follow-up summary row. Security/audit events (auth.login.failure,
// deactivated sign-in, rate-limited, ...) are NEVER sampled — every one is written.
const THROTTLED_EVENT_TYPES = new Set(['api.error', 'client.error']);
const THROTTLE_MAX_KEYS = 1000;

type ThrottleEntry = { windowEndsAt: number; suppressed: number; template: RecordSystemEventInput };
const throttleEntries = new Map<string, ThrottleEntry>();

/** Window in ms; `SYSTEM_EVENT_THROTTLE_WINDOW_MS=0` turns throttling off. Read per call so it can be tuned/tested. */
function throttleWindowMs(): number {
  const raw = process.env.SYSTEM_EVENT_THROTTLE_WINDOW_MS;
  if (raw === undefined || raw === '') return 60_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60_000;
}

/** Test seam: forget all throttle state. */
export function resetSystemEventThrottle(): void {
  throttleEntries.clear();
}

function flushThrottleEntry(key: string, entry: ThrottleEntry): void {
  if (throttleEntries.get(key) === entry) {
    throttleEntries.delete(key);
  }

  if (entry.suppressed > 0) {
    void writeSystemEvent({
      ...entry.template,
      message: `${entry.template.message ?? entry.template.eventType} (+${entry.suppressed} similar suppressed)`,
      metadata: { ...(entry.template.metadata ?? {}), suppressedCount: entry.suppressed }
    });
  }
}

/** Returns true when the event should be dropped (and counted) because an identical one was just written. */
function shouldSuppress(input: RecordSystemEventInput): boolean {
  const windowMs = throttleWindowMs();
  if (windowMs === 0 || !THROTTLED_EVENT_TYPES.has(input.eventType)) {
    return false;
  }

  const now = Date.now();
  const key = `${input.eventType}|${input.method ?? ''}|${input.path ?? ''}|${input.httpStatus ?? ''}`;
  const existing = throttleEntries.get(key);

  if (existing && now < existing.windowEndsAt) {
    existing.suppressed += 1;
    return true;
  }

  if (!existing && throttleEntries.size >= THROTTLE_MAX_KEYS) {
    for (const [k, v] of throttleEntries) {
      if (now >= v.windowEndsAt) throttleEntries.delete(k);
    }
    // Still full of live windows: write through untracked rather than grow without bound.
    if (throttleEntries.size >= THROTTLE_MAX_KEYS) return false;
  }

  const entry: ThrottleEntry = { windowEndsAt: now + windowMs, suppressed: 0, template: input };
  throttleEntries.set(key, entry);
  // Emit the count when the window closes (unref'd so it never holds the process open).
  const timer = setTimeout(() => flushThrottleEntry(key, entry), windowMs);
  timer.unref?.();

  return false;
}

export async function recordSystemEvent(input: RecordSystemEventInput): Promise<void> {
  if (shouldSuppress(input)) {
    return;
  }

  await writeSystemEvent(input);
}

async function writeSystemEvent(input: RecordSystemEventInput): Promise<void> {
  try {
    await insertSystemEvent({
      eventType: input.eventType,
      severity: input.severity,
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      ipMasked: maskIp(input.ip),
      path: input.path ?? null,
      method: input.method ?? null,
      httpStatus: input.httpStatus ?? null,
      message: truncate(input.message, SYSTEM_EVENT_MESSAGE_MAX),
      stack: truncate(input.stack, SYSTEM_EVENT_STACK_MAX),
      organizationId: input.organizationId ?? null,
      correlationId: input.correlationId ?? null,
      metadata: input.metadata ?? null
    });
  } catch (error) {
    // Never throw into a user/request path.
    try {
      console.error(`recordSystemEvent(${input.eventType}) failed:`, error);
    } catch {
      /* ignore */
    }
  }
}

export {
  getSystemEvents,
  getSystemEventTotals,
  countSystemEventsSince,
  deleteSystemEventsOlderThan
} from './queries/system-events/system-events';
export type { SystemEventRow, SystemEventFilters } from './queries/system-events/system-events';
