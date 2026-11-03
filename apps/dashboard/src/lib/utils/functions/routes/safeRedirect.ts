/**
 * The post-login `?redirect=` target, kept on this site. Only a same-site path is honoured; anything else
 * (an absolute URL, a protocol-relative `//host`, a backslash trick, or nothing) falls back to `/`, which the
 * root load sends on to the caller's role home. Whether the caller may see the page is still decided by
 * that page's server guard; a wrong-role page bounces to `/` as well (see $lib/server/guards).
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}
