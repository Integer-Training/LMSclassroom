import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export type AnnouncementAudience = 'all_learners' | 'all_tutors' | 'course' | 'learner' | 'tutor';

export interface AnnouncementItem {
  id: string;
  audienceType: AnnouncementAudience;
  courseId: string | null;
  targetUserId: string | null;
  targetLabel: string | null;
  title: string;
  body: string;
  publishedAt: string;
  archived: boolean;
}

export interface AnnouncementCourse {
  courseId: string;
  title: string | null;
}

export interface AnnouncementTutor {
  id: string;
  name: string | null;
  email: string | null;
}

export interface AnnouncementLearner {
  id: string;
  name: string;
  email: string;
}

export interface PublishBroadcastInput {
  audienceType: AnnouncementAudience;
  courseId: string | null;
  targetUserId: string | null;
  title: string;
  body: string;
}

/**
 * Broadcasts (PearlLMS). Reads are server-scoped (admin → all org [manage]; tutor → tutor-addressed; learner →
 * all_learners + enrolled + directly-targeted + their tutor's group). Compose + manage is Admin-only (the API
 * enforces it). No drafts/scheduling.
 */
class AnnouncementsApi extends BaseApi {
  items = $state<AnnouncementItem[]>([]);
  courses = $state<AnnouncementCourse[]>([]);
  tutors = $state<AnnouncementTutor[]>([]);
  learners = $state<AnnouncementLearner[]>([]);
  publishing = $state(false);
  busyId = $state<string | null>(null);

  async loadFeed() {
    return this.execute<typeof classroomio.announcements.$get>({
      requestFn: () => classroomio.announcements.$get(),
      logContext: 'loading announcements',
      onSuccess: (result) => {
        this.items = result.data as AnnouncementItem[];
      }
    });
  }

  async loadCourse(courseId: string) {
    return this.execute<(typeof classroomio.announcements.course)[':courseId']['$get']>({
      requestFn: () => classroomio.announcements.course[':courseId'].$get({ param: { courseId } }),
      logContext: 'loading course announcements',
      onSuccess: (result) => {
        this.items = result.data as AnnouncementItem[];
      }
    });
  }

  async loadCourses() {
    return this.execute<typeof classroomio.announcements.courses.$get>({
      requestFn: () => classroomio.announcements.courses.$get(),
      logContext: 'loading courses',
      onSuccess: (result) => {
        this.courses = result.data as AnnouncementCourse[];
      }
    });
  }

  async loadTutors() {
    return this.execute<typeof classroomio.announcements.tutors.$get>({
      requestFn: () => classroomio.announcements.tutors.$get(),
      logContext: 'loading tutors',
      onSuccess: (result) => {
        this.tutors = result.data as AnnouncementTutor[];
      }
    });
  }

  async searchLearners(search: string) {
    return this.execute<typeof classroomio.announcements.learners.$get>({
      requestFn: () => classroomio.announcements.learners.$get({ query: { search } }),
      logContext: 'searching learners',
      onSuccess: (result) => {
        this.learners = result.data as AnnouncementLearner[];
      }
    });
  }

  async publish(input: PublishBroadcastInput) {
    this.publishing = true;
    try {
      return await this.execute<typeof classroomio.announcements.$post>({
        requestFn: () => classroomio.announcements.$post({ json: input }),
        logContext: 'publishing broadcast',
        onSuccess: (result) => {
          this.items = [result.data as AnnouncementItem, ...this.items];
        }
      });
    } finally {
      this.publishing = false;
    }
  }

  async setArchived(id: string, archived: boolean) {
    this.busyId = id;
    try {
      return await this.execute<(typeof classroomio.announcements)[':id']['archive']['$post']>({
        requestFn: () => classroomio.announcements[':id'].archive.$post({ param: { id }, json: { archived } }),
        logContext: 'archiving broadcast',
        onSuccess: (result) => {
          const updated = result.data as AnnouncementItem;
          this.items = this.items.map((a) => (a.id === updated.id ? updated : a));
        }
      });
    } finally {
      this.busyId = null;
    }
  }

  async remove(id: string) {
    this.busyId = id;
    try {
      return await this.execute<(typeof classroomio.announcements)[':id']['$delete']>({
        requestFn: () => classroomio.announcements[':id'].$delete({ param: { id } }),
        logContext: 'deleting broadcast',
        onSuccess: () => {
          this.items = this.items.filter((a) => a.id !== id);
        }
      });
    } finally {
      this.busyId = null;
    }
  }

  reset() {
    this.items = [];
    this.courses = [];
    this.tutors = [];
    this.learners = [];
    this.publishing = false;
    this.busyId = null;
  }
}

export const announcementsApi = new AnnouncementsApi();
