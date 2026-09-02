import type { AggregatedAnalysis } from '@shared/data-adapter/analysis/player'
import type { RankedStats } from '@shared/types/league-client/ranked'
import { describe, expect, it } from 'vitest'

import {
  AI_SITUATION_BRIEF_RETRY_DELAYS_MS,
  type AiSituationBriefInput,
  type AiSituationBriefPlayerInput,
  type AiSituationBriefSource,
  buildAiSituationBriefInput,
  buildAiSituationBriefMessages,
  getAiSituationBriefLanguage
} from './ai-situation-brief'

function createPlayer(
  overrides: Partial<AiSituationBriefPlayerInput> = {}
): AiSituationBriefPlayerInput {
  return {
    name: 'Foo',
    isAlly: false,
    position: 'MIDDLE',
    championId: 7,
    ranked: { tier: 'GOLD', division: 'II' },
    threatScore: 5.4,
    recentWinRate: 0.55,
    recentGameCount: 20,
    akariScore: 8.2,
    featureTags: [{ type: 'losing-streak', count: 4 }],
    premadeGroupId: null,
    ...overrides
  }
}

function createInput(overrides: Partial<AiSituationBriefInput> = {}): AiSituationBriefInput {
  return {
    language: 'zh-CN',
    queueId: 420,
    modeTier: 'full',
    self: { position: 'MIDDLE', championId: 238 },
    championNames: { 7: '李青', 238: '阿卡丽' },
    players: [createPlayer()],
    ...overrides
  }
}

function getSystemPrompt(input: AiSituationBriefInput): string {
  return buildAiSituationBriefMessages(input)[0].content
}

function getUserPayload(input: AiSituationBriefInput): {
  mode: string
  self: Record<string, unknown>
  players: Record<string, unknown>[]
} {
  return JSON.parse(buildAiSituationBriefMessages(input)[1].content)
}

