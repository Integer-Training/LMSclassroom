import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// PearlLMS scalability Phase D — source-level guards for the dashboard's background pings (Svelte components cannot
// be loaded in a unit test). Same approach as perf-c/dashboard-hooks-source.test.ts.

const root = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const callers = {
  heartbeat: 'apps/dashboard/src/routes/(app)/+layout.svelte',
  bell: 'apps/dashboard/src/lib/features/notifications/components/notification-bell.svelte',
  headerContext: 'apps/dashboard/src/lib/features/ui/navigation/header-context.svelte',
  adminDashboard: 'apps/dashboard/src/lib/features/admin-dashboard/pages/admin-dashboard.svelte'
};

describe('background pings use the shared visibility-aware poll', () => {
  it.each(Object.entries(callers))('%s no longer runs a raw setInterval', (_name, rel) => {
    const src = read(rel);
    expect(src).toMatch(/createVisiblePoll\(/);
    expect(src).not.toMatch(/setInterval\(/);
  });

  it('the heartbeat stays at 60s (the online window is 5 minutes)', () => {
    expect(read(callers.heartbeat)).toMatch(/intervalMs: 60_000/);
  });

  it('the bell polls only the count; the full list loads on mount and when the popover opens', () => {
    const src = read(callers.bell);
    expect(src).toMatch(/refreshUnreadCount\(\)/);
    expect(src).toMatch(/if \(open\) void notificationCentreApi\.load\(\)/);
  });

  it('the admin-only summary is polled only for an admin (no 403 loop for other roles)', () => {
    const src = read(callers.headerContext);
    expect(src).toMatch(/if \(\$isOrgAdmin !== true\) return;/);
    expect(src.indexOf('$isOrgAdmin !== true')).toBeLessThan(src.indexOf('createVisiblePoll('));
  });

  it('the admin-dashboard online poll is kept (its panel lists users)', () => {
    expect(read(callers.adminDashboard)).toMatch(/loadOnline\(\$currentOrg\.id\)/);
  });
});
