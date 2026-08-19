import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

export interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  requestedCourseId: string | null;
  requestedCourseTitle: string | null;
  status: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ApprovalCourse {
  courseId: string;
  title: string | null;
}

/**
 * PearlLMS Phase 7 Step 3 — the Manager/Admin approval queue (docs/ONBOARDING-MODEL.md §4). Reads are
 * org-scoped by the API from the session actor; approve/reject are one-way + audited server-side. Mutations
 * refetch the current filter so the queue reflects the committed state.
 */
class RegistrationsApi extends BaseApi {
  items = $state<RegistrationRow[]>([]);
  courses = $state<ApprovalCourse[]>([]);
  status = $state<'pending' | 'approved' | 'rejected' | ''>('pending');
  loaded = $state(false);
  deciding = $state<string | null>(null);

  async load(status: 'pending' | 'approved' | 'rejected' | '' = this.status) {
    this.status = status;
    return this.execute<typeof classroomio.organization.registrations.$get>({
      requestFn: () => classroomio.organization.registrations.$get({ query: status ? { status } : {} }),
      logContext: 'loading registrations',
      onSuccess: (result) => {
        this.items = result.data as RegistrationRow[];
        this.loaded = true;
      }
    });
  }

  async loadCourses() {
    return this.execute<typeof classroomio.organization.registrations.courses.$get>({
      requestFn: () => classroomio.organization.registrations.courses.$get(),
      logContext: 'loading approval courses',
      onSuccess: (result) => {
        this.courses = result.data as ApprovalCourse[];
      }
    });
  }

  async approve(id: string, courseId: string | null) {
    this.deciding = id;
    try {
      const res = await this.execute<(typeof classroomio.organization.registrations)[':id']['approve']['$post']>({
        requestFn: () =>
          classroomio.organization.registrations[':id'].approve.$post({
            param: { id },
            json: { courseId: courseId ?? undefined }
          }),
        logContext: 'approving registration'
      });
      if (res) {
        snackbar.success('Application approved — the learner has been invited to set their password.');
        await this.load();
      } else if (this.error) {
        snackbar.error(this.friendlyError());
      }
      return res;
    } finally {
      this.deciding = null;
    }
  }

  async reject(id: string, note: string) {
    this.deciding = id;
    try {
      const res = await this.execute<(typeof classroomio.organization.registrations)[':id']['reject']['$post']>({
        requestFn: () => classroomio.organization.registrations[':id'].reject.$post({ param: { id }, json: { note } }),
        logContext: 'rejecting registration'
      });
      if (res) {
        snackbar.success('Application rejected.');
        await this.load();
      } else if (this.error) {
        snackbar.error(this.friendlyError());
      }
      return res;
    } finally {
      this.deciding = null;
    }
  }

  private friendlyError(): string {
    try {
      const parsed = JSON.parse(this.error ?? '{}');
      return parsed?.error || parsed?.message || 'Something went wrong.';
    } catch {
      return this.error || 'Something went wrong.';
    }
  }

  reset() {
    this.items = [];
    this.courses = [];
    this.loaded = false;
  }
}

export const registrationsApi = new RegistrationsApi();