describe('buildAiSituationBriefMessages', () => {
  it('builds a system message followed by a user message with parseable JSON data', () => {
    const messages = buildAiSituationBriefMessages(createInput())

    expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(() => JSON.parse(messages[1].content)).not.toThrow()
  })

  it.each([
    {
      language: 'zh-CN' as const,
      queueId: 420,
      modeTier: 'full' as const,
      contains: ['× 2.0', '±1.5', '0.8'],
      notContains: ['× 4.0', '±3.5', '× 0.30']
    },
    {
      language: 'zh-CN' as const,
      queueId: 430,
      modeTier: 'full' as const,
      contains: ['× 2.0', '±1.5', '0.8'],
      notContains: ['× 4.0', '±3.5', '× 0.30']
    },
    {
      language: 'zh-CN' as const,
      queueId: 450,
      modeTier: 'basic' as const,
      contains: ['× 2.0', '±1.5', '0.8'],
      notContains: ['× 4.0', '±3.5', '× 0.30']
    },
    {
      language: 'zh-CN' as const,
      queueId: 440,
      modeTier: 'full' as const,
      contains: ['× 0.30', '× 4.0', '±3.5', '0.5'],
      notContains: ['× 2.0', '±1.5']
    },
    {
      language: 'en' as const,
      queueId: 420,
      modeTier: 'full' as const,
      contains: ['× 2.0', '±1.5', '0.8'],
      notContains: ['× 4.0', '±3.5', '× 0.30']
    },
    {
      language: 'en' as const,
      queueId: 450,
      modeTier: 'basic' as const,
      contains: ['× 2.0', '±1.5', '0.8'],
      notContains: ['× 4.0', '±3.5', '× 0.30']
    },
    {
      language: 'en' as const,
      queueId: 440,
      modeTier: 'full' as const,
      contains: ['× 0.30', '× 4.0', '±3.5', '0.5'],
      notContains: ['× 2.0', '±1.5']
    }
  ])(
    'describes the scoring standard matching queue $queueId ($language)',
    ({ language, queueId, modeTier, contains, notContains }) => {
      const system = getSystemPrompt(createInput({ language, queueId, modeTier }))

      for (const fragment of contains) {
        expect(system).toContain(fragment)
      }

      for (const fragment of notContains) {
        expect(system).not.toContain(fragment)
      }
    }
  )

  it.each([
    { language: 'zh-CN' as const, forbidden: ['对线', '打野'] },
    { language: 'en' as const, forbidden: ['lane against', 'jungler'] }
  ])(
    'basic mode drops position fields and matchup/jungle guidance ($language)',
    ({ language, forbidden }) => {
      const messages = buildAiSituationBriefMessages(
        createInput({ language, queueId: 450, modeTier: 'basic' })
      )
      const payload = getUserPayload(createInput({ language, queueId: 450, modeTier: 'basic' }))

      expect(payload.self).not.toHaveProperty('position')
      expect(payload.players[0]).not.toHaveProperty('position')

      for (const fragment of forbidden) {
        expect(messages[0].content).not.toContain(fragment)
      }

      const fullMessages = buildAiSituationBriefMessages(createInput({ language }))
      expect(JSON.parse(fullMessages[1].content).self).toHaveProperty('position')

      for (const fragment of forbidden) {
        expect(fullMessages[0].content).toContain(fragment)
      }
    }
  )

  it.each([
    { language: 'zh-CN' as const, marker: '数据不足' },
    { language: 'en' as const, marker: 'insufficient data' }
  ])('marks players without match history as such ($language)', ({ language, marker }) => {
    const payload = getUserPayload(
      createInput({
        language,
        players: [
          createPlayer({
            threatScore: null,
            recentWinRate: null,
            recentGameCount: null,
            akariScore: null
          })
        ]
      })
    )

    expect(payload.players[0].threatScore).toBe(marker)
    expect(payload.players[0].recentWinRate).toBe(marker)
    expect(payload.players[0].recentGameCount).toBe(marker)
    expect(payload.players[0].akariScore).toBe(marker)
  })

  it('leaves unlocked champion fields empty', () => {
    const payload = getUserPayload(
      createInput({
        self: { position: 'MIDDLE', championId: null },
        players: [createPlayer({ championId: null })]
      })
    )

    expect(payload.self.champion).toBeNull()
    expect(payload.players[0].champion).toBeNull()
  })

  it.each([
    {
      language: 'zh-CN' as const,
      fragments: ['不得另立排名', '300–500 字', '分条']
    },
    {
      language: 'en' as const,
      fragments: ['must not establish your own rankings', '300–500', 'bullet points']
    }
  ])('includes the ranking ban and length constraints ($language)', ({ language, fragments }) => {
    const system = getSystemPrompt(createInput({ language }))

    for (const fragment of fragments) {
      expect(system).toContain(fragment)
    }
  })

  it.each([
    { language: 'zh-CN' as const, fragment: '简体中文', mode: '单双排位' },
    { language: 'en' as const, fragment: 'English', mode: 'Ranked Solo/Duo' }
  ])('requires output in the target language ($language)', ({ language, fragment, mode }) => {
    const system = getSystemPrompt(createInput({ language }))

    expect(system).toContain(fragment)
    expect(getUserPayload(createInput({ language })).mode).toBe(mode)
  })

  it('serializes exactly the privacy-disclosed fields', () => {
    const payload = getUserPayload(
      createInput({
        players: [createPlayer({ premadeGroupId: 2 })]
      })
    )

    expect(Object.keys(payload).sort()).toEqual(['mode', 'players', 'self'])
    expect(Object.keys(payload.self).sort()).toEqual(['champion', 'position'])
    expect(Object.keys(payload.players[0]).sort()).toEqual([
      'akariScore',
      'champion',
      'featureTags',
      'name',
      'position',
      'premadeGroup',
      'rank',
      'recentGameCount',
      'recentWinRate',
      'team',
      'threatScore'
    ])
  })

  it.each([
    {
      language: 'zh-CN' as const,
      championNames: { 7: '李青', 238: '阿卡丽' },
      expected: {
        position: '中单',
        champion: '李青',
        rank: '黄金 II',
        featureTags: ['4 连败'],
        selfChampion: '阿卡丽'
      }
    },
    {
      language: 'en' as const,
      championNames: { 7: 'Lee Sin', 238: 'Akali' },
      expected: {
        position: 'Mid',
        champion: 'Lee Sin',
        rank: 'Gold II',
        featureTags: ['4-game losing streak'],
        selfChampion: 'Akali'
      }
    }
  ])(
    'localizes disclosed fields per language ($language)',
    ({ language, championNames, expected }) => {
      const payload = getUserPayload(
        createInput({
          language,
          championNames,
          players: [createPlayer({ isAlly: true, premadeGroupId: 1 })]
        })
      )

      expect(payload.players[0].position).toBe(expected.position)
      expect(payload.players[0].champion).toBe(expected.champion)
      expect(payload.players[0].rank).toBe(expected.rank)
      expect(payload.players[0].team).toBe('ally')
      expect(payload.players[0].featureTags).toEqual(expected.featureTags)
      expect(payload.players[0].premadeGroup).toBe(1)
      expect(payload.self.champion).toBe(expected.selfChampion)
    }
  )
})

