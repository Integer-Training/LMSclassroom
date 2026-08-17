import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZCourseUpdate } from '@cio/utils/validation/course';
import { GATING_EXEMPT_UNIT_TYPES, isExemptUnitType } from '@cio/utils/constants';

// PearlLMS Phase 4 Step 2 — config + authoring toggle + PDF-egress no-leak (TEST-FIRST).

describe('GATING_EXEMPT_UNIT_TYPES — config-driven exempt list', () => {
  it('iCQ exempt set is induction + id-check (from config, not literals)', () => {
    expect([...GATING_EXEMPT_UNIT_TYPES].sort()).toEqual(['id-check', 'induction']);
  });
  it('isExemptUnitType: induction/id-check true; session/portfolio-review/null false', () => {
    expect(isExemptUnitType('induction')).toBe(true);
    expect(isExemptUnitType('id-check')).toBe(true);
    expect(isExemptUnitType('session')).toBe(false);
    expect(isExemptUnitType('portfolio-review')).toBe(false);
    expect(isExemptUnitType(null)).toBe(false);
    expect(isExemptUnitType(undefined)).toBe(false);
  });
});

describe('authoring toggle — sequential_unlock is an Admin-only course field', () => {
  it('ZCourseUpdate accepts a boolean sequentialUnlock, rejects a non-boolean', () => {
    expect(ZCourseUpdate.safeParse({ sequentialUnlock: true }).success).toBe(true);
    expect(ZCourseUpdate.safeParse({ sequentialUnlock: false }).success).toBe(true);
    expect(ZCourseUpdate.safeParse({ sequentialUnlock: 'yes' }).success).toBe(false);
  });
  it('the course PUT route (which persists sequentialUnlock) is requireAdmin', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/routes/course/course.ts'), 'utf8');
    // PUT /:courseId is guarded requireAdmin (Admin-only authoring); no other role can toggle the setting.
    expect(src).toMatch(/\.put\(\s*'\/:courseId',\s*requireAdmin/);
  });
});

// The two PDF-egress endpoints render CLIENT-SUPPLIED body content (generate*Pdf(validatedData)); they do
// NOT fetch a unit's content by id server-side, so a locked unit's content cannot be obtained through them —
// the upstream content-read 403 is the actual gate. This test records that no-leak rationale (UNLOCK-MODEL §4 row 6).
describe('PDF-egress endpoints do not fetch content by id (no locked-unit leak)', () => {
  const lessonSrc = readFileSync(resolve(process.cwd(), 'src/routes/course/lesson.ts'), 'utf8');
  const courseSrc = readFileSync(resolve(process.cwd(), 'src/routes/course/course.ts'), 'utf8');

  it('lesson→PDF renders body content (generateLessonPdf(validatedData)), no getLesson fetch in the handler', () => {
    const handler = lessonSrc.slice(lessonSrc.indexOf("'/download/pdf'"), lessonSrc.indexOf("'/download/pdf'") + 500);
    expect(handler).toContain('generateLessonPdf(validatedData)');
    expect(handler).not.toMatch(/getLesson\(/);
  });
  it('course→PDF renders body content (generateCoursePdf(validatedData)), no content fetch in the handler', () => {
    const handler = courseSrc.slice(
      courseSrc.indexOf("'/:courseId/download/content'"),
      courseSrc.indexOf("'/:courseId/download/content'") + 600
    );
    expect(handler).toContain('generateCoursePdf(validatedData)');
    expect(handler).not.toMatch(/buildCourseContent|getCourse\(/);
  });
});
