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
type AssignableRequest = typeof classroomio.organization.allocations.assignable.$get;
type CreateRequest = typeof classroomio.organization.allocations.$post;

/**
 * Tutor↔learner allocation management (PearlLMS Phase 3). Every endpoint is Manager-OR-Admin
 * server-side (requireManagerOrAdmin); this client just drives the UI. Mutations re-list so the
 * table reflects the new state immediately.
 */
class AllocationApi extends BaseApiWithErrors {
  allocations = $state<Allocation[]>([]);
  tutors = $state<AssignablePerson[]>([]);
  learners = $state<AssignablePerson[]>([]);

  async list() {
    return this.execute<ListRequest>({
      requestFn: () => classroomio.organization.allocations.$get(),
      logContext: 'listing allocations',
      onSuccess: (result) => {
        this.allocations = result.data as Allocation[];
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
  }

  async loadAssignable() {
    return this.execute<AssignableRequest>({
      requestFn: () => classroomio.organization.allocations.assignable.$get(),
      logContext: 'loading assignable people',
      onSuccess: (result) => {
        this.tutors = result.data.tutors as AssignablePerson[];
        this.learners = result.data.learners as AssignablePerson[];
      },
      onError: (result) => {
        if (typeof result === 'string') snackbar.error(result);
      }
    });
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
