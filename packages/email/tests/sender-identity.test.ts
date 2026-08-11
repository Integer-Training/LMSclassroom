import { afterEach, describe, expect, it, vi } from 'vitest';

// Sender identity must be fully env-driven (Step 7): SMTP_SENDER -> From,
// SMTP_REPLY_TO -> Reply-To. constants.ts reads env at module load, so each case
// sets env then re-imports the module with a fresh registry.
async function loadConstants(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { SMTP_SENDER: process.env.SMTP_SENDER, SMTP_REPLY_TO: process.env.SMTP_REPLY_TO };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('../src/utils/constants');
  // restore
  process.env.SMTP_SENDER = prev.SMTP_SENDER;
  process.env.SMTP_REPLY_TO = prev.SMTP_REPLY_TO;
  return mod;
}

describe('email sender identity is env-driven', () => {
  afterEach(() => vi.resetModules());

  it('uses SMTP_SENDER / SMTP_REPLY_TO when set', async () => {
    const { EMAIL_FROM, EMAIL_REPLY_TO } = await loadConstants({
      SMTP_SENDER: '"Pearl LMS" <noreply@pearl.example>',
      SMTP_REPLY_TO: '"Pearl LMS Support" <support@pearl.example>'
    });
    expect(EMAIL_FROM).toBe('"Pearl LMS" <noreply@pearl.example>');
    expect(EMAIL_REPLY_TO).toBe('"Pearl LMS Support" <support@pearl.example>');
  });

  it('falls back to defaults only when env is unset', async () => {
    const { EMAIL_FROM, EMAIL_REPLY_TO } = await loadConstants({
      SMTP_SENDER: undefined,
      SMTP_REPLY_TO: undefined
    });
    // Defaults exist (branding, see docs/TODO-BRANDING.md) but must be overridable.
    expect(EMAIL_FROM).toContain('<');
    expect(EMAIL_REPLY_TO).toContain('<');
  });
});
