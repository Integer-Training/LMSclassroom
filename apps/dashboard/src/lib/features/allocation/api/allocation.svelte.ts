import { classroomio } from '$lib/utils/services/api';
import { BaseApiWithErrors } from '$lib/utils/services/api/base.svelte';
import { snackbar } from '$features/ui/snackbar/store';
import { errorText } from '$lib/utils/services/api/error-message';

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

export interface TutorLearner {
  learnerId: string;
  name: string | null;
  email: string | null;
  awaitingMarking: number;
}

export interface MoveResult {
  batchId: string;
  moved: number;
  alreadyWithTarget: number;
  notAllocated: number;
  results: { learnerId: string; outcome: string }[];
}

/** Pull a readable message out of whatever execute() hands to onError (string or { error }). */
function errText(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') {
    return result.error;
  }
  return null;
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
        snackbar.error(errorText(result));
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
        snackbar.error(errorText(result));
      }
    });
  }

  /**
   * Atomically replace one tutor with another for one learner (Admin only). Returns 'ok', 'stale' (the
   * learner is no longer with that tutor — the caller should reload) or 'error' (snackbar already shown).
   */
  async switchTutor(input: {
    learnerId: string;
    fromTutorId: string;
    toTutorId: string;
    reason?: string;
  }): Promise<'ok' | 'stale' | 'error'> {
    let outcome: 'ok' | 'stale' | 'error' = 'error';
    await this.execute<typeof classroomio.organization.allocations.switch.$post>({
      requestFn: () => classroomio.organization.allocations.switch.$post({ json: input }),
      logContext: 'switching tutor',
      onSuccess: () => {
        outcome = 'ok';
        snackbar.success('Tutor switched');
        this.list();
      },
      onError: (result) => {
        const msg = errText(result);
        if (msg && msg.includes('no longer with that tutor')) {
          outcome = 'stale';
          snackbar.error("This learner's tutor has already changed — refreshing");
          this.list();
        } else if (msg) snackbar.error(msg);
      }
    });
    return outcome;
  }

  /** Move many learners (ids, or all) from one tutor to another in one all-or-nothing batch (Admin only). */
  async moveLearners(input: {
    fromTutorId: string;
    toTutorId: string;
    reason?: string;
    learnerIds?: string[];
    all?: boolean;
  }): Promise<MoveResult | undefined> {
    const res = await this.execute<typeof classroomio.organization.allocations.move.$post>({
      requestFn: () => classroomio.organization.allocations.move.$post({ json: input }),
      logContext: 'moving learners',
      onSuccess: () => this.list(),
      onError: (result) => {
        const msg = errText(result);
        if (msg) snackbar.error(msg);
      }
    });
    return res?.data as MoveResult | undefined;
  }

  /** Every learner currently allocated to a tutor, with their to-mark count (for the move dialog). */
  async tutorLearners(tutorId: string): Promise<TutorLearner[] | undefined> {
    const res = await this.execute<
      (typeof classroomio.organization.allocations.tutors)[':tutorId']['learners']['$get']
    >({
      requestFn: () => classroomio.organization.allocations.tutors[':tutorId'].learners.$get({ param: { tutorId } }),
      logContext: 'loading tutor learners',
      onError: (result) => {
        const msg = errText(result);
        if (msg) snackbar.error(msg);
      }
    });
    return res?.data as TutorLearner[] | undefined;
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
        snackbar.error(errorText(result));
      }
    });
  }
}

export const allocationApi = new AllocationApi();
