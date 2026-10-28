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
 * the actor from the session, there is no user id anywhere in these calls. The full list loads on demand (mount +
 * popover open); the background poll only refreshes the unread count via the count-only endpoint. Mutations are
 * optimistic; the server is the source of truth on reload.
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

  /** Count-only refresh for the bell's background poll (no list). Resolves false on failure so the poll backs off. */
  async refreshUnreadCount() {
    const result = await this.execute<(typeof classroomio.notifications)['unread-count']['$get']>({
      requestFn: () => classroomio.notifications['unread-count'].$get(),
      logContext: 'loading unread count',
      onSuccess: (res) => {
        this.unreadCount = (res.data as { unreadCount: number }).unreadCount;
      }
    });

    return result !== undefined;
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