function createAnalysisFixture(options: {
  count: number
  winRate: number
  akariTotal?: number
  losingStreak?: number
}): AggregatedAnalysis {
  return {
    count: options.count,
    summary: { winRate: options.winRate, kdaCv: 0.5 },
    akariScore: { total: options.akariTotal ?? 0 },
    winLoss: {
      all: {
        count: options.count,
        winRate: options.winRate,
        winningStreak: 0,
        losingStreak: options.losingStreak ?? 0
      }
    },
    spells: { flashOnD: 1, flashOnF: 0 },
    champions: {}
  } as unknown as AggregatedAnalysis
}

function createRankedFixture(options: {
  solo?: { tier: string; division: string } | null
  flex?: { tier: string; division: string } | null
}): RankedStats {
  return {
    queueMap: {
      RANKED_SOLO_5x5: options.solo ?? undefined,
      RANKED_FLEX_SR: options.flex ?? undefined
    }
  } as unknown as RankedStats
}

function createSource(overrides: Partial<AiSituationBriefSource> = {}): AiSituationBriefSource {
  return {
    language: 'zh-CN',
    queueId: 420,
    modeTier: 'full',
    selfPuuid: 'self',
    teams: { ally: ['self', 'ally-2'], enemy: ['enemy-1'] },
    summoners: {
      self: { gameName: 'SelfName', displayName: 'SelfDisplay' },
      'ally-2': { gameName: '', displayName: 'AllyDisplay' },
      'enemy-1': { gameName: '', displayName: '' }
    },
    championSelections: { self: 238, 'enemy-1': 7 },
    positionAssignments: { self: 'MIDDLE', 'ally-2': 'NONE', 'enemy-1': 'MIDDLE' },
    rankedStats: {
      self: createRankedFixture({ solo: { tier: 'GOLD', division: 'II' } }),
      'ally-2': createRankedFixture({}),
      'enemy-1': createRankedFixture({
        solo: { tier: 'GOLD', division: 'II' },
        flex: { tier: 'DIAMOND', division: 'I' }
      })
    },
    analysis: {
      self: createAnalysisFixture({ count: 20, winRate: 0.55, akariTotal: 8.2 }),
      'enemy-1': createAnalysisFixture({
        count: 18,
        winRate: 0.4,
        akariTotal: 5.1,
        losingStreak: 4
      })
    },
    premadeTeamMap: { self: 1, 'ally-2': 1 },
    threatRankings: [
      { puuid: 'enemy-1', teamIdentifier: 'enemy', score: 6.2 },
      { puuid: 'self', teamIdentifier: 'ally', score: 5.4 },
      { puuid: 'ally-2', teamIdentifier: 'ally', score: null }
    ],
    championNames: { 7: '李青', 238: '阿卡丽' },
    ...overrides
  }
}

describe('getAiSituationBriefLanguage', () => {
  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en']
  ])('maps locale %s to %s', (locale, expected) => {
    expect(getAiSituationBriefLanguage(locale)).toBe(expected)
  })
})

