<template>
  <div
    class="flex shrink-0 items-center gap-3 border-b border-black/10 px-4 dark:border-white/10"
    :style="{ height: `${MATCHUP_REPORT_BAR_HEIGHT_PX}px` }"
  >
    <span class="shrink-0 text-sm font-bold">{{
      t('ongoingGame.situationRead.matchup.title')
    }}</span>

    <template v-if="matchupReport?.perspective === 'jungler'">
      <span class="shrink-0 text-xs font-bold text-black/55 dark:text-white/55">
        {{ t('ongoingGame.situationRead.matchup.gankTargets.title') }}
      </span>

      <NScrollbar x-scrollable class="min-w-0 flex-1">
        <div class="flex w-max items-center gap-1.5">
          <div
            v-for="target in gankTargets"
            :key="target.puuid"
            class="flex shrink-0 items-center gap-1.5 rounded bg-(--la-card-surface-90) px-2 py-1"
          >
            <span
              :class="[
                'size-2 shrink-0 rounded-full border border-white/20',
                target.teamColorClass
              ]"
            ></span>
            <span class="max-w-24 truncate text-xs" :title="target.name">{{ target.name }}</span>
            <span class="text-xs text-black/45 dark:text-white/45">{{ target.positionLabel }}</span>
            <span class="text-xs text-black/45 dark:text-white/45">{{ target.statLabel }}</span>
          </div>
        </div>
      </NScrollbar>
    </template>

    <template v-else>
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

      <div v-if="jungleThreat" class="flex shrink-0 items-center gap-1.5">
        <div class="flex shrink-0 items-center gap-1.5 rounded bg-(--la-card-surface-90) px-2 py-1">
          <span
            :class="[
              'size-2 shrink-0 rounded-full border border-white/20',
              jungleThreat.teamColorClass
            ]"
          ></span>
          <span class="max-w-24 truncate text-xs" :title="jungleThreat.name">
            {{ jungleThreat.name }}
          </span>
          <span class="text-xs text-black/45 dark:text-white/45">
            {{ t('positions.JUNGLE', { ns: 'common' }) }}
          </span>
        </div>

        <span
          v-if="jungleThreat.insufficientData"
          class="rounded bg-(--la-card-surface-90) px-2 py-1 text-xs text-black/45 dark:text-white/45"
        >
          {{ t('ongoingGame.situationRead.matchup.jungleThreat.insufficientData') }}
        </span>

        <span
          v-for="label in jungleThreat.precautionLabels"
          :key="label"
          class="rounded bg-(--la-card-surface-90) px-2 py-1 text-xs"
        >
          {{ label }}
        </span>
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
    </template>
  </div>
</template>

<script lang="ts">
export const MATCHUP_REPORT_BAR_HEIGHT_PX = 52
</script>

<script setup lang="ts">
import { getTeamIndicatorColorClass } from '@renderer-shared/components/ongoing-game-panel/utils/theme'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { useTranslation } from 'i18next-vue'
import { NScrollbar } from 'naive-ui'
import { computed } from 'vue'

const { t } = useTranslation()

const ongoingGameStore = useOngoingGameStore()

const resources = useAkariResourceProvider()

const matchupReport = computed(() => ongoingGameStore.situationRead?.matchupReport ?? null)

function getPlayerDisplayName(puuid: string) {
  const summoner = ongoingGameStore.summoner[puuid]
  return summoner?.gameName || summoner?.displayName || puuid
}

function formatRate(rate: number) {
  return `${Math.round(rate * 100)}%`
}

const opponent = computed(() => {
  const report = matchupReport.value
  if (report?.perspective !== 'laner' || !report.opponent) {
    return null
  }

  const { puuid, teamIdentifier, recentGameCount, recentWinRate } = report.opponent
  const soloTier = ongoingGameStore.rankedStats[puuid]?.queueMap?.['RANKED_SOLO_5x5']?.tier
  const isUnranked = !soloTier || soloTier === 'NA' || soloTier === 'NONE'

  return {
    name: getPlayerDisplayName(puuid),
    positionLabel: t(`positions.${report.selfPosition}`, { ns: 'common' }),
    tierLabel: isUnranked
      ? t('shortTiers.UNRANKED', { ns: 'common' })
      : t(`shortTiers.${soloTier}`, { ns: 'common' }),
    summaryLabel:
      recentGameCount === null || recentWinRate === null
        ? t('ongoingGame.situationRead.insufficientData')
        : t('ongoingGame.situationRead.matchup.summary', {
            count: recentGameCount,
            rate: formatRate(recentWinRate)
          }),
    teamColorClass: getTeamIndicatorColorClass(teamIdentifier)
  }
})

const jungleThreat = computed(() => {
  const report = matchupReport.value
  if (report?.perspective !== 'laner' || !report.jungleThreat) {
    return null
  }

  const { puuid, teamIdentifier, insufficientData, precautions } = report.jungleThreat

  return {
    name: getPlayerDisplayName(puuid),
    teamColorClass: getTeamIndicatorColorClass(teamIdentifier),
    insufficientData,
    precautionLabels: precautions.map((precaution) => {
      switch (precaution.kind) {
        case 'early-gank':
          return t('ongoingGame.situationRead.matchup.jungleThreat.precautions.earlyGank', {
            level3Rate: formatRate(precaution.level3GankRate),
            level4Rate: formatRate(precaution.level4GankRate)
          })
        case 'preferred-lane':
          return t('ongoingGame.situationRead.matchup.jungleThreat.precautions.preferredLane', {
            lane: t(`positions.${precaution.lane}`, { ns: 'common' })
          })
        case 'targets-self':
          return t('ongoingGame.situationRead.matchup.jungleThreat.precautions.targetsSelf', {
            lane: t(`positions.${precaution.lane}`, { ns: 'common' })
          })
        case 'premade-link':
          return t('ongoingGame.situationRead.matchup.jungleThreat.precautions.premadeLink')
      }
    })
  }
})

const gankTargets = computed(() => {
  const report = matchupReport.value
  if (report?.perspective !== 'jungler') {
    return []
  }

  return report.gankTargets.map((target) => ({
    puuid: target.puuid,
    name: getPlayerDisplayName(target.puuid),
    positionLabel: t(`positions.${target.position}`, { ns: 'common' }),
    statLabel:
      target.earlyGankDeaths === null
        ? t('ongoingGame.situationRead.insufficientData')
        : t('ongoingGame.situationRead.matchup.gankTargets.stat', {
            value: target.earlyGankDeaths.toFixed(1)
          }),
    teamColorClass: getTeamIndicatorColorClass(target.teamIdentifier)
  }))
})

const precautionLabels = computed(() => {
  const report = matchupReport.value
  const precautions = report?.perspective === 'laner' ? (report.opponent?.precautions ?? []) : []

  return precautions.map((precaution) => {
    switch (precaution.kind) {
      case 'champion-counter': {
        const champion = resources.champions.name(precaution.championId)
        return precaution.winRate === null
          ? t('ongoingGame.situationRead.matchup.precautions.championCounter', { champion })
          : t('ongoingGame.situationRead.matchup.precautions.championCounterWithWinRate', {
              champion,
              winRate: formatRate(precaution.winRate)
            })
      }
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
          winRate: formatRate(precaution.winRate),
          kda: precaution.kda.toFixed(1)
        })
      case 'champion-archetype':
        return t(`ongoingGame.situationRead.matchup.precautions.archetype.${precaution.archetype}`)
    }
  })
})
</script>
