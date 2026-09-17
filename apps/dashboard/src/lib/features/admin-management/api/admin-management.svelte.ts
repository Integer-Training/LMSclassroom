import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

// Admin Admin-management (PearlLMS). Org-wide admin roster and "Reset Password" (regenerate + reveal a temp
// password). Admin-only (the API enforces it). The super admin (earliest admin) and the caller themselves are
// flagged and cannot be reset here — the server rejects those too.

export interface AdminMgmtRow {
  memberId: number;
  userId: string;
  name: string | null;
  email: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  lastLogin: string | null;
  isSuperAdmin: boolean;
  isSelf: boolean;
}

export interface AdminManagement {
  count: number;
  rows: AdminMgmtRow[];
  canCreateAdmins: boolean;
}

export interface RevealedCredentials {
  name: string;
  password: string;
}

export interface CreateAdminInput {
  firstName: string;
  lastName: string;
  email: string;
}

class AdminManagementApi extends BaseApi {
  data = $state<AdminManagement | null>(null);
  busyMemberId = $state<number | null>(null);
  revealed = $state<RevealedCredentials | null>(null);
  creating = $state(false);

  async load() {
    return this.execute<typeof classroomio.organization.management.admins.$get>({
      requestFn: () => classroomio.organization.management.admins.$get(),
      logContext: 'loading admins',
      onSuccess: (result) => {
        this.data = result.data as AdminManagement;
      }
    });
  }

  async createAdmin(input: CreateAdminInput) {
    this.creating = true;
    try {
      return await this.execute<typeof classroomio.organization.management.admins.$post>({
        requestFn: () => classroomio.organization.management.admins.$post({ json: input }),
        logContext: 'creating admin',
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

  async resetPassword(memberId: number) {
    this.busyMemberId = memberId;
    const rowName = this.data?.rows.find((r) => r.memberId === memberId)?.name ?? 'Admin';
    try {
      return await this.execute<
        (typeof classroomio.organization.management.members)[':memberId']['reset-password']['$post']
      >({
        requestFn: () =>
          classroomio.organization.management.members[':memberId']['reset-password'].$post({
            param: { memberId: String(memberId) }
          }),
        logContext: 'resetting admin password',
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

  clearRevealed() {
    this.revealed = null;
  }
}

export const adminManagementApi = new AdminManagementApi();
