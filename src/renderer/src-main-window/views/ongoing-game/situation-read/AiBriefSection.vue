<template>
  <div
    class="flex shrink-0 flex-col border-b border-black/10 dark:border-white/10"
    :style="{ height: `${AI_BRIEF_SECTION_HEIGHT_PX}px` }"
  >
    <div class="flex shrink-0 items-center px-4 pt-2">
      <span class="text-sm font-bold">{{ title }}</span>
    </div>

    <div v-if="brief.status === 'loading'" class="flex min-h-0 flex-1 items-center gap-2 px-4 pb-2">
      <NSpin :size="14" />
      <span class="text-xs text-black/50 dark:text-white/50">{{ loadingText }}</span>
    </div>

    <div
      v-else-if="brief.status === 'error'"
      class="flex min-h-0 flex-1 items-center px-4 pb-2"
      :title="errorText"
    >
      <span class="truncate text-xs text-black/50 dark:text-white/50">{{ errorText }}</span>
    </div>

    <NScrollbar v-else class="min-h-0 flex-1" trigger="none">
      <div class="markdown-container markdown-body" v-html="markdownHtml"></div>
    </NScrollbar>
  </div>
</template>

<script lang="ts">
import type { AiBriefStatus } from '@shared/shards/ongoing-game'

/** 单个简报分区的高度：内容超长时在内部滚动 */
export const AI_BRIEF_SECTION_HEIGHT_PX = 260
</script>

<script setup lang="ts">
import { markdownItSandboxed } from '@renderer-shared/utils/markdown'
import { NScrollbar, NSpin } from 'naive-ui'
import { computed } from 'vue'

const props = defineProps<{
  /** 分区标题（我方简报 / 敌方简报） */
  title: string
  /** 加载占位文案 */
  loadingText: string
  /** 一行含错误类型的文案 */
  errorText: string
  brief: AiBriefStatus
}>()

/** AI 输出为不可信外部内容，Markdown 渲染禁用内联 HTML */
const markdownHtml = computed(() => {
  const content = props.brief.status === 'success' ? props.brief.content : ''
  return markdownItSandboxed.render(content)
})
</script>

<style scoped>
.markdown-container {
  padding: 8px 16px 12px;
  user-select: text;
}
</style>
