import { describe, expect, it } from 'vitest';
import { buildMailto, cleanSubject, isMailableAddress } from './mailto';

describe('isMailableAddress', () => {
  it('accepts normal addresses', () => {
    expect(isMailableAddress('jo.bloggs+work@example.co.uk')).toBe(true);
    expect(isMailableAddress("o'neil@example.com")).toBe(true);
  });
  it.each([
    '',
    null,
    undefined,
    'no-at-sign',
    'a@b',
    'a b@example.com',
    'a@example.com\r\nBcc: x@y.com',
    'a@example.com\nbcc:x@y.com',
    'a@example.com?cc=x@y.com',
    'a@example.com&bcc=x@y.com',
    'a@example.com,b@example.com',
    'a@example.com;b@example.com',
    '<a@example.com>',
    'a@exa mple.com',
    'a@@example.com'
  ])('rejects %j', (v) => {
    expect(isMailableAddress(v as string)).toBe(false);
  });
});

describe('buildMailto', () => {
  it('returns null for an invalid address', () => {
    expect(buildMailto('a@example.com,b@example.com', 'Hi')).toBeNull();
    expect(buildMailto(null, 'Hi')).toBeNull();
  });
  it('keeps @ literal and encodes the subject', () => {
    expect(buildMailto('jo@example.com', 'Unit 1 — Jo & co')).toBe(
      'mailto:jo@example.com?subject=Unit%201%20%E2%80%94%20Jo%20%26%20co'
    );
  });
  it('encodes special characters in the local part', () => {
    expect(buildMailto('a+b@example.com', 'x')).toBe('mailto:a%2Bb@example.com?subject=x');
  });
  it('never emits cc, bcc or body', () => {
    const url = buildMailto('jo@example.com', 'x&cc=evil@x.com\r\nBcc: e@x.com') as string;
    expect(url).not.toMatch(/[?&](cc|bcc|body)=/i);
    expect(url.match(/\?/g)).toHaveLength(1);
    expect(url).not.toMatch(/[\r\n]/);
  });
  it('omits the subject when empty', () => {
    expect(buildMailto('jo@example.com', '  ')).toBe('mailto:jo@example.com');
  });
  it('caps the subject at 150 chars', () => {
    expect(cleanSubject('x'.repeat(400)).length).toBeLessThanOrEqual(150);
  });
});
