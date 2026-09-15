import * as schema from '@db/schema';

import { and, db, desc, eq, type DbOrTxClient } from '@db/drizzle';

// Media-manager grouping (Course → Unit). Assets carry NO courseId — the link is the asset_usages join
// (targetType='lesson', targetId=lessonId), and lesson.courseId resolves the course. Many-to-many: an asset
// can be attached to several lessons, or to none (→ "Unassigned").

/** Every (assetId → lessonId) attachment for the org (targetType='lesson'). targetId is the lesson id text. */
export async function getAssetLessonUsagesForOrg(
  orgId: string,
  client: DbOrTxClient = db
): Promise<{ assetId: string; lessonId: string }[]> {
  const rows = await client
    .select({ assetId: schema.assetUsage.assetId, lessonId: schema.assetUsage.targetId })
    .from(schema.assetUsage)
    .where(and(eq(schema.assetUsage.organizationId, orgId), eq(schema.assetUsage.targetType, 'lesson')));
  return rows;
}

/** All assets in the org (capped), newest first — the grouped view needs the whole set to bucket it. */
export async function listAllAssetsForOrg(orgId: string, client: DbOrTxClient = db) {
  return client
    .select()
    .from(schema.asset)
    .where(eq(schema.asset.organizationId, orgId))
    .orderBy(desc(schema.asset.createdAt))
    .limit(2000);
}
