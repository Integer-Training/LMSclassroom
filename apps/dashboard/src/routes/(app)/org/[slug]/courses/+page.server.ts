import type { GetTagGroupsSuccess } from '$features/tag/utils/types';
import { classroomio, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import type { InferResponseType } from '$lib/utils/services/api';

type GetOrganizationCoursesRequest = typeof classroomio.organization.courses.$get;
type GetOrganizationCoursesSuccess = Extract<InferResponseType<GetOrganizationCoursesRequest>, { success: true }>;

export const load = async ({ parent, locals, cookies, url }) => {
  const tagsParam = url.searchParams.get('tags');
  const { orgId } = await parent();

  if (!orgId || !locals.user?.id) {
    return {
      courses: []
    };
  }

  const normalizedTags = tagsParam
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const normalizedTagsQuery = normalizedTags && normalizedTags.length > 0 ? normalizedTags.join(',') : undefined;

  const [coursesResult, tagsResult] = await Promise.all([
    safeServerApi<GetOrganizationCoursesSuccess>(() =>
      classroomio.organization.courses.$get(
        normalizedTagsQuery
          ? {
              query: {
                tags: normalizedTagsQuery
              }
            }
          : { query: {} },
        getApiHeaders(cookies, orgId)
      )
    ),
    safeServerApi<GetTagGroupsSuccess>(() => classroomio.organization.tags.$get({}, getApiHeaders(cookies, orgId)))
  ]);

  const courses = coursesResult.ok ? coursesResult.body.data : [];
  const tagGroups = tagsResult.ok ? tagsResult.body.data : [];

  return {
    courses: courses || [],
    activeTags: normalizedTags ?? [],
    tagGroups
  };
};
