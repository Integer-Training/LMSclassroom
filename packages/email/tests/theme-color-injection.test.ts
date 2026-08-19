import { describe, expect, it } from 'vitest';

import { getDefaultTemplate } from '../src/templates/default';

// PearlLMS Phase-10 HP/SW-17 — org-supplied themeColor is interpolated into a <style> block. A malicious value
// must be neutralised (fall back to the default), never break out of the stylesheet into markup/script.
describe('getDefaultTemplate themeColor CSS-injection guard (HP/SW-17)', () => {
  const render = (themeColor: string) =>
    getDefaultTemplate('<p>hi</p>', { themeColor, logoUrl: null, orgName: 'Org' } as never);

  it('a valid hex color is used as-is', () => {
    expect(render('#ff8800')).toContain('background: #ff8800');
  });

  it('a style-block breakout payload is rejected → falls back to the default color', () => {
    const html = render('red;}</style><script>alert(1)</script>');
    // the payload never reaches the output; the button uses the safe default, proving it was rejected
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('red;}');
    expect(html).toContain('background: #1D4EE2'); // DEFAULT_BUTTON_COLOR
  });

  it('a bare CSS keyword (no `#`/rgb) is rejected too (strict allowlist)', () => {
    expect(render('expression(alert(1))')).toContain('background: #1D4EE2');
  });
});
