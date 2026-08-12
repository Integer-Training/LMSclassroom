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
}

export const usersApi = new UsersApi();
