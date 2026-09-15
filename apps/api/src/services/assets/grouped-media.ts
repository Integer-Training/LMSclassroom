import type { Actor } from '@cio/db/actor';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { isRole } from '@cio/utils/auth';
import { getAssetLessonUsagesForOrg, listAllAssetsForOrg, type AssetRow } from '@cio/db/queries/assets';
import { getLessonNavInfoByIds } from '@cio/db/queries/lesson';

// Media manager grouped by Course → Unit. Assets have no course link — it's derived from asset_usages
// (lesson attachments) → lesson.courseId. Many-to-many: an asset may appear under several units, or none
// (→ Unassigned). Admin/Manager only (mirrors the media manager's own access).

export interface GroupedMediaUnit {
  lessonId: string;
  unitTitle: string;
  assetIds: string[];
}
export interface GroupedMediaCourse {
  courseId: string;
  courseTitle: string;
  units: GroupedMediaUnit[];
}
export interface GroupedMedia {
  groups: GroupedMediaCourse[];
  unassignedAssetIds: string[];
  assets: AssetRow[];
}

export async function getGroupedMedia(actor: Actor): Promise<GroupedMedia> {
  if (!actor.authenticated) throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED, 401);
  if (!isRole(actor, 'ADMIN', 'MANAGER')) throw new AppError('Admins and managers only', ErrorCodes.FORBIDDEN, 403);
  const orgId = actor.orgId;

  const [usages, assets] = await Promise.all([getAssetLessonUsagesForOrg(orgId), listAllAssetsForOrg(orgId)]);

  const lessonIds = [...new Set(usages.map((u) => u.lessonId))];
  const navInfo = await getLessonNavInfoByIds(lessonIds);
  const navByLesson = new Map(navInfo.map((n) => [n.id, n]));

  const courseMap = new Map<string, GroupedMediaCourse>();
  const usedAssetIds = new Set<string>();

  for (const u of usages) {
    const nav = navByLesson.get(u.lessonId);
    if (!nav || !nav.courseId) continue; // deleted course / unresolved lesson → the asset stays Unassigned
    usedAssetIds.add(u.assetId);

    let course = courseMap.get(nav.courseId);
    if (!course) {
      course = { courseId: nav.courseId, courseTitle: nav.courseTitle ?? 'Untitled course', units: [] };
      courseMap.set(nav.courseId, course);
    }
    let unit = course.units.find((x) => x.lessonId === u.lessonId);
    if (!unit) {
      unit = { lessonId: u.lessonId, unitTitle: nav.lessonTitle ?? 'Unit', assetIds: [] };
      course.units.push(unit);
    }
    if (!unit.assetIds.includes(u.assetId)) unit.assetIds.push(u.assetId);
  }

  const unassignedAssetIds = assets.filter((a) => !usedAssetIds.has(a.id)).map((a) => a.id);
  const groups = [...courseMap.values()].sort((a, b) => a.courseTitle.localeCompare(b.courseTitle));

  return { groups, unassignedAssetIds, assets };
}
