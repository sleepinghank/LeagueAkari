import type {
  AggregatedAnalysis,
  AggregatedChampionAnalysis
} from '@shared/data-adapter/analysis/player'
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
  avgKda?: number
  winningStreak?: number
  losingStreak?: number
  /** championId → 使用场数 */
  champions?: Record<number, number>
}): AggregatedAnalysis {
  const streaks = {
    winningStreak: options.winningStreak ?? 0,
    losingStreak: options.losingStreak ?? 0
  }

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
      avgKda: options.avgKda ?? 0,
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
        ...streaks
      },
      normal: {
        count: options.count,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        wins: 0,
        losses: 0,
        winRate: options.winRate,
        ...streaks
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
    champions: createChampions(options.champions),
    jungle: null,
    detailsCount: 0
  }
}

function createChampions(byGames: Record<number, number> = {}) {
  const champions: Record<number, AggregatedChampionAnalysis> = {}

  for (const [championId, games] of Object.entries(byGames)) {
    champions[Number(championId)] = createChampionAnalysis(Number(championId), games)
  }

  return champions
}

function createChampionAnalysis(championId: number, games: number): AggregatedChampionAnalysis {
  return {
    championId,
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
      winRate: 0.5,
      avgSoloKills: null,
      avgEnemyMissingPings: null,
      avgPings: null
    },
    winLoss: {
      all: {
        count: games,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        wins: 0,
        losses: 0,
        winRate: 0.5,
        winningStreak: 0,
        losingStreak: 0
      },
      normal: {
        count: games,
        activeSessionWins: 0,
        activeSessionLosses: 0,
        wins: 0,
        losses: 0,
        winRate: 0.5,
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
      total: 0,
      maxScore: 17,
      outstanding: false,
      extraordinary: false
    },
    positions: null,
    jungle: null
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

describe('computeSituationRead matchup report', () => {
  function createMatchupOptions(options: {
    selfPuuid?: string | null
    positionAssignments?: Record<string, string>
    enemyAnalysis?: AggregatedAnalysis | null
    championRoles?: Record<number, string[]>
  }) {
    return {
      players: [
        createPlayer('me', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
        createPlayer('ally', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
        createPlayer(
          'enemy-mid',
          { tier: 'DIAMOND', division: 'II' },
          options.enemyAnalysis === undefined ? null : options.enemyAnalysis,
          'TEAM-200'
        ),
        createPlayer('enemy-top', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-200')
      ],
      matchup: {
        selfPuuid: options.selfPuuid === undefined ? 'me' : options.selfPuuid,
        positionAssignments:
          options.positionAssignments === undefined
            ? { me: 'MIDDLE', ally: 'TOP', 'enemy-mid': 'MIDDLE', 'enemy-top': 'TOP' }
            : options.positionAssignments,
        championRoles: options.championRoles ?? {}
      }
    }
  }

  it('identifies the same-position enemy player as the matchup opponent', () => {
    const result = computeSituationRead(createMatchupOptions({}))

    expect(result.matchupReport).not.toBeNull()
    expect(result.matchupReport!.selfPosition).toBe('MIDDLE')
    expect(result.matchupReport!.opponent).toMatchObject({
      puuid: 'enemy-mid',
      teamIdentifier: 'TEAM-200',
      rankedSolo: { tier: 'DIAMOND', division: 'II' },
      recentGameCount: null,
      recentWinRate: null
    })
  })

  it('summarizes recent performance from the opponent analysis', () => {
    const result = computeSituationRead(
      createMatchupOptions({
        enemyAnalysis: createAnalysis({ count: 20, winRate: 0.55 })
      })
    )

    expect(result.matchupReport!.opponent).toMatchObject({
      recentGameCount: 20,
      recentWinRate: 0.55
    })
  })

  it.each([
    ['without a self puuid', { selfPuuid: null }],
    ['when the self player is not in any team', { selfPuuid: 'stranger' }],
    ['without a position assignment for the self player', { positionAssignments: {} }],
    ['when the self position is NONE', { positionAssignments: { me: 'NONE' } }],
    ['when the self position is FILL', { positionAssignments: { me: 'FILL' } }],
    ['when no enemy shares the position', { positionAssignments: { me: 'UTILITY' } }]
  ])('hides the matchup report %s', (_, overrides) => {
    const result = computeSituationRead(createMatchupOptions(overrides))
    expect(result.matchupReport).toBeNull()
  })

  it('omits the matchup report when no matchup context is provided', () => {
    const result = computeSituationRead({ players: [createPlayer('p1', null, null)] })
    expect(result.matchupReport).toBeNull()
  })

  describe('recent form precaution rule', () => {
    function getPrecautions(analysis: AggregatedAnalysis) {
      const result = computeSituationRead(createMatchupOptions({ enemyAnalysis: analysis }))
      return result.matchupReport!.opponent!.precautions
    }

    it.each([
      // 描述, 胜率, KDA, 场次, 连胜, 连败, 期望状态类提示
      ['flags a losing streak', 0.4, 2.0, 10, 0, 5, { kind: 'losing-streak', count: 5 }],
      ['ignores a short losing streak', 0.4, 2.0, 10, 0, 2, null],
      ['flags a winning streak', 0.6, 3.0, 10, 4, 0, { kind: 'winning-streak', count: 4 }],
      ['ignores a short winning streak', 0.6, 3.0, 10, 2, 0, null],
      [
        'flags a hot streak with high win rate and kda',
        0.65,
        4.5,
        10,
        0,
        0,
        { kind: 'hot-streak', winRate: 0.65, kda: 4.5 }
      ],
      ['requires enough games for a hot streak', 0.65, 4.5, 3, 0, 0, null],
      ['requires a high win rate for a hot streak', 0.55, 4.5, 10, 0, 0, null],
      ['requires a high kda for a hot streak', 0.65, 3.0, 10, 0, 0, null],
      ['shows nothing for an average form', 0.5, 3.0, 10, 0, 0, null],
      [
        'prefers the losing streak over a hot streak',
        0.65,
        4.5,
        10,
        0,
        3,
        { kind: 'losing-streak', count: 3 }
      ],
      [
        'prefers the winning streak over a hot streak',
        0.65,
        4.5,
        10,
        3,
        0,
        { kind: 'winning-streak', count: 3 }
      ]
    ])('%s', (_, winRate, avgKda, count, winningStreak, losingStreak, expected) => {
      const precautions = getPrecautions(
        createAnalysis({ count, winRate, avgKda, winningStreak, losingStreak })
      )
      const recentForm = precautions.filter((p) => p.kind !== 'champion-archetype')

      expect(recentForm).toEqual(expected ? [expected] : [])
    })

    it('shows no precautions without an opponent analysis', () => {
      const result = computeSituationRead(createMatchupOptions({ enemyAnalysis: null }))
      expect(result.matchupReport!.opponent!.precautions).toEqual([])
    })
  })

  describe('champion archetype precaution rule', () => {
    function getArchetypes(options: {
      champions?: Record<number, number>
      championRoles: Record<number, string[]>
    }) {
      const result = computeSituationRead(
        createMatchupOptions({
          enemyAnalysis: createAnalysis({
            count: 20,
            winRate: 0.5,
            champions: options.champions ?? { 238: 3 }
          }),
          championRoles: options.championRoles
        })
      )

      return result
        .matchupReport!.opponent!.precautions.filter((p) => p.kind === 'champion-archetype')
        .map((p) => (p as { archetype: string }).archetype)
    }

    it('flags archetypes carried by frequently played champions', () => {
      expect(
        getArchetypes({
          champions: { 238: 3, 55: 2 },
          championRoles: { 238: ['Assassin'], 55: ['Mage'] }
        })
      ).toEqual(['Assassin', 'Mage'])
    })

    it('ignores champions played only once', () => {
      expect(
        getArchetypes({ champions: { 238: 1 }, championRoles: { 238: ['Assassin'] } })
      ).toEqual([])
    })

    it('ignores champions without known roles', () => {
      expect(getArchetypes({ champions: { 238: 3 }, championRoles: {} })).toEqual([])
    })

    it('ignores unknown role values', () => {
      expect(getArchetypes({ champions: { 238: 3 }, championRoles: { 238: ['Knox'] } })).toEqual([])
    })

    it('deduplicates archetypes across champions in a fixed order', () => {
      expect(
        getArchetypes({
          champions: { 55: 4, 238: 3 },
          championRoles: { 238: ['Assassin', 'Mage'], 55: ['Mage'] }
        })
      ).toEqual(['Assassin', 'Mage'])
    })
  })
})
