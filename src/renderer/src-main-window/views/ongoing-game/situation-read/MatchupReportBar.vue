<template>
  <div
    class="flex shrink-0 items-center gap-3 border-b border-black/10 px-4 dark:border-white/10"
    :style="{ height: `${MATCHUP_REPORT_BAR_HEIGHT_PX}px` }"
  >
    <span class="shrink-0 text-sm font-bold">{{
      t('ongoingGame.situationRead.matchup.title')
    }}</span>

    <div
      v-if="opponent"
      class="flex shrink-0 items-center gap-1.5 rounded bg-(--la-card-surface-90) px-2 py-1"
    >
      <span
        :class="['size-2 shrink-0 rounded-full border border-white/20', opponent.teamColorClass]"
      ></span>
      <span class="max-w-24 truncate text-xs" :title="opponent.name">{{ opponent.name }}</span>
      <span class="text-xs text-black/45 dark:text-white/45">{{ opponent.positionLabel }}</span>
      <span class="text-xs text-black/45 dark:text-white/45">{{ opponent.tierLabel }}</span>
      <span class="text-xs text-black/45 dark:text-white/45">{{ opponent.summaryLabel }}</span>
    </div>

    <NScrollbar x-scrollable class="min-w-0 flex-1">
      <div class="flex w-max items-center gap-1.5">
        <span
          v-for="precaution in precautionLabels"
          :key="precaution"
          class="rounded bg-(--la-card-surface-90) px-2 py-1 text-xs"
        >
          {{ precaution }}
        </span>
      </div>
    </NScrollbar>
  </div>
</template>

<script lang="ts">
export const MATCHUP_REPORT_BAR_HEIGHT_PX = 52
</script>

<script setup lang="ts">
import { getTeamIndicatorColorClass } from '@renderer-shared/components/ongoing-game-panel/utils/theme'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { useTranslation } from 'i18next-vue'
import { NScrollbar } from 'naive-ui'
import { computed } from 'vue'

const { t } = useTranslation()

const ongoingGameStore = useOngoingGameStore()

const matchupReport = computed(() => ongoingGameStore.situationRead?.matchupReport ?? null)

const opponent = computed(() => {
  const report = matchupReport.value
  if (!report?.opponent) {
    return null
  }

  const { puuid, teamIdentifier, recentGameCount, recentWinRate } = report.opponent
  const summoner = ongoingGameStore.summoner[puuid]
  const soloTier = ongoingGameStore.rankedStats[puuid]?.queueMap?.['RANKED_SOLO_5x5']?.tier
  const isUnranked = !soloTier || soloTier === 'NA' || soloTier === 'NONE'

  return {
    name: summoner?.gameName || summoner?.displayName || puuid,
    positionLabel: t(`positions.${report.selfPosition}`, { ns: 'common' }),
    tierLabel: isUnranked
      ? t('shortTiers.UNRANKED', { ns: 'common' })
      : t(`shortTiers.${soloTier}`, { ns: 'common' }),
    summaryLabel:
      recentGameCount === null || recentWinRate === null
        ? t('ongoingGame.situationRead.insufficientData')
        : t('ongoingGame.situationRead.matchup.summary', {
            count: recentGameCount,
            rate: `${Math.round(recentWinRate * 100)}%`
          }),
    teamColorClass: getTeamIndicatorColorClass(teamIdentifier)
  }
})

const precautionLabels = computed(() => {
  const precautions = matchupReport.value?.opponent?.precautions ?? []

  return precautions.map((precaution) => {
    switch (precaution.kind) {
      case 'losing-streak':
        return t('ongoingGame.situationRead.matchup.precautions.losingStreak', {
          count: precaution.count
        })
      case 'winning-streak':
        return t('ongoingGame.situationRead.matchup.precautions.winningStreak', {
          count: precaution.count
        })
      case 'hot-streak':
        return t('ongoingGame.situationRead.matchup.precautions.hotStreak', {
          winRate: `${Math.round(precaution.winRate * 100)}%`,
          kda: precaution.kda.toFixed(1)
        })
      case 'champion-archetype':
        return t(`ongoingGame.situationRead.matchup.precautions.archetype.${precaution.archetype}`)
    }
  })
})
</script>
