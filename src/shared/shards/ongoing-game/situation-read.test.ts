import type {
  AggregatedAnalysis,
  AggregatedChampionAnalysis,
  AggregatedJungleAnalysis
} from '@shared/data-adapter/analysis/player'
import type { RankedStats } from '@shared/types/league-client/ranked'
import { describe, expect, it } from 'vitest'

import {
  type ChampionCounterQuery,
  type JunglerMatchupReport,
  type LanerMatchupReport,
  type SituationReadPlayerInput,
  computeSituationRead,
  extractSoloRankedEntry,
  getSituationReadModeTier,
  selectFeatureTags
} from './situation-read'

function createJungleAnalysis(options: {
  gamesAnalyzed: number
  level3GankRate?: number
  level4GankRate?: number
  topZonePercentage?: number
  midZonePercentage?: number
  botZonePercentage?: number
}): AggregatedJungleAnalysis {
  return {
    gamesAnalyzed: options.gamesAnalyzed,
    topZoneWeightSum: 0,
    midZoneWeightSum: 0,
    botZoneWeightSum: 0,
    totalZoneWeightSum: 0,
    avgTopZonePercentage: options.topZonePercentage ?? 0,
    avgMidZonePercentage: options.midZonePercentage ?? 0,
    avgBotZonePercentage: options.botZonePercentage ?? 0,
    totalTopGanks: 0,
    totalMidGanks: 0,
    totalBotGanks: 0,
    avgTopGanks: 0,
    avgMidGanks: 0,
    avgBotGanks: 0,
    objectives: {
      firstDragonRate: 0,
      soloDragonRate: 0,
      avgDragons: 0,
      avgFirstDragonTime: null,
      avgVoidgrubs: 0,
      avgFirstVoidgrubTime: null,
      avgHeralds: 0,
      avgFirstHeraldTime: null,
      avgBarons: 0,
      avgFirstBaronTime: null
    },
    firstClearCamp: {
      blue: { red: 0, blue: 0, wolves: 0, raptors: 0 },
      red: { red: 0, blue: 0, wolves: 0, raptors: 0 },
      blueInvade: { red: 0, blue: 0, wolves: 0, raptors: 0 },
      redInvade: { red: 0, blue: 0, wolves: 0, raptors: 0 },
      blueGames: 0,
      redGames: 0
    },
    earlyGank: {
      level3GankRate: options.level3GankRate ?? 0,
      level3GankCount: 0,
      level3KillPositions: [],
      level4GankRate: options.level4GankRate ?? 0,
      level4GankCount: 0,
      level4KillPositions: [],
      byTeam: {
        blueGames: 0,
        redGames: 0,
        blueLevel3GankRate: 0,
        blueLevel3GankCount: 0,
        blueLevel3KillPositions: [],
        blueLevel4GankRate: 0,
        blueLevel4GankCount: 0,
        blueLevel4KillPositions: [],
        redLevel3GankRate: 0,
        redLevel3GankCount: 0,
        redLevel3KillPositions: [],
        redLevel4GankRate: 0,
        redLevel4GankCount: 0,
        redLevel4KillPositions: []
      }
    },
    gankPositions: [],
    minutePositions: []
  }
}

