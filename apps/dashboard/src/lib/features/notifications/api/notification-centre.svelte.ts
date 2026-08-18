import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface NotificationItem {
  id: string;
  type: string;
  subject: string;
  link: string;
  createdAt: string;
  read: boolean;
}

/**
 * The current user's in-app notification centre (PearlLMS Phase 6 Step 3). STRICTLY self — the server takes
 * the actor from the session, there is no user id anywhere in these calls. Loads on demand + a light poll for
 * the unread badge (no realtime infra). Mutations are optimistic; the server is the source of truth on reload.
 */
class NotificationCentreApi extends BaseApi {
  items = $state<NotificationItem[]>([]);
  unreadCount = $state(0);
  loaded = $state(false);

  async load() {
    return this.execute<typeof classroomio.notifications.$get>({
      requestFn: () => classroomio.notifications.$get({ query: {} }),
      logContext: 'loading notifications',
      onSuccess: (result) => {
        const data = result.data as { items: NotificationItem[]; unreadCount: number };
        this.items = data.items;
        this.unreadCount = data.unreadCount;
        this.loaded = true;
      }
    });
  }

  async markRead(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (item && !item.read) {
      item.read = true;
      this.unreadCount = Math.max(0, this.unreadCount - 1);
    }
    return this.execute<(typeof classroomio.notifications)[':id']['read']['$post']>({
      requestFn: () => classroomio.notifications[':id'].read.$post({ param: { id } }),
      logContext: 'marking notification read'
    });
  }

  async markAllRead() {
    for (const i of this.items) i.read = true;
    this.unreadCount = 0;
    return this.execute<(typeof classroomio.notifications)['read-all']['$post']>({
      requestFn: () => classroomio.notifications['read-all'].$post(),
      logContext: 'marking all notifications read'
    });
  }

  reset() {
    this.items = [];
    this.unreadCount = 0;
    this.loaded = false;
  }
}

export const notificationCentreApi = new NotificationCentreApi();
