<script lang="ts">
  import LockIcon from '@lucide/svelte/icons/lock';
  import { Empty } from '@cio/ui/custom/empty';
  import { ContentType } from '@cio/utils/constants/content';
  import { t } from '$lib/utils/functions/translations';
  import type { StudentContentLockReason } from '$features/ai-assistant/utils/content-ask-ai-bar';
  import {
    getStudentContentLockDescriptionKey,
    getStudentContentLockTitleKey
  } from '$features/course/utils/content-lock-utils';

  interface Props {
    reason: StudentContentLockReason;
    contentType: typeof ContentType.Lesson | typeof ContentType.Exercise;
    /** PearlLMS Phase 4 — the session that unlocks this one (from the server unlock map). Overrides the copy. */
    hint?: string | null;
  }

  let { reason, contentType, hint = null }: Props = $props();

  const titleKey = $derived(getStudentContentLockTitleKey(reason));
  const descriptionKey = $derived(getStudentContentLockDescriptionKey(reason, contentType));
  const description = $derived(hint ? `Locked — complete ${hint} first.` : $t(descriptionKey));
</script>

<Empty title={$t(titleKey)} {description} icon={LockIcon} variant="page" class="text-center" />
