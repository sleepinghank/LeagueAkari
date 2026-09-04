<template>
  <div
    class="flex shrink-0 flex-col border-b border-black/10 dark:border-white/10"
    :style="{ height: `${ALLY_BRIEF_PANEL_HEIGHT_PX}px` }"
  >
    <div class="flex shrink-0 items-center px-4 pt-2">
      <span class="text-sm font-bold">{{ t('ongoingGame.situationRead.allyBrief.title') }}</span>
    </div>

    <div
      v-if="brief?.status === 'loading'"
      class="flex min-h-0 flex-1 items-center gap-2 px-4 pb-2"
    >
      <NSpin :size="14" />
      <span class="text-xs text-black/50 dark:text-white/50">
        {{ t('ongoingGame.situationRead.allyBrief.loading') }}
      </span>
    </div>

    <div
      v-else-if="brief?.status === 'error'"
      class="flex min-h-0 flex-1 items-center px-4 pb-2"
      :title="errorText"
    >
      <span class="truncate text-xs text-black/50 dark:text-white/50">{{ errorText }}</span>
    </div>

    <NScrollbar v-else-if="brief" class="min-h-0 flex-1" trigger="none">
      <div class="markdown-container markdown-body" v-html="markdownHtml"></div>
    </NScrollbar>
  </div>
</template>

<script lang="ts">
/** 面板整体高度：研判卡下方的固定预留（内容超长时在内部滚动） */
export const ALLY_BRIEF_PANEL_HEIGHT_PX = 260
</script>

<script setup lang="ts">
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { markdownItSandboxed } from '@renderer-shared/utils/markdown'
import { useTranslation } from 'i18next-vue'
import { NScrollbar, NSpin } from 'naive-ui'
import { computed } from 'vue'

const { t } = useTranslation()

const ongoingGameStore = useOngoingGameStore()

const brief = computed(() => ongoingGameStore.allyBrief)

/** AI 输出为不可信外部内容，Markdown 渲染禁用内联 HTML */
const markdownHtml = computed(() => {
  const content = brief.value?.status === 'success' ? brief.value.content : ''
  return markdownItSandboxed.render(content)
})

const errorText = computed(() => {
  const errorType = brief.value?.status === 'error' ? brief.value.errorType : null

  switch (errorType) {
    case 'config':
      return t('ongoingGame.situationRead.allyBrief.errorConfig')
    case 'timeout':
      return t('ongoingGame.situationRead.allyBrief.errorTimeout')
    default:
      return t('ongoingGame.situationRead.allyBrief.errorNetwork')
  }
})
</script>

<style scoped>
.markdown-container {
  padding: 8px 16px 12px;
  user-select: text;
}
</style>
