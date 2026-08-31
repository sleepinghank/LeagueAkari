<template>
  <div
    class="flex w-60 shrink-0 cursor-pointer flex-col justify-center gap-0.5 rounded bg-(--la-card-surface-90) px-2.5 py-1.5 transition-[filter] hover:brightness-110"
    :title="t('ongoingGame.situationRead.openDetailHint')"
    @click="emit('navigate', highlight.puuid)"
  >
    <div class="flex items-center gap-1.5 text-xs">
      <span
        v-if="teamColorClass"
        :class="['size-2 shrink-0 rounded-full border border-white/20', teamColorClass]"
      ></span>
      <span class="shrink-0 font-bold text-black/60 dark:text-white/60">{{ label }}</span>
      <span v-if="positionLabel" class="shrink-0 text-black/50 dark:text-white/50">
        {{ positionLabel }}
      </span>
    </div>

    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-sm font-bold">{{ name }}</span>
      <span class="shrink-0 text-xl font-bold text-(--la-color-text-themed) tabular-nums">
        {{ highlight.score.toFixed(1) }}
      </span>
    </div>

    <div class="truncate text-xs text-black/50 dark:text-white/50">{{ basisText }}</div>

    <div v-if="secondaryText" class="truncate text-xs text-black/45 dark:text-white/45">
      {{ secondaryText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SituationReadHighlight } from '@shared/shards/ongoing-game'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'

const { highlight, label, secondaryLabelKey, teamColorClass } = defineProps<{
  highlight: SituationReadHighlight
  /** 卡片角色文案（敌方头号威胁 / 我方核心大腿） */
  label: string
  /** 次级行文案的完整 i18n 键（次级威胁 / 次级核心） */
  secondaryLabelKey: string
  teamColorClass?: string | null
}>()

const emit = defineEmits<{
  navigate: [puuid: string]
}>()

const { t } = useTranslation()

const ongoingGameStore = useOngoingGameStore()

const name = computed(() => {
  const summoner = ongoingGameStore.summoner[highlight.puuid]
  return summoner?.gameName || summoner?.displayName || highlight.puuid
})

const positionLabel = computed(() => {
  const position = ongoingGameStore.positionAssignments[highlight.puuid]?.position
  if (!position || position === 'NONE') {
    return null
  }

  return t(`positions.${position}`, { ns: 'common' })
})

const rankText = computed(() => {
  const solo = ongoingGameStore.rankedStats[highlight.puuid]?.queueMap?.['RANKED_SOLO_5x5']
  if (!solo?.tier || solo.tier === 'NA' || solo.tier === 'NONE') {
    return null
  }

  const division = solo.division && solo.division !== 'NA' ? ` ${solo.division}` : ''
  return `${t(`shortTiers.${solo.tier}`, { ns: 'common' })}${division}`
})

const basisText = computed(() => {
  const analysis = ongoingGameStore.analysis?.players[highlight.puuid] ?? null

  if (!analysis || analysis.count <= 0) {
    return rankText.value ?? ''
  }

  const winRate = Math.round(analysis.summary.winRate * 100)

  if (rankText.value) {
    return t('ongoingGame.situationRead.basisRecentWithRank', {
      rank: rankText.value,
      count: analysis.count,
      winRate
    })
  }

  return t('ongoingGame.situationRead.basisRecentOnly', { count: analysis.count, winRate })
})

const secondaryText = computed(() => {
  const secondary = highlight.secondary
  if (!secondary) {
    return null
  }

  const summoner = ongoingGameStore.summoner[secondary.puuid]
  const name = summoner?.gameName || summoner?.displayName || secondary.puuid

  return t(secondaryLabelKey, { name, score: secondary.score.toFixed(1) })
})
</script>
