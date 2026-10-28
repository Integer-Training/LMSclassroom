import { classroomio } from '$lib/utils/services/api';
import { BaseApiWithErrors } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';

export interface Allocation {
  id: string;
  tutorId: string;
  learnerId: string;
  createdAt: string | null;
  tutorName: string | null;
  tutorEmail: string | null;
  learnerName: string | null;
  learnerEmail: string | null;
}

export interface AssignablePerson {
  userId: string;
  name: string;
  email: string;
}

type ListRequest = typeof classroomio.organization.allocations.$get;
type CreateRequest = typeof classroomio.organization.allocations.$post;

/**
 * Tutor↔learner allocation management (PearlLMS Phase 3). Every endpoint is Manager-OR-Admin
 * server-side (requireManagerOrAdmin); this client just drives the UI. Mutations re-list so the
 * table reflects the new state immediately. The allocations table is paginated server-side and the
 * tutor/learner pickers are typeahead (never a full roster).
 */
class AllocationApi extends BaseApiWithErrors {
  allocations = $state<Allocation[]>([]);
  page = $state(1);
  limit = $state(50);
  total = $state(0);
  totalPages = $state(1);
  search = $state('');

  // Latest-request guard: a slow earlier response must not overwrite a newer search/page.
  private listReqId = 0;

  async list(opts: { search?: string; page?: number } = {}) {
    if (opts.search !== undefined) this.search = opts.search.trim();
    const query: Record<string, string> = { page: String(opts.page ?? this.page), limit: String(this.limit) };
    if (this.search) query.search = this.search;
    const reqId = ++this.listReqId;

    return this.execute<ListRequest>({
      requestFn: () => classroomio.organization.allocations.$get({ query }),
      logContext: 'listing allocations',
      onSuccess: (result) => {
        if (reqId !== this.listReqId) return;
        const data = result.data;
        this.allocations = data.items as Allocation[];
        this.page = data.page;
        this.total = data.total;
        this.totalPages = data.totalPages;
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  /**
   * Typeahead search for one side of the pair (max 20 rows). `pairedWith` hides people already allocated to
   * the counterpart picked in the form. Returns [] on error (the picker just shows no matches).
   */
  async searchPeople(role: 'tutor' | 'learner', search: string, pairedWith?: string): Promise<AssignablePerson[]> {
    const query: { role: 'tutor' | 'learner'; search?: string; pairedWith?: string } = { role };
    if (search.trim()) query.search = search.trim();
    if (pairedWith) query.pairedWith = pairedWith;

    // Direct call (not execute()): typing must not flip the shared isLoading that disables the form buttons.
    try {
      const res = await classroomio.organization.allocations.assignable.$get({ query });
      const result = (await res.json()) as { success: boolean; data?: AssignablePerson[] };
      return result.success && Array.isArray(result.data) ? result.data : [];
    } catch (error) {
      console.error('Error searching assignable people:', error);
      return [];
    }
  }

  async create(input: { tutorId: string; learnerId: string }) {
    return this.execute<CreateRequest>({
      requestFn: () => classroomio.organization.allocations.$post({ json: input }),
      logContext: 'creating allocation',
      onSuccess: () => {
        snackbar.success('Allocation created');
        this.list();
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
  }

  async remove(allocationId: string) {
    return this.execute<(typeof classroomio.organization.allocations)[':allocationId']['$delete']>({
      requestFn: () => classroomio.organization.allocations[':allocationId'].$delete({ param: { allocationId } }),
      logContext: 'removing allocation',
      onSuccess: () => {
        snackbar.success('Allocation removed');
        this.list();
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
        else if ('error' in result && typeof result.error === 'string') snackbar.error(result.error);
      }
    });
  }
}

export const allocationApi = new AllocationApi();
