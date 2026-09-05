<template>
  <div class="flex h-full flex-col">
    <ConnectedMatchPreviewer
      v-model:show="showPreviewModal"
      :game-id="previewingGame.gameId"
      :source="previewingGame.source"
      :puuid="previewingGame.puuid"
      :summary="previewingGame.summary"
      :details="previewingGame.details"
      :hide-privacy="as.settings.streamerMode"
      can-dry-run-ongoing-game
      @navigate-to-summoner-by-puuid="navigateToTabByPuuid"
      @dry-run-ongoing-game="handleDryRunOngoingGame"
    />
    <SituationReadCard v-if="hasSituationRead" @navigate="navigateToTabByPuuid" />
    <AiBriefPanel v-if="hasAiBriefPanel" />
    <MatchupReportBar v-if="hasMatchupReport" />
    <OngoingGameProvider :value="ongoingGame">
      <OngoingGamePanel
        :content-width="contentWidth"
        :content-height="panelContentHeight"
        @navigate-to-summoner-by-puuid="navigateToTabByPuuid"
        @preview-game="handlePreviewGame"
      />
    </OngoingGameProvider>
  </div>
</template>

<script lang="ts" setup>
import ConnectedMatchPreviewer from '@renderer-shared/components/match-preview/ConnectedMatchPreviewer.vue'
import OngoingGamePanel from '@renderer-shared/components/ongoing-game-panel/OngoingGamePanel.vue'
import {
  createAkariOngoingGameProvider,
  OngoingGameProvider
} from '@renderer-shared/providers/ongoing-game'
import {
  type MatchPreviewPayload,
  type MatchPreviewState,
  toMatchPreviewState
} from '@renderer-shared/components/match-preview'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { OngoingGameRenderer } from '@renderer-shared/shards/ongoing-game'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { DraftOptions } from '@shared/shards/ongoing-game'
import { computed, ref, shallowRef } from 'vue'

import { useMainWindowAppContext } from '@main-window/context'
import { PlayerTabsRenderer } from '@main-window/shards/player-tabs'
import AiBriefPanel from './situation-read/AiBriefPanel.vue'
import { AI_BRIEF_SECTION_HEIGHT_PX } from './situation-read/AiBriefSection.vue'
import MatchupReportBar, {
  MATCHUP_REPORT_BAR_HEIGHT_PX
} from './situation-read/MatchupReportBar.vue'
import SituationReadCard, {
  SITUATION_READ_CARD_HEIGHT_PX,
  SITUATION_READ_RANKING_ROW_HEIGHT_PX
} from './situation-read/SituationReadCard.vue'

const { contentWidth, contentHeight } = useMainWindowAppContext()

const ongoingGameStore = useOngoingGameStore()

const pt = useInstance(PlayerTabsRenderer)
const og = useInstance(OngoingGameRenderer)
const ongoingGame = createAkariOngoingGameProvider()

const as = useAppCommonStore()

const { navigateToTabByPuuid } = pt.useNavigateToTab()

const showPreviewModal = ref(false)
const previewingGame = shallowRef<MatchPreviewState>({
  gameId: 0,
  source: 'sgp'
})

const handlePreviewGame = (payload: MatchPreviewPayload) => {
  previewingGame.value = toMatchPreviewState(payload, as.settings.preferredLolSource)
  showPreviewModal.value = true
}

const handleDryRunOngoingGame = async (draft: DraftOptions) => {
  await og.setDraft(draft)
  showPreviewModal.value = false
}

const hasSituationRead = computed(() => {
  return (ongoingGameStore.situationRead?.threatRankings?.length ?? 0) > 0
})

/**
 * 简报面板仅在自己参与的对局阶段（选人 / 游戏中）且已配置 API Key、任一份状态存在时出现；
 * 大厅、排队、观战等非对局阶段不显示，未配置 Key 时完全不出现。
 * 观战时 gameflow phase 与真实对局一致，需以 champSelect 会话的 isSpectating 排除。
 * 面板内部上下分区：上=我方简报，下=敌方简报；敌方未生成时不渲染其分区。
 */
const isInMatchPhase = computed(() => {
  if (ongoingGame.isSpectating) {
    return false
  }

  const phase = ongoingGameStore.queryStage.phase
  return phase === 'champ-select' || phase === 'in-game'
})

const isAiBriefConfigured = computed(() => {
  return ongoingGameStore.settings.aiSituationBriefApiKey.trim() !== ''
})

const hasAiBriefPanel = computed(() => {
  return (
    isInMatchPhase.value &&
    isAiBriefConfigured.value &&
    (ongoingGameStore.allyBrief != null || ongoingGameStore.enemyBrief != null)
  )
})

const hasMatchupReport = computed(() => {
  return ongoingGameStore.situationRead?.matchupReport != null
})

const panelContentHeight = computed(() => {
  let reservedHeight = 0
  if (hasSituationRead.value) {
    const hasHighlightCards = Boolean(
      ongoingGameStore.situationRead?.topThreat || ongoingGameStore.situationRead?.keyCarry
    )
    reservedHeight += hasHighlightCards
      ? SITUATION_READ_CARD_HEIGHT_PX
      : SITUATION_READ_RANKING_ROW_HEIGHT_PX
  }
  if (isInMatchPhase.value && isAiBriefConfigured.value) {
    if (ongoingGameStore.allyBrief != null) {
      reservedHeight += AI_BRIEF_SECTION_HEIGHT_PX
    }
    if (ongoingGameStore.enemyBrief != null) {
      reservedHeight += AI_BRIEF_SECTION_HEIGHT_PX
    }
  }
  if (hasMatchupReport.value) {
    reservedHeight += MATCHUP_REPORT_BAR_HEIGHT_PX
  }

  return Math.max(0, contentHeight.value - reservedHeight)
})
</script>
