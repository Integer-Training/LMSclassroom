// Build a safe `mailto:` link. A link can set To and Subject only — never From (the user's mail app decides
// that), and we deliberately add no CC / BCC / body so a crafted value can't smuggle extra recipients.

const MAX_SUBJECT = 150;
const MAX_ADDRESS = 254;

// Conservative address check. Rejects whitespace, CR/LF, and the mailto delimiters `? & , ;` (plus quotes and
// angle brackets) so the address can never open a new header or a second recipient.
const ADDRESS_RE =
  /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** True when `value` is a plain single email address we are willing to put in a mailto link. */
export function isMailableAddress(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_ADDRESS && ADDRESS_RE.test(value);
}

/** Collapse control characters / runs of whitespace into single spaces and cap the length. */
export function cleanSubject(subject: string | null | undefined): string {
  // Whitespace (incl. line separators) collapses to one space; other control characters are dropped.
  const flat = Array.from(String(subject ?? ''), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_SUBJECT ? `${flat.slice(0, MAX_SUBJECT - 3).trimEnd()}...` : flat;
}

/** `mailto:<to>?subject=<subject>`, or `null` when `to` isn't a valid single address. */
export function buildMailto(to: string | null | undefined, subject?: string | null): string | null {
  if (!isMailableAddress(to)) return null;
  const [local, domain] = to.split('@');
  const address = `${encodeURIComponent(local)}@${domain}`;
  const subj = cleanSubject(subject);
  return subj ? `mailto:${address}?subject=${encodeURIComponent(subj)}` : `mailto:${address}`;
}
