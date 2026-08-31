import type { AggregatedAnalysis } from '@shared/data-adapter/analysis/player'
import type { RankedStats } from '@shared/types/league-client/ranked'
import { describe, expect, it } from 'vitest'

import {
  type SituationReadPlayerInput,
  computeSituationRead,
  extractSoloRankedEntry
} from './situation-read'

function createAnalysis(options: {
  count: number
  winRate: number
  akariScoreTotal?: number
  akariScoreMax?: number
}): AggregatedAnalysis {
  return {
    count: options.count,
    summary: {
      avgChampionDamageRatioToTeamMax: 0,
      avgChampionDamageRatioToMax: 0,
      avgChampionDamagePercentageOfTeam: 0,
      avgChampionDamagePerMinute: 0,
      avgDamageTakenRatioToTeamMax: 0,
      avgDamageTakenRatioToMax: 0,
      avgDamageTakenPercentageOfTeam: 0,
      avgGoldRatioToTeamMax: 0,
      avgGoldRatioToMax: 0,
      avgGoldPercentageOfTeam: 0,
      avgCsRatioToTeamMax: 0,
      avgCsRatioToMax: 0,
      avgCsPercentageOfTeam: 0,
      avgCsPerMinute: 0,
      avgTowerDamageRatioToTeamMax: 0,
      avgTowerDamageRatioToMax: 0,
      avgTowerDamagePercentageOfTeam: 0,
      avgVisionScore: 0,
      avgVisionScorePercentageOfTeam: 0,
      avgDamageGoldEfficiency: 0,
      avgKillParticipation: 0,
      avgKillDamageEfficiency: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      avgKda: 0,
      kdaCv: 0,
      winRate: options.winRate,
      avgSoloKills: null,
      avgEnemyMissingPings: null,
      avgPings: null
    },
    details: null,
    akariScore: {
      kdaScore: 0,
      winRateScore: 0,
      dmgScore: 0,
      dmgTakenScore: 0,
      healingScore: 0,
      csScore: 0,
      goldScore: 0,
      participationScore: 0,
      visionScore: 0,
      total: options.akariScoreTotal ?? 0,
      maxScore: options.akariScoreMax ?? 17,
      outstanding: false,
      extraordinary: false
    },
    map: {},
    teamSide: { redSideCount: 0, blueSideCount: 0 },
    winLoss: {
      all: {
        count: options.count,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        wins: 0,
        losses: 0,
        winRate: options.winRate,
        winningStreak: 0,
        losingStreak: 0
      },
      normal: {
        count: options.count,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        wins: 0,
        losses: 0,
        winRate: options.winRate,
        winningStreak: 0,
        losingStreak: 0
      },
      cherry: {
        count: 0,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        winningStreak: 0,
        losingStreak: 0,
        top1s: 0,
        topHalfFinishes: 0,
        top1Rate: 0,
        topHalfRate: 0,
        avgSubteamPlacement: 0
      }
    },
    spells: { flashOnD: 0, flashOnF: 0 },
    positions: null,
    champions: {},
    jungle: null,
    detailsCount: 0
  }
}

function createPlayer(
  puuid: string,
  rankedSolo: { tier: string; division: string } | null,
  analysis: AggregatedAnalysis | null = null,
  teamIdentifier = 'TEAM-100'
): SituationReadPlayerInput {
  return { puuid, teamIdentifier, rankedSolo, analysis }
}

function getScore(players: SituationReadPlayerInput[], puuid: string) {
  const result = computeSituationRead({ players })
  const entry = result.threatRankings.find((entry) => entry.puuid === puuid)
  expect(entry).toBeDefined()
  return entry!.score
}

describe('extractSoloRankedEntry', () => {
  it('extracts the solo queue entry only', () => {
    const rankedStats = {
      queueMap: {
        RANKED_FLEX_SR: { tier: 'DIAMOND', division: 'I' },
        RANKED_SOLO_5x5: { tier: 'GOLD', division: 'II' }
      }
    } as RankedStats

    expect(extractSoloRankedEntry(rankedStats)).toEqual({ tier: 'GOLD', division: 'II' })
    expect(extractSoloRankedEntry(null)).toBeNull()
  })

  it('treats unranked solo tiers as no rank', () => {
    const cases: (string | null | undefined)[] = ['NA', 'NONE', '', null, undefined]
    for (const tier of cases) {
      const rankedStats = {
        queueMap: {
          RANKED_SOLO_5x5: { tier, division: 'IV' }
        }
      } as unknown as RankedStats

      expect(extractSoloRankedEntry(rankedStats)).toBeNull()
    }
  })
})

