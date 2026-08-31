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
      <span
        v-if="championName"
        class="ml-auto min-w-0 truncate text-black/50 dark:text-white/50"
        :title="championName"
      >
        {{ championName }}
      </span>
    </div>

    <div class="flex items-center gap-2">
      <ChampionIcon v-if="hasChampion" class="size-5 shrink-0" round :champion-id="championId" />
      <span class="min-w-0 flex-1 truncate text-sm font-bold">{{ name }}</span>
      <span class="shrink-0 text-xl font-bold text-(--la-color-text-themed) tabular-nums">
        {{ highlight.score.toFixed(1) }}
      </span>
    </div>

    <div class="truncate text-xs text-black/50 dark:text-white/50">{{ basisText }}</div>

    <div v-if="featureTagViews.length" class="flex flex-wrap gap-1">
      <span
        v-for="tag of featureTagViews"
        :key="tag.key"
        :class="['rounded-xs px-1 py-0.5 text-[11px] leading-2.75', tag.class]"
      >
        {{ tag.text }}
      </span>
    </div>

    <div
      v-if="secondaryText"
      class="flex items-center gap-1 text-xs text-black/45 dark:text-white/45"
    >
      <ChampionIcon
        v-if="secondaryChampionId > 0"
        class="size-4 shrink-0"
        round
        :champion-id="secondaryChampionId"
      />
      <span class="truncate">{{ secondaryText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SituationFeatureTag, SituationReadHighlight } from '@shared/shards/ongoing-game'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'

import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'

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

const resources = useAkariResourceProvider()

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

const championId = computed(() => ongoingGameStore.championSelections?.[highlight.puuid] ?? 0)

const hasChampion = computed(() => championId.value > 0)

const championName = computed(() =>
  hasChampion.value ? resources.champions.name(championId.value) : null
)

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

const secondaryChampionId = computed(() => {
  const secondary = highlight.secondary
  if (!secondary) {
    return 0
  }

  return ongoingGameStore.championSelections?.[secondary.puuid] ?? 0
})

/** 标签底色沿用玩家卡标签家族的配色约定 */
const FEATURE_TAG_CLASSES = {
  'losing-streak': 'bg-[#893b3b] text-white',
  'winning-streak': 'bg-[#18571c] text-white',
  'high-win-rate': 'bg-[#7e2c85] text-white',
  'favorite-champion': 'bg-[#2451a6] text-white',
  'kda-stability-stable': 'bg-[#1a7a2a] text-white',
  'kda-stability-volatile': 'bg-[#8a4400] text-white',
  'gank-sensitive-easy': 'bg-[#8f541e] text-white',
  'gank-sensitive-very-easy': 'bg-[#a81919] text-white',
  'suspicious-flash': 'bg-[#3a1bb8] text-white',
  premade: 'bg-[#0f6f68] text-white'
} as const

function getFeatureTagView(tag: SituationFeatureTag) {
  const keyPrefix = 'ongoingGame.situationRead.featureTags'

  switch (tag.type) {
    case 'losing-streak':
      return {
        key: `${tag.type}:${tag.count}`,
        class: FEATURE_TAG_CLASSES[tag.type],
        text: t(`${keyPrefix}.losingStreak`, { count: tag.count })
      }
    case 'winning-streak':
      return {
        key: `${tag.type}:${tag.count}`,
        class: FEATURE_TAG_CLASSES[tag.type],
        text: t(`${keyPrefix}.winningStreak`, { count: tag.count })
      }
    case 'high-win-rate':
      return {
        key: tag.type,
        class: FEATURE_TAG_CLASSES[tag.type],
        text: t(`${keyPrefix}.highWinRate`)
      }
    case 'favorite-champion':
      return {
        key: `${tag.type}:${tag.championId}`,
        class: FEATURE_TAG_CLASSES[tag.type],
        text: t(`${keyPrefix}.favoriteChampion`, {
          champion: resources.champions.name(tag.championId)
        })
      }
    case 'kda-stability':
      return {
        key: `${tag.type}:${tag.stable}`,
        class: tag.stable
          ? FEATURE_TAG_CLASSES['kda-stability-stable']
          : FEATURE_TAG_CLASSES['kda-stability-volatile'],
        text: tag.stable ? t(`${keyPrefix}.kdaStable`) : t(`${keyPrefix}.kdaVolatile`)
      }
    case 'gank-sensitive':
      return {
        key: `${tag.type}:${tag.level}`,
        class:
          tag.level === 'easy'
            ? FEATURE_TAG_CLASSES['gank-sensitive-easy']
            : FEATURE_TAG_CLASSES['gank-sensitive-very-easy'],
        text:
          tag.level === 'easy'
            ? t(`${keyPrefix}.gankSensitiveEasy`)
            : t(`${keyPrefix}.gankSensitiveVeryEasy`)
      }
    case 'suspicious-flash':
      return {
        key: tag.type,
        class: FEATURE_TAG_CLASSES[tag.type],
        text: t(`${keyPrefix}.suspiciousFlash`)
      }
    case 'premade':
      return {
        key: `${tag.type}:${tag.size}`,
        class: FEATURE_TAG_CLASSES[tag.type],
        text: t(`${keyPrefix}.premade`, { count: tag.size })
      }
  }
}

const featureTagViews = computed(() => highlight.featureTags.map(getFeatureTagView))
</script>
