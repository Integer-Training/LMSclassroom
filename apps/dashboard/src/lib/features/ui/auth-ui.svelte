<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Avatar from '@cio/ui/base/avatar';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg } from '$lib/utils/store/org';
  import * as Card from '@cio/ui/base/card';
  import { preventDefault } from '$lib/utils/functions/svelte';
  import { DotPattern } from '@cio/ui/custom/animation/dot-pattern';
  import SourceCodeLink from '$features/ui/source-code-link.svelte';

  // Closed system: public sign-up and Google social sign-in are removed (no public account
  // creation). This card now serves the login / forgot / reset flows for provisioned users only.

  interface Props {
    isLogin?: boolean;
    showOnlyContent?: boolean;
    isLoading?: boolean;
    showLogo?: boolean;
    hideGoogleAuth?: boolean;
    redirectPathname?: string;
    handleSubmit?: () => void;
    children?: Snippet;
    getPasswordAuthAlternative?: Snippet;
  }

  let {
    isLogin = true,
    showOnlyContent = false,
    isLoading = false,
    showLogo = false,
    hideGoogleAuth = false,
    redirectPathname = '',
    handleSubmit = () => {},
    children,
    getPasswordAuthAlternative
  }: Props = $props();

  const authBackgroundUrl = $derived($currentOrg.customization.auth?.backgroundImage?.trim() ?? '');
</script>

<div class="auth-ui-background relative flex min-h-screen w-full items-center justify-center overflow-hidden p-4">
  {#if authBackgroundUrl}
    <div class="absolute inset-0 z-0">
      <img src={authBackgroundUrl} alt="" class="h-full w-full object-cover" decoding="async" />
      <div class="absolute inset-0 bg-black/45" aria-hidden="true"></div>
    </div>
  {:else}
    <DotPattern fillColor="rgb(2 51 189 / 0.25)" class="absolute inset-0 z-0 h-full w-full" />
  {/if}
  <Card.Root class="ui:w-full relative z-10 max-w-[400px] shadow-sm">
    {#if !showOnlyContent || showLogo}
      <Card.Header class="ui:flex ui:flex-col ui:items-center ui:gap-4">
        <Avatar.Root>
          <Avatar.Image
            src={$currentOrg.avatarUrl ? $currentOrg.avatarUrl : '/logo-192.png'}
            alt={$currentOrg.name ? $currentOrg.name : 'ClassroomIO'}
          />
          <Avatar.Fallback>{$currentOrg.name ? $currentOrg.name : 'ClassroomIO'}</Avatar.Fallback>
        </Avatar.Root>

        {#if !showOnlyContent}
          <a href="/">
            <Card.Title class="ui:text-2xl font-normal!">
              {isLogin ? $t('login.welcome') : $t('login.create_account')}
            </Card.Title>
          </a>
          {#if isLogin}
            <Card.Description class="ui:text-center">Sign in to continue</Card.Description>
          {/if}
        {/if}
      </Card.Header>
    {/if}

    <Card.Content>
      <form onsubmit={preventDefault(handleSubmit)}>
        {@render children?.()}
      </form>
    </Card.Content>
  </Card.Root>

  <!-- AGPL-3.0: source-code link, visible on all logged-out auth pages -->
  <div class="relative z-10 mt-4 text-center">
    <SourceCodeLink />
  </div>
</div>