describe('computeSituationRead threat score baselines', () => {
  it.each([
    ['IRON', 'IV', 2.0],
    ['IRON', 'I', 2.6],
    ['BRONZE', 'IV', 2.8],
    ['SILVER', 'I', 4.2],
    ['GOLD', 'IV', 4.4],
    ['GOLD', 'I', 5.0],
    ['PLATINUM', 'IV', 5.0],
    ['PLATINUM', 'II', 5.4],
    ['EMERALD', 'I', 6.5],
    ['DIAMOND', 'IV', 6.5],
    ['DIAMOND', 'I', 7.5],
    ['MASTER', 'NA', 8.0],
    ['GRANDMASTER', 'NA', 8.5],
    ['CHALLENGER', 'NA', 9.5]
  ])('ranks %s %s players at baseline %s', (tier, division, expected) => {
    expect(getScore([createPlayer('p1', { tier, division })], 'p1')).toBeCloseTo(expected, 5)
  })

  it('uses the unranked baseline for players without a solo rank but with recent games', () => {
    expect(
      getScore(
        [
          createPlayer(
            'p1',
            null,
            createAnalysis({ count: 10, winRate: 0.5, akariScoreTotal: 8.5 })
          )
        ],
        'p1'
      )
    ).toBeCloseTo(4.0, 5)
  })

  it('treats super server (Canyon) ranks as the challenger band', () => {
    const result = computeSituationRead({
      players: [
        createPlayer('p1', { tier: 'GOLD', division: 'I' }),
        createPlayer('p2', null, createAnalysis({ count: 8, winRate: 0.5 }))
      ],
      isSuperServerGame: true
    })

    const gold = result.threatRankings.find((entry) => entry.puuid === 'p1')
    expect(gold!.score).toBeCloseTo(9.5, 5)
  })
})

describe('computeSituationRead performance adjustment', () => {
  // 黄金 IV 基线 4.4
  it.each([
    // 描述, 胜率, Akari 总分, 场次, 期望分
    ['clamps the upward adjustment to +1.5', 1.0, 17, 10, 4.4 + 1.5],
    ['clamps the downward adjustment to -1.5', 0.0, 0, 10, 4.4 - 1.5],
    ['applies both win rate and akari deviation', 0.7, 12.75, 10, 4.4 + 0.4 + 0.5],
    ['keeps neutral performance at the baseline', 0.5, 8.5, 10, 4.4],
    ['shrinks the adjustment for small samples', 1.0, 17, 2, 4.4 + 1.5 * (2 / 5)],
    ['shrinks the adjustment to zero without samples', 1.0, 17, 0, 4.4]
  ])('%s', (_, winRate, akariScoreTotal, count, expected) => {
    expect(
      getScore(
        [
          createPlayer(
            'p1',
            { tier: 'GOLD', division: 'IV' },
            createAnalysis({ count, winRate, akariScoreTotal })
          )
        ],
        'p1'
      )
    ).toBeCloseTo(expected, 5)
  })
})

describe('computeSituationRead insufficient data sentinel', () => {
  it('reports null score for players without a rank and without recent games', () => {
    expect(getScore([createPlayer('p1', null, null)], 'p1')).toBeNull()
  })

  it('keeps the rank-based score for players without recent games', () => {
    expect(getScore([createPlayer('p1', { tier: 'DIAMOND', division: 'II' })], 'p1')).not.toBeNull()
  })
})

describe('computeSituationRead rankings', () => {
  it('orders players by descending threat score and puts insufficient players last', () => {
    const result = computeSituationRead({
      players: [
        createPlayer('low', { tier: 'IRON', division: 'IV' }),
        createPlayer('unknown', null, null),
        createPlayer('high', { tier: 'CHALLENGER', division: 'NA' }),
        createPlayer(
          'mid',
          null,
          createAnalysis({ count: 10, winRate: 0.5, akariScoreTotal: 8.5 })
        ),
        createPlayer(
          'climber',
          { tier: 'IRON', division: 'IV' },
          createAnalysis({ count: 10, winRate: 1.0, akariScoreTotal: 17 }),
          'TEAM-200'
        )
      ]
    })

    // high: 王者 9.5；mid: 未定级基线 4.0；climber: 黑铁 IV 2.0 + 1.5；low: 黑铁 IV 2.0；unknown: 数据不足
    expect(result.threatRankings.map((entry) => entry.puuid)).toEqual([
      'high',
      'mid',
      'climber',
      'low',
      'unknown'
    ])
    expect(result.threatRankings.map((entry) => entry.teamIdentifier)).toEqual([
      'TEAM-100',
      'TEAM-100',
      'TEAM-200',
      'TEAM-100',
      'TEAM-100'
    ])
  })
})
