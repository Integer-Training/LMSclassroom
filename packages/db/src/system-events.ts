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

export async function recordSystemEvent(input: RecordSystemEventInput): Promise<void> {
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

export { getSystemEvents, deleteSystemEventsOlderThan } from './queries/system-events/system-events';
export type { SystemEventRow, SystemEventFilters } from './queries/system-events/system-events';