function createAnalysis(options: {
  count: number
  winRate: number
  akariScoreTotal?: number
  akariScoreMax?: number
  winningStreak?: number
  losingStreak?: number
  kdaCv?: number
  flashOnD?: number
  flashOnF?: number
  /** 提供数字时视为有 details 样本；undefined / null 表示无 */
  earlyDeathsWithEnemyJunglerInvolved?: number | null
  /** earlyDeathsWithEnemyJunglerInvolved 的别名（对位专报测试用） */
  avgEarlyDeathsWithEnemyJunglerInvolved?: number | null
  /** 数组形状按 { championId, games } 列出；Record 形状为 championId → 场数 */
  champions?: { championId: number; games: number }[] | Record<number, number>
  avgKda?: number
  jungle?: AggregatedJungleAnalysis | null
}): AggregatedAnalysis {
  const createWinLossEntry = (count: number, winRate: number) => ({
    count,
    activeSessionWins: 0,
    activeSessionLosses: 0,
    wins: 0,
    losses: 0,
    winRate,
    winningStreak: options.winningStreak ?? 0,
    losingStreak: options.losingStreak ?? 0
  })

  const earlyDeaths =
    options.earlyDeathsWithEnemyJunglerInvolved ?? options.avgEarlyDeathsWithEnemyJunglerInvolved

  const summary: AggregatedAnalysis['summary'] = {
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
    // 未指定时落在稳定/起伏判定的中间带，表示"无 KDA 稳定性信号"
    kdaCv: options.kdaCv ?? 0.5,
    winRate: options.winRate,
    avgSoloKills: null,
    avgEnemyMissingPings: null,
    avgPings: null
  }

  const akariScore: AggregatedAnalysis['akariScore'] = {
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
  }

  const analysis: AggregatedAnalysis = {
    count: options.count,
    summary,
    details:
      earlyDeaths === undefined ? null : { avgEarlyDeathsWithEnemyJunglerInvolved: earlyDeaths },
    akariScore,
    map: {},
    teamSide: { redSideCount: 0, blueSideCount: 0 },
    winLoss: {
      all: createWinLossEntry(options.count, options.winRate),
      normal: createWinLossEntry(options.count, options.winRate),
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
    spells: {
      flashOnD: options.flashOnD ?? 0,
      flashOnF: options.flashOnF ?? 0
    },
    positions: null,
    champions: Array.isArray(options.champions)
      ? Object.fromEntries(
          options.champions.map(({ championId, games }) => [
            championId,
            {
              championId,
              summary,
              winLoss: {
                all: createWinLossEntry(games, options.winRate),
                normal: createWinLossEntry(games, options.winRate),
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
              akariScore,
              positions: null,
              jungle: null
            }
          ])
        )
      : createChampions(options.champions),
    jungle: options.jungle ?? null,
    detailsCount: typeof earlyDeaths === 'number' ? options.count : 0
  }

  return analysis
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

describe('computeSituationRead top threat and key carry', () => {
  function createTeamPlayer(
    puuid: string,
    teamIdentifier: string,
    rankedSolo: { tier: string; division: string } | null,
    analysis: AggregatedAnalysis | null = null
  ): SituationReadPlayerInput {
    return { puuid, teamIdentifier, rankedSolo, analysis }
  }

  /**
   * 构造威胁分差距可控的敌方两人组（我方固定一人，不参与敌方评选）。
   * 敌方第一名固定为王者（9.5）；第二名分数 = 段位基线 + 10 场胜率偏离修正（akari 中性），可精确控制到 0.1。
   */
  function createSidedPlayers(enemySecond: {
    tier: string
    division: string
    winRate?: number
  }): SituationReadPlayerInput[] {
    return [
      createTeamPlayer('ally', 'TEAM-100', { tier: 'BRONZE', division: 'IV' }),
      createTeamPlayer('enemy-top', 'TEAM-200', { tier: 'CHALLENGER', division: 'NA' }),
      createTeamPlayer(
        'enemy-second',
        'TEAM-200',
        { tier: enemySecond.tier, division: enemySecond.division },
        enemySecond.winRate === undefined
          ? null
          : createAnalysis({
              count: 10,
              winRate: enemySecond.winRate,
              akariScoreTotal: 8.5
            })
      )
    ]
  }

  it.each([
    // 描述, 敌方第二名构造, 是否有次级
    [
      'shows the secondary threat when the gap is exactly 0.8',
      { tier: 'MASTER', division: 'NA', winRate: 0.85 },
      true
    ],
    [
      'shows the secondary threat when the gap is below 0.8',
      { tier: 'GRANDMASTER', division: 'NA', winRate: 0.75 },
      true
    ],
    [
      'hides the secondary threat when the gap is 0.9',
      { tier: 'GRANDMASTER', division: 'NA', winRate: 0.55 },
      false
    ],
    ['hides the secondary threat when the gap is large', { tier: 'BRONZE', division: 'IV' }, false]
  ])('%s', (_, enemySecond, hasSecondary) => {
    const result = computeSituationRead({
      players: createSidedPlayers(enemySecond),
      selfTeamIdentifier: 'TEAM-100'
    })

    expect(result.topThreat).not.toBeNull()
    expect(result.topThreat!.puuid).toBe('enemy-top')
    expect(result.topThreat!.secondary === null).toBe(!hasSecondary)
    if (hasSecondary) {
      expect(result.topThreat!.secondary!.puuid).toBe('enemy-second')
    }

    // 我方同理：唯一队员即核心大腿
    expect(result.keyCarry).not.toBeNull()
    expect(result.keyCarry!.puuid).toBe('ally')
    expect(result.keyCarry!.secondary).toBeNull()
  })

  it('skips ineligible small-sample unranked players and promotes the next player', () => {
    // smurf: 未定级 + 2 场样本 → 4.0 + 1.5*(2/5) = 4.6，排行第一但无评选资格
    const smurf = createTeamPlayer(
      'smurf',
      'TEAM-200',
      null,
      createAnalysis({ count: 2, winRate: 1.0, akariScoreTotal: 17 })
    )
    const ranked = createTeamPlayer('ranked', 'TEAM-200', { tier: 'IRON', division: 'IV' })
    const ally = createTeamPlayer('ally', 'TEAM-100', { tier: 'BRONZE', division: 'IV' })

    const result = computeSituationRead({
      players: [smurf, ranked, ally],
      selfTeamIdentifier: 'TEAM-100'
    })

    // 排行仍以分数为准，无资格玩家保持第一
    expect(result.threatRankings.map((entry) => entry.puuid)).toEqual(['smurf', 'ally', 'ranked'])
    // 评选跳过无资格玩家
    expect(result.topThreat!.puuid).toBe('ranked')
  })

  it.each([
    [
      'ranked players with fewer than 3 recent games stay eligible',
      { tier: 'GOLD', division: 'I' },
      2
    ],
    ['unranked players with at least 3 recent games become eligible', null, 3]
  ])('%s', (_, rankedSolo, count) => {
    const candidate = createTeamPlayer(
      'candidate',
      'TEAM-200',
      rankedSolo,
      createAnalysis({ count, winRate: 0.5, akariScoreTotal: 8.5 })
    )
    const ally = createTeamPlayer('ally', 'TEAM-100', { tier: 'BRONZE', division: 'IV' })

    const result = computeSituationRead({
      players: [candidate, ally],
      selfTeamIdentifier: 'TEAM-100'
    })

    expect(result.topThreat!.puuid).toBe('candidate')
  })

  it.each([
    'produces no highlights when nobody is eligible',
    'produces no highlights without a self team'
  ])('%s', (description) => {
    const players = [
      createTeamPlayer('ally-unknown', 'TEAM-100', null, null),
      createTeamPlayer('enemy-unknown', 'TEAM-200', null, null)
    ]

    const result = computeSituationRead({
      players,
      selfTeamIdentifier: description.includes('self team') ? undefined : 'TEAM-100'
    })

    expect(result.topThreat).toBeNull()
    expect(result.keyCarry).toBeNull()
    expect(result.threatRankings).toHaveLength(2)
  })
})

interface FeatureTagSignals {
  count?: number
  winRate?: number
  winningStreak?: number
  losingStreak?: number
  kdaCv?: number
  flashOnD?: number
  flashOnF?: number
  gankTimes?: number
  champions?: { championId: number; games: number }[]
  premadeGroupSize?: number | null
  noAnalysis?: boolean
}

function selectTagsFromSignals(signals: FeatureTagSignals) {
  return selectFeatureTags({
    analysis: signals.noAnalysis
      ? null
      : createAnalysis({
          count: signals.count ?? 10,
          winRate: signals.winRate ?? 0.5,
          winningStreak: signals.winningStreak,
          losingStreak: signals.losingStreak,
          kdaCv: signals.kdaCv,
          flashOnD: signals.flashOnD,
          flashOnF: signals.flashOnF,
          earlyDeathsWithEnemyJunglerInvolved: signals.gankTimes,
          champions: signals.champions
        }),
    premadeGroupSize: signals.premadeGroupSize ?? null
  })
}

describe('selectFeatureTags priority and cap', () => {
  it.each([
    [
      'keeps high priority signals ahead of lower ones',
      {
        losingStreak: 5,
        champions: [{ championId: 266, games: 8 }],
        kdaCv: 0.9,
        gankTimes: 1.6,
        premadeGroupSize: 2
      },
      ['losing-streak', 'favorite-champion', 'kda-stability']
    ],
    [
      'fills the remaining slots with lower categories',
      {
        kdaCv: 0.2,
        gankTimes: 1.6,
        premadeGroupSize: 2
      },
      ['kda-stability', 'gank-sensitive', 'premade']
    ],
    [
      'chooses gank sensitivity over flash position within the same category',
      { gankTimes: 1.6, flashOnD: 3, flashOnF: 2 },
      ['gank-sensitive']
    ],
    [
      'shows the flash tag only without gank sensitivity',
      { flashOnD: 3, flashOnF: 2 },
      ['suspicious-flash']
    ],
    ['returns no tags without any signal', {}, []],
    ['returns no tags without analysis', { noAnalysis: true }, []],
    [
      'shows the premade tag without analysis',
      { noAnalysis: true, premadeGroupSize: 3 },
      ['premade']
    ]
  ])('%s', (_, signals, expectedTypes) => {
    expect(selectTagsFromSignals(signals).map((tag) => tag.type)).toEqual(expectedTypes)
  })
})

describe('selectFeatureTags signal boundaries', () => {
  it.each([
    ['qualifies a losing streak of 3', { losingStreak: 3 }, ['losing-streak']],
    ['rejects a losing streak of 2', { losingStreak: 2 }, []],
    ['qualifies a winning streak of 3', { winningStreak: 3 }, ['winning-streak']],
    [
      'qualifies the very high win rate at 16 games and 85%',
      { count: 16, winRate: 0.85 },
      ['high-win-rate']
    ],
    ['rejects the very high win rate below 16 games', { count: 15, winRate: 0.9 }, []],
    ['rejects the very high win rate below 85%', { count: 20, winRate: 0.84 }, []],
    [
      'qualifies a favorite champion with 3 games and a 30% share',
      { champions: [{ championId: 266, games: 3 }], count: 10 },
      ['favorite-champion']
    ],
    [
      'rejects a favorite champion with fewer than 3 games',
      { champions: [{ championId: 266, games: 2 }], count: 3 },
      []
    ],
    [
      'rejects a favorite champion below a 30% share',
      { champions: [{ championId: 266, games: 3 }], count: 11 },
      []
    ],
    ['qualifies stable kda at cv 0.35', { kdaCv: 0.35, count: 5 }, ['kda-stability']],
    ['qualifies volatile kda at cv 0.8', { kdaCv: 0.8, count: 5 }, ['kda-stability']],
    ['rejects kda tags in the middle band', { kdaCv: 0.5, count: 10 }, []],
    ['rejects kda tags below 5 games', { kdaCv: 0.2, count: 4 }, []],
    ['qualifies gank sensitivity at 1.5 early deaths', { gankTimes: 1.5 }, ['gank-sensitive']],
    ['rejects gank sensitivity below 1.5 early deaths', { gankTimes: 1.4 }, []],
    ['rejects a solo premade group', { premadeGroupSize: 1 }, []]
  ])('%s', (_, signals, expectedTypes) => {
    expect(selectTagsFromSignals(signals).map((tag) => tag.type)).toEqual(expectedTypes)
  })

  it('carries the streak count into the tag', () => {
    expect(selectTagsFromSignals({ losingStreak: 5 })).toEqual([
      { type: 'losing-streak', count: 5 }
    ])
  })

  it('picks the most played champion and breaks ties by champion id', () => {
    expect(
      selectTagsFromSignals({
        champions: [
          { championId: 7, games: 6 },
          { championId: 3, games: 6 },
          { championId: 22, games: 4 }
        ],
        count: 20
      })
    ).toEqual([{ type: 'favorite-champion', championId: 3 }])
  })

  it('marks gank sensitivity as very easy above 2 early deaths', () => {
    expect(selectTagsFromSignals({ gankTimes: 2.1 })).toEqual([
      { type: 'gank-sensitive', level: 'very-easy' }
    ])
    expect(selectTagsFromSignals({ gankTimes: 1.6 })).toEqual([
      { type: 'gank-sensitive', level: 'easy' }
    ])
  })

  it('marks kda stability direction', () => {
    expect(selectTagsFromSignals({ kdaCv: 0.2, count: 10 })).toEqual([
      { type: 'kda-stability', stable: true }
    ])
    expect(selectTagsFromSignals({ kdaCv: 0.9, count: 10 })).toEqual([
      { type: 'kda-stability', stable: false }
    ])
  })

  it('carries the premade group size into the tag', () => {
    expect(selectTagsFromSignals({ noAnalysis: true, premadeGroupSize: 3 })).toEqual([
      { type: 'premade', size: 3 }
    ])
  })
})

describe('computeSituationRead feature tags', () => {
  it('attaches the top player tags to highlights and omits them without signals', () => {
    const result = computeSituationRead({
      players: [
        createPlayer(
          'ally',
          { tier: 'BRONZE', division: 'IV' },
          createAnalysis({ count: 10, winRate: 0.5 }),
          'TEAM-100'
        ),
        createPlayer(
          'enemy',
          { tier: 'CHALLENGER', division: 'NA' },
          createAnalysis({ count: 10, winRate: 0.5, losingStreak: 5 }),
          'TEAM-200'
        )
      ],
      selfTeamIdentifier: 'TEAM-100',
      premadeTeamMap: { enemy: 1, ally: 2 }
    })

    expect(result.topThreat!.featureTags).toEqual([{ type: 'losing-streak', count: 5 }])
    expect(result.keyCarry!.featureTags).toEqual([])
  })

  it('derives the premade group size from the team map', () => {
    const result = computeSituationRead({
      players: [
        createPlayer('ally', { tier: 'BRONZE', division: 'IV' }, null, 'TEAM-100'),
        createPlayer('enemy-a', { tier: 'CHALLENGER', division: 'NA' }, null, 'TEAM-200'),
        createPlayer('enemy-b', { tier: 'IRON', division: 'IV' }, null, 'TEAM-200')
      ],
      selfTeamIdentifier: 'TEAM-100',
      premadeTeamMap: { 'enemy-a': 1, 'enemy-b': 1, ally: 2 }
    })

    expect(result.topThreat!.puuid).toBe('enemy-a')
    expect(result.topThreat!.featureTags).toEqual([{ type: 'premade', size: 2 }])
  })
})

describe('computeSituationRead matchup report', () => {
  function createMatchupOptions(options: {
    selfPuuid?: string | null
    positionAssignments?: Record<string, string>
    enemyAnalysis?: AggregatedAnalysis | null
    enemyJungleAnalysis?: AggregatedAnalysis | null
    championRoles?: Record<number, string[]>
    premadeGroups?: string[][]
    players?: SituationReadPlayerInput[]
    selfChampionId?: number | null
    counterQuery?: ChampionCounterQuery
  }) {
    return {
      players: options.players ?? [
        createPlayer('me', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
        createPlayer('ally', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
        createPlayer(
          'enemy-mid',
          { tier: 'DIAMOND', division: 'II' },
          options.enemyAnalysis === undefined ? null : options.enemyAnalysis,
          'TEAM-200'
        ),
        createPlayer('enemy-top', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-200'),
        createPlayer(
          'enemy-jungle',
          { tier: 'GOLD', division: 'IV' },
          options.enemyJungleAnalysis === undefined ? null : options.enemyJungleAnalysis,
          'TEAM-200'
        )
      ],
      matchup: {
        selfPuuid: options.selfPuuid === undefined ? 'me' : options.selfPuuid,
        positionAssignments:
          options.positionAssignments === undefined
            ? {
                me: 'MIDDLE',
                ally: 'TOP',
                'enemy-mid': 'MIDDLE',
                'enemy-top': 'TOP',
                'enemy-jungle': 'JUNGLE'
              }
            : options.positionAssignments,
        championRoles: options.championRoles ?? {},
        premadeGroups: options.premadeGroups ?? [],
        selfChampionId: options.selfChampionId === undefined ? null : options.selfChampionId,
        counterQuery: options.counterQuery
      }
    }
  }

  function asLanerReport(result: ReturnType<typeof computeSituationRead>): LanerMatchupReport {
    const report = result.matchupReport
    if (report?.perspective !== 'laner') {
      throw new Error('Expected a laner matchup report')
    }
    return report
  }

  function asJunglerReport(result: ReturnType<typeof computeSituationRead>): JunglerMatchupReport {
    const report = result.matchupReport
    if (report?.perspective !== 'jungler') {
      throw new Error('Expected a jungler matchup report')
    }
    return report
  }

  it('identifies the same-position enemy player as the matchup opponent', () => {
    const result = computeSituationRead(createMatchupOptions({}))

    expect(result.matchupReport).not.toBeNull()
    expect(result.matchupReport!.selfPosition).toBe('MIDDLE')
    expect(asLanerReport(result).opponent).toMatchObject({
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

    expect(asLanerReport(result).opponent).toMatchObject({
      recentGameCount: 20,
      recentWinRate: 0.55
    })
  })

  it.each([
    ['without a self puuid', { selfPuuid: null }],
    ['when the self player is not in any team', { selfPuuid: 'stranger' }],
    ['without a position assignment for the self player', { positionAssignments: {} }],
    ['when the self position is NONE', { positionAssignments: { me: 'NONE' } }],
    ['when the self position is FILL', { positionAssignments: { me: 'FILL' } }]
  ])('hides the matchup report %s', (_, overrides) => {
    const result = computeSituationRead(createMatchupOptions(overrides))
    expect(result.matchupReport).toBeNull()
  })

  it('keeps the report without a same-position opponent but nulls the opponent', () => {
    const result = computeSituationRead(
      createMatchupOptions({ positionAssignments: { me: 'UTILITY' } })
    )
    expect(result.matchupReport).not.toBeNull()
    expect(result.matchupReport!.selfPosition).toBe('UTILITY')
    expect(asLanerReport(result).opponent).toBeNull()
  })

  it('omits the matchup report when no matchup context is provided', () => {
    const result = computeSituationRead({ players: [createPlayer('p1', null, null)] })
    expect(result.matchupReport).toBeNull()
  })

  describe('recent form precaution rule', () => {
    function getPrecautions(analysis: AggregatedAnalysis) {
      const result = computeSituationRead(createMatchupOptions({ enemyAnalysis: analysis }))
      return asLanerReport(result).opponent!.precautions
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
      expect(asLanerReport(result).opponent!.precautions).toEqual([])
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

      return asLanerReport(result)
        .opponent!.precautions.filter((p) => p.kind === 'champion-archetype')
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

  describe('champion counter precaution rule', () => {
    function getCounterPrecautions(options: {
      champions?: Record<number, number>
      selfChampionId?: number | null
      counterQuery?: ChampionCounterQuery
    }) {
      const result = computeSituationRead(
        createMatchupOptions({
          enemyAnalysis: createAnalysis({
            count: 20,
            winRate: 0.5,
            champions: options.champions ?? { 238: 3 }
          }),
          selfChampionId: options.selfChampionId === undefined ? 103 : options.selfChampionId,
          counterQuery: options.counterQuery
        })
      )

      return asLanerReport(result).opponent!.precautions.filter(
        (p) => p.kind === 'champion-counter'
      )
    }

    it.each([
      // 描述, 对手常用英雄（championId → 场次）, 克制查询, 期望克制提示
      [
        'flags a frequently played champion that counters mine',
        { 238: 3 },
        (_myChampionId: number, otherChampionId: number) =>
          otherChampionId === 238 ? { relationship: 'unfavorable' as const, winRate: 0.43 } : null,
        [{ kind: 'champion-counter', championId: 238, winRate: 0.43 }]
      ],
      [
        'ignores a matchup that favors my champion',
        { 238: 3 },
        () => ({ relationship: 'favorable' as const, winRate: 0.57 }),
        []
      ],
      ['ignores matchups without counter data', { 238: 3 }, () => null, []],
      [
        'keeps the hint while the matchup win rate is missing',
        { 238: 3 },
        () => ({ relationship: 'unfavorable' as const, winRate: null }),
        [{ kind: 'champion-counter', championId: 238, winRate: null }]
      ],
      [
        'lists every countering frequent champion in frequent order',
        { 238: 3, 55: 2 },
        (_myChampionId: number, otherChampionId: number) =>
          otherChampionId === 55 || otherChampionId === 238
            ? { relationship: 'unfavorable' as const, winRate: 0.4 }
            : null,
        [
          { kind: 'champion-counter', championId: 238, winRate: 0.4 },
          { kind: 'champion-counter', championId: 55, winRate: 0.4 }
        ]
      ],
      [
        'ignores champions played only once',
        { 238: 1 },
        () => ({ relationship: 'unfavorable' as const, winRate: 0.4 }),
        []
      ]
    ])('%s', (_, champions, counterQuery, expected) => {
      expect(getCounterPrecautions({ champions, counterQuery })).toEqual(expected)
    })

    it('skips the rule while no champion is selected and never queries', () => {
      const calls: Array<[number, number]> = []
      const counterQuery: ChampionCounterQuery = (myChampionId, otherChampionId) => {
        calls.push([myChampionId, otherChampionId])
        return null
      }

      expect(getCounterPrecautions({ selfChampionId: null, counterQuery })).toEqual([])
      expect(calls).toEqual([])
    })

    it('skips the rule without an injected counter query', () => {
      expect(getCounterPrecautions({})).toEqual([])
    })

    it('ignores champions outside the frequent top set', () => {
      const calls: number[] = []
      const counterQuery: ChampionCounterQuery = (_myChampionId, otherChampionId) => {
        calls.push(otherChampionId)
        return { relationship: 'unfavorable', winRate: 0.4 }
      }

      expect(
        getCounterPrecautions({ champions: { 1: 5, 2: 4, 3: 3, 238: 2 }, counterQuery })
      ).toEqual([
        { kind: 'champion-counter', championId: 1, winRate: 0.4 },
        { kind: 'champion-counter', championId: 2, winRate: 0.4 },
        { kind: 'champion-counter', championId: 3, winRate: 0.4 }
      ])
      expect(calls).toEqual([1, 2, 3])
    })
  })

  describe('enemy jungle threat section', () => {
    function getJungleThreat(options: {
      enemyJungleAnalysis?: AggregatedAnalysis | null
      positionAssignments?: Record<string, string>
      premadeGroups?: string[][]
    }) {
      const result = computeSituationRead(
        createMatchupOptions({
          enemyJungleAnalysis:
            options.enemyJungleAnalysis === undefined ? null : options.enemyJungleAnalysis,
          positionAssignments: options.positionAssignments,
          premadeGroups: options.premadeGroups
        })
      )

      return asLanerReport(result).jungleThreat
    }

    it('targets the enemy player assigned to the jungle position', () => {
      const jungleThreat = getJungleThreat({})
      expect(jungleThreat).toMatchObject({ puuid: 'enemy-jungle', teamIdentifier: 'TEAM-200' })
    })

    it('omits the section when no enemy is assigned to the jungle position', () => {
      const jungleThreat = getJungleThreat({
        positionAssignments: { me: 'MIDDLE', 'enemy-mid': 'MIDDLE', 'enemy-jungle': 'FILL' }
      })
      expect(jungleThreat).toBeNull()
    })

    it.each([
      // 描述, 打野聚合, 期望降级标志, 期望预警
      [
        'flags a high level 3 gank rate',
        createJungleAnalysis({ gamesAnalyzed: 10, level3GankRate: 0.6, level4GankRate: 0.2 }),
        false,
        [{ kind: 'early-gank', level3GankRate: 0.6, level4GankRate: 0.2 }]
      ],
      [
        'flags a high level 4 gank rate',
        createJungleAnalysis({ gamesAnalyzed: 10, level3GankRate: 0.2, level4GankRate: 0.5 }),
        false,
        [{ kind: 'early-gank', level3GankRate: 0.2, level4GankRate: 0.5 }]
      ],
      [
        'ignores average early gank rates',
        createJungleAnalysis({ gamesAnalyzed: 10, level3GankRate: 0.4, level4GankRate: 0.4 }),
        false,
        []
      ],
      [
        'flags the preferred lane when I am elsewhere',
        createJungleAnalysis({ gamesAnalyzed: 10, topZonePercentage: 0.5, midZonePercentage: 0.3 }),
        false,
        [{ kind: 'preferred-lane', lane: 'TOP' }]
      ],
      [
        'ignores an even lane spread',
        createJungleAnalysis({
          gamesAnalyzed: 10,
          topZonePercentage: 0.34,
          midZonePercentage: 0.33,
          botZonePercentage: 0.33
        }),
        false,
        []
      ],
      [
        'combines the early gank warning with the preferred lane',
        createJungleAnalysis({
          gamesAnalyzed: 10,
          level3GankRate: 0.7,
          topZonePercentage: 0.5,
          midZonePercentage: 0.3
        }),
        false,
        [
          { kind: 'early-gank', level3GankRate: 0.7, level4GankRate: 0 },
          { kind: 'preferred-lane', lane: 'TOP' }
        ]
      ],
      [
        'degrades with too few jungle games',
        createJungleAnalysis({ gamesAnalyzed: 2, level3GankRate: 1.0 }),
        true,
        []
      ]
    ])('%s', (_, jungle, expectedInsufficient, expectedPrecautions) => {
      const jungleThreat = getJungleThreat({
        enemyJungleAnalysis: createAnalysis({ count: 10, winRate: 0.5, jungle })
      })

      expect(jungleThreat!.insufficientData).toBe(expectedInsufficient)
      expect(jungleThreat!.precautions).toEqual(expectedPrecautions)
    })

    it('degrades without any jungle sample', () => {
      const jungleThreat = getJungleThreat({
        enemyJungleAnalysis: createAnalysis({ count: 10, winRate: 0.5, jungle: null })
      })
      expect(jungleThreat!.insufficientData).toBe(true)
      expect(jungleThreat!.precautions).toEqual([])
    })

    it('is more explicit when the preferred lane is mine', () => {
      // 默认场景我在 MIDDLE
      const jungleThreat = getJungleThreat({
        enemyJungleAnalysis: createAnalysis({
          count: 10,
          winRate: 0.5,
          jungle: createJungleAnalysis({ gamesAnalyzed: 10, midZonePercentage: 0.6 })
        })
      })
      expect(jungleThreat!.precautions).toEqual([{ kind: 'targets-self', lane: 'MIDDLE' }])
    })

    it.each([
      ['BOTTOM', 'BOTTOM'],
      ['UTILITY', 'BOTTOM']
    ])('maps the %s position to the bottom lane preference', (selfPosition, expectedLane) => {
      const jungleThreat = getJungleThreat({
        positionAssignments: {
          me: selfPosition,
          ally: 'TOP',
          'enemy-mid': 'MIDDLE',
          'enemy-top': 'TOP',
          'enemy-jungle': 'JUNGLE'
        },
        enemyJungleAnalysis: createAnalysis({
          count: 10,
          winRate: 0.5,
          jungle: createJungleAnalysis({ gamesAnalyzed: 10, botZonePercentage: 0.6 })
        })
      })
      expect(jungleThreat!.precautions).toEqual([{ kind: 'targets-self', lane: expectedLane }])
    })

    describe('premade link rule', () => {
      it('links the matchup opponent with the enemy jungler in one premade group', () => {
        const jungleThreat = getJungleThreat({
          premadeGroups: [
            ['enemy-mid', 'enemy-jungle'],
            ['me', 'ally']
          ]
        })
        expect(jungleThreat!.precautions).toEqual([{ kind: 'premade-link' }])
      })

      it('still links while the jungler data is insufficient', () => {
        const jungleThreat = getJungleThreat({
          premadeGroups: [['enemy-mid', 'enemy-jungle']]
        })
        expect(jungleThreat!.insufficientData).toBe(true)
        expect(jungleThreat!.precautions).toEqual([{ kind: 'premade-link' }])
      })

      it.each([
        ['when they are in separate groups', [['enemy-mid'], ['enemy-jungle']]],
        [
          'when only others are premade',
          [
            ['me', 'ally'],
            ['enemy-top', 'enemy-jungle']
          ]
        ]
      ])('does not link %s', (_, premadeGroups) => {
        const jungleThreat = getJungleThreat({ premadeGroups })
        expect(jungleThreat!.precautions).toEqual([])
      })

      it('does not link without a matchup opponent', () => {
        const jungleThreat = getJungleThreat({
          positionAssignments: { me: 'UTILITY', 'enemy-jungle': 'JUNGLE' },
          premadeGroups: [['enemy-mid', 'enemy-jungle']]
        })
        expect(jungleThreat!.precautions).toEqual([])
      })
    })
  })

  describe('jungler perspective', () => {
    function getJunglerReport(options: { players: SituationReadPlayerInput[] }) {
      return asJunglerReport(
        computeSituationRead({
          players: options.players,
          matchup: {
            selfPuuid: 'me',
            positionAssignments: {
              me: 'JUNGLE',
              ally: 'TOP',
              'enemy-top': 'TOP',
              'enemy-mid': 'MIDDLE',
              'enemy-bot': 'BOTTOM',
              'enemy-sup': 'UTILITY',
              'enemy-jungle': 'JUNGLE'
            },
            championRoles: {},
            premadeGroups: [],
            selfChampionId: null
          }
        })
      )
    }

    function createJunglerLobbyPlayers(
      details: Record<string, number | null>
    ): SituationReadPlayerInput[] {
      return [
        createPlayer('me', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
        createPlayer('ally', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
        createPlayer(
          'enemy-top',
          { tier: 'GOLD', division: 'IV' },
          createAnalysis({
            count: 10,
            winRate: 0.5,
            avgEarlyDeathsWithEnemyJunglerInvolved: details['enemy-top'] ?? null
          }),
          'TEAM-200'
        ),
        createPlayer(
          'enemy-mid',
          { tier: 'GOLD', division: 'IV' },
          createAnalysis({
            count: 10,
            winRate: 0.5,
            avgEarlyDeathsWithEnemyJunglerInvolved: details['enemy-mid'] ?? null
          }),
          'TEAM-200'
        ),
        createPlayer(
          'enemy-bot',
          { tier: 'GOLD', division: 'IV' },
          createAnalysis({
            count: 10,
            winRate: 0.5,
            avgEarlyDeathsWithEnemyJunglerInvolved: details['enemy-bot'] ?? null
          }),
          'TEAM-200'
        ),
        createPlayer(
          'enemy-sup',
          { tier: 'GOLD', division: 'IV' },
          createAnalysis({
            count: 10,
            winRate: 0.5,
            avgEarlyDeathsWithEnemyJunglerInvolved: details['enemy-sup'] ?? null
          }),
          'TEAM-200'
        ),
        createPlayer('enemy-jungle', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-200')
      ]
    }

    it('replaces the matchup opponent with ranked enemy gank targets', () => {
      const report = getJunglerReport({
        players: createJunglerLobbyPlayers({
          'enemy-top': 0.8,
          'enemy-mid': 1.2,
          'enemy-bot': null,
          'enemy-sup': 0.1
        })
      })

      expect(report).toMatchObject({ perspective: 'jungler', selfPosition: 'JUNGLE' })
      expect(report.gankTargets.map((target) => [target.puuid, target.earlyGankDeaths])).toEqual([
        ['enemy-mid', 1.2],
        ['enemy-top', 0.8],
        ['enemy-sup', 0.1],
        ['enemy-bot', null]
      ])
    })

    it('describes each target with its position and team', () => {
      const report = getJunglerReport({
        players: createJunglerLobbyPlayers({ 'enemy-mid': 0.5 })
      })

      expect(report.gankTargets.find((target) => target.puuid === 'enemy-mid')).toMatchObject({
        position: 'MIDDLE',
        teamIdentifier: 'TEAM-200'
      })
    })

    it('keeps insufficient-data targets in input order behind ranked ones', () => {
      const report = getJunglerReport({
        players: createJunglerLobbyPlayers({
          'enemy-top': null,
          'enemy-bot': null,
          'enemy-mid': 0.4
        })
      })

      expect(report.gankTargets.map((target) => target.puuid)).toEqual([
        'enemy-mid',
        'enemy-top',
        'enemy-bot',
        'enemy-sup'
      ])
    })
  })
})

describe('getSituationReadModeTier', () => {
  it.each([
    // 召唤师峡谷：排位 / 匹配 → 完整研判
    ['CLASSIC', 420, 'full'],
    ['CLASSIC', 430, 'full'],
    ['CLASSIC', 440, 'full'],
    ['CLASSIC', 490, 'full'],
    // 召唤师峡谷：自定义与人机 → 整卡隐藏
    ['CLASSIC', 0, 'hidden'],
    ['CLASSIC', 830, 'hidden'],
    ['CLASSIC', 840, 'hidden'],
    ['CLASSIC', 850, 'hidden'],
    // 76 是已停用的 6v6 Hexakill 限时模式而非自定义，不隐藏
    ['CLASSIC', 76, 'full'],
    // 大乱斗 → 仅威胁分排行与头号卡
    ['ARAM', 450, 'basic'],
    ['ARAM', null, 'basic'],
    // 自定义大乱斗 → 整卡隐藏
    ['ARAM', 0, 'hidden'],
    // 斗魂竞技场与其它模式 → 整卡隐藏
    ['CHERRY', 1700, 'hidden'],
    ['CHERRY', null, 'hidden'],
    ['URF', 900, 'hidden'],
    ['NEXUSBLITZ', null, 'hidden'],
    ['PRACTICETOOL', null, 'hidden'],
    ['BRAWL', null, 'hidden'],
    ['STRAWBERRY', null, 'hidden'],
    // 模式未知（如草稿模式未携带 gameMode）→ 不降级
    [null, null, 'full'],
    [undefined, undefined, 'full']
  ])('maps game mode %s (queue %j) to tier %s', (gameMode, queueId, tier) => {
    expect(getSituationReadModeTier(gameMode, queueId)).toBe(tier)
  })
})

describe('computeSituationRead mode degradation', () => {
  const players: SituationReadPlayerInput[] = [
    createPlayer('me', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
    createPlayer('ally', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-100'),
    createPlayer(
      'enemy-mid',
      { tier: 'DIAMOND', division: 'II' },
      createAnalysis({ count: 10, winRate: 0.5 }),
      'TEAM-200'
    ),
    createPlayer('enemy-top', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-200'),
    createPlayer('enemy-jungle', { tier: 'GOLD', division: 'IV' }, null, 'TEAM-200')
  ]

  const matchup = {
    selfPuuid: 'me',
    positionAssignments: {
      me: 'MIDDLE',
      'enemy-mid': 'MIDDLE',
      'enemy-top': 'TOP',
      'enemy-jungle': 'JUNGLE'
    },
    championRoles: {},
    premadeGroups: [],
    selfChampionId: null
  }

  it('keeps the matchup report in the full tier', () => {
    const read = computeSituationRead({ players, matchup, selfTeamIdentifier: 'TEAM-100' })

    expect(read.matchupReport).not.toBeNull()
    expect(read.topThreat).not.toBeNull()
    expect(read.keyCarry).not.toBeNull()
  })

  it('drops the matchup report in the basic tier while keeping rankings and highlights', () => {
    const read = computeSituationRead({
      players,
      matchup,
      selfTeamIdentifier: 'TEAM-100',
      modeTier: 'basic'
    })

    expect(read.matchupReport).toBeNull()
    expect(read.threatRankings).toHaveLength(5)
    expect(read.topThreat).not.toBeNull()
    expect(read.keyCarry).not.toBeNull()
  })
})
