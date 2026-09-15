import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

// Admin Tutor-management (PearlLMS). Org-wide tutor roster, tutor creation (reveals a temp password),
// "Send login" (regenerate + reveal), and suspend/reactivate. Admin-only (the API enforces it).

export interface TutorMgmtRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  learnerCount: number;
  courses: { courseId: string; title: string }[];
}

export interface TutorManagement {
  count: number;
  rows: TutorMgmtRow[];
}

export interface CreateTutorInput {
  firstName: string;
  lastName: string;
  email: string;
}

export interface RevealedCredentials {
  name: string;
  password: string;
}

class TutorManagementApi extends BaseApi {
  data = $state<TutorManagement | null>(null);
  busyMemberId = $state<number | null>(null);
  revealed = $state<RevealedCredentials | null>(null);
  creating = $state(false);

  async load() {
    return this.execute<typeof classroomio.organization.management.tutors.$get>({
      requestFn: () => classroomio.organization.management.tutors.$get(),
      logContext: 'loading tutors',
      onSuccess: (result) => {
        this.data = result.data as TutorManagement;
      }
    });
  }

  async createTutor(input: CreateTutorInput) {
    this.creating = true;
    try {
      return await this.execute<typeof classroomio.organization.management.tutors.$post>({
        requestFn: () => classroomio.organization.management.tutors.$post({ json: input }),
        logContext: 'creating tutor',
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
    const rowName = this.data?.rows.find((r) => r.memberId === memberId)?.name ?? 'Tutor';
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
        logContext: 'changing tutor status',
        onSuccess: () => {
          snackbar.success(status === 'DEACTIVATED' ? 'Tutor suspended' : 'Tutor reactivated');
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

export const tutorManagementApi = new TutorManagementApi();
