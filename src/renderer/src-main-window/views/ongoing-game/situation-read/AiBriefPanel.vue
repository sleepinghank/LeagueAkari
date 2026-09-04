<template>
  <div class="flex shrink-0 flex-col">
    <AiBriefSection
      v-if="ongoingGameStore.allyBrief"
      :brief="ongoingGameStore.allyBrief"
      :title="t('ongoingGame.situationRead.allyBrief.title')"
      :loading-text="t('ongoingGame.situationRead.allyBrief.loading')"
      :error-text="getErrorText(ongoingGameStore.allyBrief, 'allyBrief')"
    />
    <AiBriefSection
      v-if="ongoingGameStore.enemyBrief"
      :brief="ongoingGameStore.enemyBrief"
      :title="t('ongoingGame.situationRead.enemyBrief.title')"
      :loading-text="t('ongoingGame.situationRead.enemyBrief.loading')"
      :error-text="getErrorText(ongoingGameStore.enemyBrief, 'enemyBrief')"
    />
  </div>
</template>

<script setup lang="ts">
import type { AiBriefStatus } from '@shared/shards/ongoing-game'
import { useTranslation } from 'i18next-vue'

import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import AiBriefSection from './AiBriefSection.vue'

const { t } = useTranslation()

const ongoingGameStore = useOngoingGameStore()

/** 一行含错误类型的简短文案；两份简报各自的错误互不遮蔽 */
function getErrorText(brief: AiBriefStatus | null, section: 'allyBrief' | 'enemyBrief') {
  const errorType = brief?.status === 'error' ? brief.errorType : null

  switch (errorType) {
    case 'config':
      return t(`ongoingGame.situationRead.${section}.errorConfig`)
    case 'timeout':
      return t(`ongoingGame.situationRead.${section}.errorTimeout`)
    default:
      return t(`ongoingGame.situationRead.${section}.errorNetwork`)
  }
}
</script>
