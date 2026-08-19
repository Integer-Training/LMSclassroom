/**
 * PearlLMS Phase-10 HP/D29 — split-env `PUBLIC_IS_SELFHOSTED` footgun guard.
 *
 * The whole closed-system posture keys off `process.env.PUBLIC_IS_SELFHOSTED === 'true'` in many places
 * (stranger-account plugins, the signup guard, org auto-provisioning, …). The failure mode is silent: if the
 * variable is UNSET or misspelled, every `=== 'true'` check evaluates to `false`, so the api quietly runs in
 * CLOUD mode — re-enabling sso()/tokenExchange() and the public sign-up surface on a deploy that is meant to be
 * a locked self-hosted instance. The api and dashboard are separate processes reading the same env, so a
 * mismatch (one set, one not) opens signup on the boundary that isn't set.
 *
 * This asserts the flag is EXPLICITLY one of `'true'` / `'false'` at boot and throws otherwise, turning a
 * silent misconfiguration into a hard, immediate startup failure. Pure + side-effect-free so it is unit-tested.
 */
export function assertSelfHostedFlag(value: string | undefined): 'true' | 'false' {
  if (value !== 'true' && value !== 'false') {
    const got = value === undefined ? 'undefined (unset)' : `"${value}"`;
    throw new Error(
      `PUBLIC_IS_SELFHOSTED must be explicitly set to "true" or "false" (got ${got}). An unset or misspelled ` +
        `value silently defaults the api to CLOUD mode, which re-enables stranger-account plugins and public ` +
        `signup on a closed self-hosted deploy. Set it identically on the api AND the dashboard.`
    );
  }
  return value;
}
