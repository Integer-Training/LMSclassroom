import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

// Lightweight org summary (role counts, course published/draft, live-online count) for the per-view header
// context bar. Admin-only (the API enforces it); on a non-admin shell the load simply fails and the header
// shows nothing.

export interface OrgSummary {
  learners: { total: number; suspended: number };
  tutors: { total: number; suspended: number };
  admins: { total: number; suspended: number };
  managers: { total: number };
  courses: { published: number; draft: number };
  online: number;
}

class OrgSummaryApi extends BaseApi {
  data = $state<OrgSummary | null>(null);

  async load() {
    return this.execute<typeof classroomio.organization.management.summary.$get>({
      requestFn: () => classroomio.organization.management.summary.$get(),
      logContext: 'loading org summary',
      onSuccess: (result) => {
        this.data = result.data as OrgSummary;
      }
    });
  }
}

export const orgSummaryApi = new OrgSummaryApi();
