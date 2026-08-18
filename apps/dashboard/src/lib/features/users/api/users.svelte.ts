import { classroomio } from '$lib/utils/services/api';
import { BaseApiWithErrors } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

export interface OrgUser {
  memberId: number;
  userId: string | null;
  name: string;
  email: string;
  roleId: number;
  status: 'ACTIVE' | 'DEACTIVATED' | null;
  verified: boolean;
}

/** Enrolment PII — Admin-only. Loaded/saved only through the requireAdmin endpoints below. */
export interface LearnerProfile {
  dateOfBirth: string | null;
  niNumber: string | null;
  gender: string | null;
  ethnicity: string | null;
  disability: string | null;
  address: string | null;
  aebRegion: string | null;
  collegeRef: string | null;
  notes: string | null;
}

export const EMPTY_LEARNER_PROFILE: LearnerProfile = {
  dateOfBirth: null,
  niNumber: null,
  gender: null,
  ethnicity: null,
  disability: null,
  address: null,
  aebRegion: null,
  collegeRef: null,
  notes: null
};

type ListRequest = typeof classroomio.organization.users.$get;
type CreateRequest = typeof classroomio.organization.users.$post;

/**
 * Admin user-management (Phase 1 Step 7). Every endpoint is ADMIN-only server-side (requireAdmin);
 * this client just drives the UI. Mutations re-list so the table reflects the new state immediately.
 */
class UsersApi extends BaseApiWithErrors {
  users = $state<OrgUser[]>([]);
  page = $state(1);
  limit = $state(20);
  total = $state(0);
  totalPages = $state(1);
  search = $state('');

  async list(opts: { search?: string; page?: number } = {}) {
    const query: Record<string, string> = { page: String(opts.page ?? this.page), limit: String(this.limit) };
    if (opts.search?.trim()) query.search = opts.search.trim();

    return this.execute<ListRequest>({
      requestFn: () => classroomio.organization.users.$get({ query }),
      logContext: 'listing users',
      onSuccess: (result) => {
        const data = result.data;
        this.users = data.items as OrgUser[];
        this.page = data.page;
        this.total = data.total;
        this.totalPages = data.totalPages;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  async createUser(input: { name: string; email: string; roleId: number }) {
    return this.execute<CreateRequest>({
      requestFn: () => classroomio.organization.users.$post({ json: input }),
      logContext: 'creating user',
      onSuccess: () => {
        snackbar.success('User created — a set-password email was sent');
        this.list({ page: 1 });
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
  }

  // ── Lite onboarding (Phase 5 Step 5) — create learner + enrol + issue credential in one flow ──────
  onboardingCourses = $state<{ courseId: string; title: string | null }[]>([]);
  onboardResult = $state<{ userId: string; courseId: string; courseTitle: string | null; learnerName: string } | null>(
    null
  );

  async loadOnboardingCourses() {
    return this.execute<typeof classroomio.organization.users.onboard.courses.$get>({
      requestFn: () => classroomio.organization.users.onboard.courses.$get(),
      logContext: 'loading onboarding courses',
      onSuccess: (result) => {
        this.onboardingCourses = result.data as { courseId: string; title: string | null }[];
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  async onboardLearner(input: { name: string; email: string; courseId: string }) {
    this.onboardResult = null;
    const res = await this.execute<typeof classroomio.organization.users.onboard.$post>({
      requestFn: () => classroomio.organization.users.onboard.$post({ json: input }),
      logContext: 'onboarding learner',
      onSuccess: (result) => {
        this.onboardResult = result.data as UsersApi['onboardResult'];
        snackbar.success('Learner onboarded — a set-password invite was sent');
        this.list({ page: 1 });
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
    return res?.data;
  }

  async changeRole(memberId: number, roleId: number) {
    return this.execute<(typeof classroomio.organization.users)[':memberId']['role']['$put']>({
      requestFn: () =>
        classroomio.organization.users[':memberId'].role.$put({
          param: { memberId: String(memberId) },
          json: { roleId }
        }),
      logContext: 'changing user role',
      onSuccess: () => {
        snackbar.success('Role updated');
        this.list();
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
  }

  async setStatus(memberId: number, status: 'ACTIVE' | 'DEACTIVATED') {
    return this.execute<(typeof classroomio.organization.users)[':memberId']['status']['$put']>({
      requestFn: () =>
        classroomio.organization.users[':memberId'].status.$put({
          param: { memberId: String(memberId) },
          json: { status }
        }),
      logContext: 'changing user status',
      onSuccess: () => {
        snackbar.success(status === 'DEACTIVATED' ? 'User deactivated' : 'User reactivated');
        this.list();
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
  }

  // ── Enrolment PII (Admin-only) ──────────────────────────────────────────────
  async getProfile(memberId: number): Promise<LearnerProfile | undefined> {
    const res = await this.execute<(typeof classroomio.organization.users)[':memberId']['profile']['$get']>({
      requestFn: () =>
        classroomio.organization.users[':memberId'].profile.$get({ param: { memberId: String(memberId) } }),
      logContext: 'loading learner profile',
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
    return res?.data as LearnerProfile | undefined;
  }

  async saveProfile(memberId: number, profile: LearnerProfile) {
    return this.execute<(typeof classroomio.organization.users)[':memberId']['profile']['$put']>({
      requestFn: () =>
        classroomio.organization.users[':memberId'].profile.$put({
          param: { memberId: String(memberId) },
          json: profile
        }),
      logContext: 'saving learner profile',
      onSuccess: () => snackbar.success('Profile saved'),
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
  }
}

export const usersApi = new UsersApi();