describe('AI situation brief retry schedule', () => {
  it('retries twice with fixed delays of 5s and 15s', () => {
    expect(AI_SITUATION_BRIEF_RETRY_DELAYS_MS).toEqual([5_000, 15_000])
  })
})

describe('buildAiSituationBriefInput', () => {
  it('maps ongoing-game state data onto prompt player inputs', () => {
    const input = buildAiSituationBriefInput(createSource())
    const byPuuid = new Map(input.players.map((player) => [player.name, player]))

    expect(input.language).toBe('zh-CN')
    expect(input.queueId).toBe(420)
    expect(input.modeTier).toBe('full')
    expect(input.self).toEqual({ position: 'MIDDLE', championId: 238 })
    expect(input.players).toHaveLength(3)

    // 昵称回退链：gameName → displayName → puuid
    expect(byPuuid.get('SelfName')).toMatchObject({
      isAlly: true,
      position: 'MIDDLE',
      championId: 238,
      ranked: { tier: 'GOLD', division: 'II' },
      threatScore: 5.4,
      recentWinRate: 0.55,
      recentGameCount: 20,
      akariScore: 8.2,
      premadeGroupId: 1
    })
    expect(byPuuid.get('AllyDisplay')).toMatchObject({
      isAlly: true,
      position: null,
      championId: null,
      ranked: null,
      threatScore: null,
      recentWinRate: null,
      recentGameCount: null,
      akariScore: null,
      premadeGroupId: 1
    })
    expect(byPuuid.get('enemy-1')).toMatchObject({
      isAlly: false,
      position: 'MIDDLE',
      championId: 7,
      ranked: { tier: 'GOLD', division: 'II' },
      threatScore: 6.2,
      recentWinRate: 0.4,
      recentGameCount: 18,
      akariScore: 5.1,
      premadeGroupId: null,
      featureTags: [{ type: 'losing-streak', count: 4 }]
    })
  })

  it('derives feature tags with premade group size from the merged premade map', () => {
    const input = buildAiSituationBriefInput(
      createSource({
        analysis: {
          self: createAnalysisFixture({ count: 20, winRate: 0.55 }),
          'ally-2': createAnalysisFixture({ count: 20, winRate: 0.55 }),
          'enemy-1': createAnalysisFixture({ count: 18, winRate: 0.4 })
        }
      })
    )

    const selfPlayer = input.players.find((player) => player.name === 'SelfName')
    expect(selfPlayer?.featureTags).toContainEqual({ type: 'premade', size: 2 })
  })

  it.each([
    {
      queueId: 420,
      solo: { tier: 'GOLD', division: 'II' },
      flex: { tier: 'DIAMOND', division: 'I' },
      expected: { tier: 'GOLD', division: 'II' }
    },
    {
      queueId: 430,
      solo: { tier: 'GOLD', division: 'II' },
      flex: { tier: 'DIAMOND', division: 'I' },
      expected: { tier: 'GOLD', division: 'II' }
    },
    {
      queueId: 440,
      solo: { tier: 'GOLD', division: 'II' },
      flex: { tier: 'DIAMOND', division: 'I' },
      expected: { tier: 'DIAMOND', division: 'I' }
    },
    {
      queueId: 440,
      solo: { tier: 'GOLD', division: 'II' },
      flex: null,
      expected: { tier: 'GOLD', division: 'II' }
    }
  ])(
    'resolves the queue-matched rank entry for queue $queueId',
    ({ queueId, solo, flex, expected }) => {
      const input = buildAiSituationBriefInput(
        createSource({
          queueId,
          rankedStats: { 'enemy-1': createRankedFixture({ solo, flex }) }
        })
      )

      const enemy = input.players.find((player) => player.name === 'enemy-1')
      expect(enemy?.ranked).toEqual(expected)
    }
  )

  it('feeds the assembled input straight into the message builder', () => {
    const messages = buildAiSituationBriefMessages(buildAiSituationBriefInput(createSource()))

    expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(() => JSON.parse(messages[1].content)).not.toThrow()
  })
})
