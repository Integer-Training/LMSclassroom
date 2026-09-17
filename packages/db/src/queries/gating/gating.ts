import * as schema from '@db/schema';

import { db, eq, type DbOrTxClient } from '@db/drizzle';
import { compareUnitDisplayOrder } from '@cio/utils/functions/reorder';

// Sequential-unlock gating data (PearlLMS Phase 4). Read-only inputs to the canonical isUnitUnlocked
// helper (apps/api guards): the per-course toggle and the course's units in sequence order with their
// types. No lock state is stored anywhere — unlock is computed live from these + the Phase-3 passed-helper.

/** The per-course sequential-unlock flag (default false = fully open). */
export async function getCourseSequentialUnlock(courseId: string): Promise<boolean> {
  const [row] = await db
    .select({ sequentialUnlock: schema.course.sequentialUnlock })
    .from(schema.course)
    .where(eq(schema.course.id, courseId))
    .limit(1);
  return row?.sequentialUnlock ?? false;
}

export interface OrderedUnit {
  lessonId: string;
  unitType: string | null;
  title: string | null;
  /** An explicitly OPTIONAL unit — non-gating + excluded from required progress (like an exempt type). */
  isOptional: boolean;
}

// The pure chain walk `findGatePredecessorIndex` lives in @cio/utils/constants (beside the exempt config)
// so both the guard (isUnitUnlocked) and the outline unlock-map compose ONE implementation — no duplicate
// chain logic, and it stays outside the DB-mockable surface.

/**
 * A course's units in **sequence order** — `course_section.order` then `lesson.order` — each with its
 * type. This is the single ordering the gating rule walks to find the nearest preceding non-exempt unit.
 * Ungrouped lessons (no section) sort after grouped ones by their own order; ties break on lesson id for
 * determinism.
 */
export async function getOrderedUnitsForCourse(courseId: string, client: DbOrTxClient = db): Promise<OrderedUnit[]> {
  const rows = await client
    .select({
      lessonId: schema.lesson.id,
      unitType: schema.lesson.unitType,
      title: schema.lesson.title,
      isOptional: schema.lesson.isOptional,
      sectionOrder: schema.courseSection.order,
      lessonOrder: schema.lesson.order,
      createdAt: schema.lesson.createdAt
    })
    .from(schema.lesson)
    .leftJoin(schema.courseSection, eq(schema.courseSection.id, schema.lesson.sectionId))
    .where(eq(schema.lesson.courseId, courseId));

  // The ONE canonical display order (section → lesson → authoring order), shared with every other surface —
  // so sequential-unlock gating walks the units in exactly the order the learner sees them.
  rows.sort(compareUnitDisplayOrder);

  return rows.map((r) => ({
    lessonId: r.lessonId,
    unitType: r.unitType ?? null,
    title: r.title ?? null,
    isOptional: r.isOptional === true
  }));
}
