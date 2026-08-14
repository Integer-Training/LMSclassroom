import { describe, expect, it } from 'vitest';

import { RESULT_VALUES, RESULT_LABELS, PASS_RESULT, isAllowedResult } from '@cio/utils/constants';
import { ZResult } from '@cio/utils/validation/coursework';

// PearlLMS Phase 3 — the coursework RESULT vocabulary is config-driven (default Pass/Refer). The
// Drizzle column, this validator, notifications, and Phase-4 gating all read RESULT_VALUES; nothing
// hardcodes the literals. These tests lock that in.

describe('RESULT_VALUES config', () => {
  it('default set is exactly PASS + REFER, each with a label', () => {
    expect([...RESULT_VALUES]).toEqual(['PASS', 'REFER']);
    for (const v of RESULT_VALUES) {
      expect(typeof RESULT_LABELS[v]).toBe('string');
      expect(RESULT_LABELS[v].length).toBeGreaterThan(0);
    }
  });

  it('PASS_RESULT is the terminal (unit-passed) value Phase 4 reads', () => {
    expect(PASS_RESULT).toBe('PASS');
    expect(RESULT_VALUES).toContain(PASS_RESULT);
  });

  it('isAllowedResult accepts configured values, rejects everything else', () => {
    for (const v of RESULT_VALUES) expect(isAllowedResult(v)).toBe(true);
    for (const bad of ['pass', 'Refer', 'FAIL', 'DISTINCTION', '', null, undefined, 3]) {
      expect(isAllowedResult(bad)).toBe(false);
    }
  });
});

describe('ZResult validator', () => {
  it('accepts every configured result', () => {
    for (const v of RESULT_VALUES) expect(ZResult.safeParse(v).success).toBe(true);
  });

  it('rejects off-list / wrong-case / empty verdicts', () => {
    for (const bad of ['FAIL', 'pass', 'Refer', 'referred', '']) {
      expect(ZResult.safeParse(bad).success).toBe(false);
    }
  });
});
