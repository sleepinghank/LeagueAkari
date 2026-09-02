import { describe, expect, it } from 'vitest'

import {
  type AiSituationBriefInput,
  type AiSituationBriefPlayerInput,
  buildAiSituationBriefMessages
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
