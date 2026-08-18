import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface AnnouncementItem {
  id: string;
  courseId: string | null;
  scope: 'course' | 'provider-wide';
  title: string;
  body: string;
  publishedAt: string;
}

export interface AnnouncementCourse {
  courseId: string;
  title: string | null;
}

/**
 * Announcements (PearlLMS Phase 6 Step 5). Reads are server-scoped (a learner sees provider-wide + their
 * enrolled courses'); publishing is Admin/Manager only (the API enforces it). No drafts/scheduling.
 */
class AnnouncementsApi extends BaseApi {
  items = $state<AnnouncementItem[]>([]);
  courses = $state<AnnouncementCourse[]>([]);
  publishing = $state(false);

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

  async publish(input: { courseId: string | null; title: string; body: string }) {
    this.publishing = true;
    try {
      return await this.execute<typeof classroomio.announcements.$post>({
        requestFn: () => classroomio.announcements.$post({ json: input }),
        logContext: 'publishing announcement',
        onSuccess: (result) => {
          this.items = [result.data as AnnouncementItem, ...this.items];
        }
      });
    } finally {
      this.publishing = false;
    }
  }

  reset() {
    this.items = [];
    this.courses = [];
    this.publishing = false;
  }
}

export const announcementsApi = new AnnouncementsApi();
