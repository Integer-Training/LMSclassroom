<script lang="ts">
  import { AIGeneratePopover } from '@cio/ui/custom/ai-generate-popover';
  import { textGenerationApi } from '../api/text-generation.svelte';
  import { AI_ENABLED } from '$lib/utils/constants/features';

  interface Props {
    onInsert: (text: string) => void;
    context?: string;
    format?: 'plain' | 'html';
    courseId?: string;
    align?: 'start' | 'center' | 'end';
  }

  let { onInsert, context, format = 'plain', courseId, align = 'right' }: Props = $props();
</script>

{#if AI_ENABLED}
  <AIGeneratePopover
    {align}
    onGenerate={async (prompt, tone) => {
      const text = await textGenerationApi.generate(prompt, tone, format, context, courseId);
      if (text) onInsert(text);
    }}
  />
{/if}
