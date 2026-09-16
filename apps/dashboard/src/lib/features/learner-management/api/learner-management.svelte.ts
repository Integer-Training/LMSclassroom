import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

// Admin Learner-management (PearlLMS). Org-wide roster + KPIs, learner creation (reveals a temp password),
// "Send login" (regenerates + reveals a new temp password), and suspend/reactivate. All endpoints are
// Admin-only (the API enforces it). Reads mirror the announcements client — `this.execute` + a singleton.

export interface LearnerMgmtRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  activity: 'active' | 'inactive' | 'created' | 'suspended';
  tutorName: string | null;
  courses: { courseId: string; title: string }[];
  courseCount: number;
  timeSpentSeconds: number;
  lastLogin: string | null;
}

export interface LearnerManagement {
  kpis: { total: number; active: number; inactive: number; created: number; suspended: number };
  rows: LearnerMgmtRow[];
}

export interface ManagementOptions {
  courses: { courseId: string; title: string | null }[];
  tutors: { id: string; name: string | null; email: string | null }[];
}

export interface CreateLearnerInput {
  firstName: string;
  lastName: string;
  email: string;
  courseId: string;
  tutorId: string;
}

export interface RevealedCredentials {
  name: string;
  password: string;
}

class LearnerManagementApi extends BaseApi {
  data = $state<LearnerManagement | null>(null);
  options = $state<ManagementOptions>({ courses: [], tutors: [] });
  busyMemberId = $state<number | null>(null);
  revealed = $state<RevealedCredentials | null>(null);
  creating = $state(false);

  async load() {
    return this.execute<typeof classroomio.organization.management.learners.$get>({
      requestFn: () => classroomio.organization.management.learners.$get(),
      logContext: 'loading learners',
      onSuccess: (result) => {
        this.data = result.data as LearnerManagement;
      }
    });
  }

  async loadOptions() {
    return this.execute<typeof classroomio.organization.management.options.$get>({
      requestFn: () => classroomio.organization.management.options.$get(),
      logContext: 'loading options',
      onSuccess: (result) => {
        this.options = result.data as ManagementOptions;
      }
    });
  }

  async createLearner(input: CreateLearnerInput) {
    this.creating = true;
    try {
      return await this.execute<typeof classroomio.organization.management.learners.$post>({
        requestFn: () => classroomio.organization.management.learners.$post({ json: input }),
        logContext: 'creating learner',
        onSuccess: (result) => {
          const data = result.data as { userId: string; name: string; temporaryPassword: string };
          this.revealed = { name: data.name, password: data.temporaryPassword };
          this.load();
        },
        onError: (result) => {
          if (typeof result === 'string') snackbar.error(result);
          else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
        }
      });
    } finally {
      this.creating = false;
    }
  }

  async sendLogin(memberId: number) {
    this.busyMemberId = memberId;
    const rowName = this.data?.rows.find((r) => r.memberId === memberId)?.name ?? 'Learner';
    try {
      return await this.execute<
        (typeof classroomio.organization.management.members)[':memberId']['reset-password']['$post']
      >({
        requestFn: () =>
          classroomio.organization.management.members[':memberId']['reset-password'].$post({
            param: { memberId: String(memberId) }
          }),
        logContext: 'sending login',
        onSuccess: (result) => {
          const data = result.data as { userId: string; temporaryPassword: string };
          this.revealed = { name: rowName, password: data.temporaryPassword };
        },
        onError: (result) => {
          if (typeof result === 'string') snackbar.error(result);
          else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
        }
      });
    } finally {
      this.busyMemberId = null;
    }
  }

  async setStatus(memberId: number, status: 'ACTIVE' | 'DEACTIVATED') {
    this.busyMemberId = memberId;
    try {
      return await this.execute<(typeof classroomio.organization.users)[':memberId']['status']['$put']>({
        requestFn: () =>
          classroomio.organization.users[':memberId'].status.$put({
            param: { memberId: String(memberId) },
            json: { status }
          }),
        logContext: 'changing learner status',
        onSuccess: () => {
          snackbar.success(status === 'DEACTIVATED' ? 'Learner suspended' : 'Learner reactivated');
          this.load();
        },
        onError: (result) => {
          if (typeof result === 'string') snackbar.error(result);
          else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
        }
      });
    } finally {
      this.busyMemberId = null;
    }
  }

  clearRevealed() {
    this.revealed = null;
  }
}

export const learnerManagementApi = new LearnerManagementApi();
