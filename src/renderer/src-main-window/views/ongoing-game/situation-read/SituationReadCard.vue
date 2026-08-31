<template>
  <div class="flex shrink-0 flex-col border-b border-black/10 dark:border-white/10">
    <div v-if="hasHighlightCards" class="flex shrink-0 items-center gap-1.5 px-4 pt-2">
      <SituationHighlightCard
        v-if="topThreat"
        :highlight="topThreat"
        :label="t('ongoingGame.situationRead.topThreatLabel')"
        secondary-label-key="ongoingGame.situationRead.secondaryThreat"
        :team-color-class="getTeamIndicatorColorClass(topThreat.teamIdentifier)"
        @navigate="(puuid) => emit('navigate', puuid)"
      />
      <SituationHighlightCard
        v-if="keyCarry"
        :highlight="keyCarry"
        :label="t('ongoingGame.situationRead.keyCarryLabel')"
        secondary-label-key="ongoingGame.situationRead.secondaryCarry"
        :team-color-class="getTeamIndicatorColorClass(keyCarry.teamIdentifier)"
        @navigate="(puuid) => emit('navigate', puuid)"
      />
    </div>

    <div
      class="flex shrink-0 items-center gap-3 px-4 pb-2"
      :style="{ height: `${SITUATION_READ_RANKING_ROW_HEIGHT_PX}px` }"
    >
      <span class="shrink-0 text-sm font-bold">{{ t('ongoingGame.situationRead.title') }}</span>

      <NScrollbar x-scrollable class="min-w-0 flex-1">
        <div class="flex w-max items-center gap-1.5">
          <div
            v-for="(entry, index) of entries"
            :key="entry.puuid"
            class="flex items-center gap-1.5 rounded bg-(--la-card-surface-90) px-2 py-1"
          >
            <span class="w-4 text-right text-xs text-black/50 dark:text-white/50">
              {{ index + 1 }}
            </span>
            <span
              v-if="entry.teamColorClass"
              :class="['size-2 shrink-0 rounded-full border border-white/20', entry.teamColorClass]"
            ></span>
            <span class="max-w-24 truncate text-xs" :title="entry.name">{{ entry.name }}</span>
            <span class="text-xs text-black/45 dark:text-white/45">{{ entry.tierLabel }}</span>
            <span
              v-if="entry.score !== null"
              class="text-sm font-bold text-(--la-color-text-themed) tabular-nums"
            >
              {{ entry.score.toFixed(1) }}
            </span>
            <span v-else class="text-xs text-black/40 dark:text-white/40">
              {{ t('ongoingGame.situationRead.insufficientData') }}
            </span>
          </div>
        </div>
      </NScrollbar>
    </div>
  </div>
</template>

<script lang="ts">
export const SITUATION_READ_RANKING_ROW_HEIGHT_PX = 52
export const SITUATION_READ_CARD_HEIGHT_PX = 192
</script>

<script setup lang="ts">
import { getTeamIndicatorColorClass } from '@renderer-shared/components/ongoing-game-panel/utils/theme'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { useTranslation } from 'i18next-vue'
import { NScrollbar } from 'naive-ui'
import { computed } from 'vue'

import SituationHighlightCard from './SituationHighlightCard.vue'

const emit = defineEmits<{
  navigate: [puuid: string]
}>()

const { t } = useTranslation()

const ongoingGameStore = useOngoingGameStore()

const topThreat = computed(() => ongoingGameStore.situationRead?.topThreat ?? null)
const keyCarry = computed(() => ongoingGameStore.situationRead?.keyCarry ?? null)

const hasHighlightCards = computed(() => Boolean(topThreat.value || keyCarry.value))

const entries = computed(() => {
  const rankings = ongoingGameStore.situationRead?.threatRankings ?? []

  return rankings.map((entry) => {
    const summoner = ongoingGameStore.summoner[entry.puuid]
    const soloTier = ongoingGameStore.rankedStats[entry.puuid]?.queueMap?.['RANKED_SOLO_5x5']?.tier
    const isUnranked = !soloTier || soloTier === 'NA' || soloTier === 'NONE'

    return {
      puuid: entry.puuid,
      score: entry.score,
      name: summoner?.gameName || summoner?.displayName || entry.puuid,
      tierLabel: isUnranked
        ? t('shortTiers.UNRANKED', { ns: 'common' })
        : t(`shortTiers.${soloTier}`, { ns: 'common' }),
      teamColorClass: getTeamIndicatorColorClass(entry.teamIdentifier)
    }
  })
})
</script>
