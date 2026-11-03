import { describe, expect, it } from 'vitest';

// Pure content helpers live in the dashboard, which has no runnable test runner — tested from here.
import {
  resolveContinueTarget,
  withoutExercises
} from '../../../../dashboard/src/lib/features/course/utils/learner-content';

const lesson = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'LESSON', title: id, isComplete: false, isUnlocked: true, ...extra }) as never;
const exercise = (id: string) => ({ id, type: 'EXERCISE', title: id, isComplete: false, isUnlocked: true }) as never;

describe('withoutExercises', () => {
  it('drops exercises from flat items and from every section, keeping sections', () => {
    const out = withoutExercises({
      grouped: true,
      items: [lesson('l1'), exercise('e1')],
      sections: [{ id: 's1', title: 'S1', items: [exercise('e2'), lesson('l2')] }] as never
    });
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(['l1']);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].items.map((i: { id: string }) => i.id)).toEqual(['l2']);
  });
});

describe('resolveContinueTarget', () => {
  const items = [lesson('l1'), exercise('e1'), lesson('l2'), lesson('l3', { isUnlocked: false })];

  it('lands on the server current position, not unit 1', () => {
    expect(resolveContinueTarget(items, 'l2')?.id).toBe('l2');
  });

  it('falls back to the first unlocked incomplete lesson, never an exercise', () => {
    expect(resolveContinueTarget(items, null)?.id).toBe('l1');
    expect(resolveContinueTarget([exercise('e1'), lesson('l2')], undefined)?.id).toBe('l2');
  });

  it('ignores a current position that is locked or missing from the outline', () => {
    expect(resolveContinueTarget(items, 'l3')?.id).toBe('l1');
    expect(resolveContinueTarget(items, 'gone')?.id).toBe('l1');
  });

  it('returns undefined when nothing is open', () => {
    expect(resolveContinueTarget([lesson('l1', { isComplete: true })], null)).toBeUndefined();
  });
});
