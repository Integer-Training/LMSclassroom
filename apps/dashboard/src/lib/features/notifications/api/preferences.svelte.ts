import { classroomio } from '$lib/utils/services/api';
import { BaseApi } from '$lib/utils/services/api/base.svelte';

export interface PreferenceItem {
  category: string;
  label: string;
  emailEnabled: boolean;
  isDefault: boolean;
}

/**
 * Per-user email preferences (PearlLMS Phase 6 Step 6). STRICTLY self — the server takes the actor from the
 * session; there is no user id in these calls. Effective values are resolved server-side by the SAME
 * framework function the send path uses (config default until the user saves).
 */
class PreferencesApi extends BaseApi {
  items = $state<PreferenceItem[]>([]);
  loaded = $state(false);
  saving = $state<string | null>(null);

  async load() {
    return this.execute<(typeof classroomio.notifications)['preferences']['$get']>({
      requestFn: () => classroomio.notifications.preferences.$get(),
      logContext: 'loading notification preferences',
      onSuccess: (result) => {
        this.items = result.data as PreferenceItem[];
        this.loaded = true;
      }
    });
  }

  async setCategory(category: string, emailEnabled: boolean) {
    // optimistic
    const item = this.items.find((i) => i.category === category);
    const previous = item ? { emailEnabled: item.emailEnabled, isDefault: item.isDefault } : null;
    if (item) {
      item.emailEnabled = emailEnabled;
      item.isDefault = false;
    }
    this.saving = category;
    try {
      const res = await this.execute<(typeof classroomio.notifications.preferences)[':category']['$put']>({
        requestFn: () =>
          classroomio.notifications.preferences[':category'].$put({ param: { category }, json: { emailEnabled } }),
        logContext: 'saving notification preference'
      });
      if (!res && item && previous) {
        // revert on failure
        item.emailEnabled = previous.emailEnabled;
        item.isDefault = previous.isDefault;
      }
      return res;
    } finally {
      this.saving = null;
    }
  }

  reset() {
    this.items = [];
    this.loaded = false;
    this.saving = null;
  }
}

export const preferencesApi = new PreferencesApi();
