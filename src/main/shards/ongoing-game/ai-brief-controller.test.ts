import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OngoingGameAiBriefController } from './ai-brief-controller'
import type { OngoingGameMainContext } from './context'
import { DeepSeekRequestError, requestDeepSeekChatCompletion } from './deepseek-client'

vi.mock('./deepseek-client', () => {
  class DeepSeekRequestError extends Error {
    constructor(
      public readonly type: 'config' | 'network' | 'timeout',
      message: string
    ) {
      super(message)
      this.name = 'DeepSeekRequestError'
    }
  }

  return {
    DeepSeekRequestError,
    requestDeepSeekChatCompletion: vi.fn()
  }
})

const ALLY_PUUIDS = ['self', 'ally-2', 'ally-3', 'ally-4', 'ally-5']
const ENEMY_PUUIDS = ['enemy-1', 'enemy-2', 'enemy-3', 'enemy-4', 'enemy-5']
const ALL_PUUIDS = [...ALLY_PUUIDS, ...ENEMY_PUUIDS]

const mockedRequest = vi.mocked(requestDeepSeekChatCompletion)

function createQueryStage(phase: string) {
  if (phase === 'unavailable') {
    return { phase, gameInfo: null }
  }

  return { phase, gameInfo: { queueId: 420, queueType: 'CLASSIC', gameMode: 'CLASSIC', gameId: 1 } }
}

function createSituationRead() {
  return {
    threatRankings: ALL_PUUIDS.map((puuid, index) => ({
      puuid,
      teamIdentifier: ALLY_PUUIDS.includes(puuid) ? 'TEAM-100' : 'TEAM-200',
      score: 7.5 - index * 0.5
    }))
  }
}

function createContext(options: { apiKey?: string } = {}) {
  const state = {
    situationRead: null as ReturnType<typeof createSituationRead> | null,
    isInEog: false,
    queryStage: createQueryStage('unavailable'),
    teams: { 'TEAM-100': ALLY_PUUIDS, 'TEAM-200': ENEMY_PUUIDS },
    summoner: Object.fromEntries(
      ALL_PUUIDS.map((puuid) => [
        puuid,
        { gameName: `name-${puuid}`, displayName: `display-${puuid}` }
      ])
    ),
    championSelections: Object.fromEntries(ALLY_PUUIDS.map((puuid) => [puuid, 238])),
    positionAssignments: Object.fromEntries(
      ALL_PUUIDS.map((puuid) => [puuid, { position: 'MIDDLE' }])
    ),
    rankedStats: {},
    analysis: null,
    mergedPremadeTeamMap: {},
    allyBrief: null as unknown,
    enemyBrief: null as unknown,
    setAllyBrief: vi.fn((value: unknown) => {
      state.allyBrief = value
    }),
    setEnemyBrief: vi.fn((value: unknown) => {
      state.enemyBrief = value
    })
  }

  const reactions: {
    selector: () => unknown
    effect: (value: unknown) => void
  }[] = []

  const context = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      aiSituationBriefApiKey: options.apiKey ?? 'test-api-key',
      aiSituationBriefBaseUrl: '',
      aiSituationBriefModel: 'deepseek-chat'
    },
    state,
    leagueClient: {
      data: {
        summoner: { me: { puuid: 'self' } },
        gameData: { champions: { 238: { name: '阿卡丽' } } }
      }
    },
    appCommon: { settings: { locale: 'zh-CN' } },
    mobxUtils: {
      reaction: vi.fn((selector: () => unknown, effect: (value: unknown) => void) => {
        reactions.push({ selector, effect })
      })
    }
  } as unknown as OngoingGameMainContext

  return { context, state, reactions }
}

/** 手动驱动已注册的 reaction（模拟 MobX 在状态变化后触发 effect） */
function drive(reactions: { selector: () => unknown; effect: (value: unknown) => void }[]) {
  for (const { selector, effect } of reactions) {
    effect(selector())
  }
}

/** 进入选人阶段并使研判就绪 */
function enterChampSelect(state: ReturnType<typeof createContext>['state']) {
  state.queryStage = createQueryStage('champ-select')
  state.situationRead = createSituationRead()
}

/** 进入游戏内阶段（研判沿用当前状态） */
function enterInGame(state: ReturnType<typeof createContext>['state']) {
  state.queryStage = createQueryStage('in-game')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequest.mockReset()
})

describe('OngoingGameAiBriefController phase gating', () => {
  it('issues no LLM request in the lobby phase even when the situation read is ready', () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()

    state.queryStage = createQueryStage('lobby')
    state.situationRead = createSituationRead()
    drive(reactions)

    expect(mockedRequest).not.toHaveBeenCalled()
    expect(state.allyBrief).toBeNull()
    expect(state.enemyBrief).toBeNull()
  })

  it('issues no LLM request while queued outside a match', () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()

    state.queryStage = createQueryStage('unavailable')
    state.situationRead = createSituationRead()
    drive(reactions)

    expect(mockedRequest).not.toHaveBeenCalled()
    expect(state.allyBrief).toBeNull()
  })

  it('issues no LLM request when the API key is not configured', () => {
    const { context, state, reactions } = createContext({ apiKey: '' })
    new OngoingGameAiBriefController(context).watch()

    enterChampSelect(state)
    drive(reactions)

    expect(mockedRequest).not.toHaveBeenCalled()
    expect(state.allyBrief).toBeNull()
  })
})

describe('OngoingGameAiBriefController ally brief generation', () => {
  it('generates the ally brief once in champ-select with only the five ally players in the payload', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    enterChampSelect(state)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(state.allyBrief).toEqual({ status: 'loading' })

    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    const messages = mockedRequest.mock.calls[0][0].messages
    const payload = JSON.parse(messages[1].content)

    expect(payload.players).toHaveLength(5)
    expect(payload.players.map((player: { name: string }) => player.name)).toEqual(
      ALLY_PUUIDS.map((puuid) => `name-${puuid}`)
    )
    expect(JSON.stringify(payload)).not.toContain('enemy')
    expect(state.enemyBrief).toBeNull()
  })

  it('does not generate a second time when the situation read flickers within the same game', () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    enterChampSelect(state)
    drive(reactions)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('retries on failure at 5s and 15s, then settles into the terminal error state', async () => {
    vi.useFakeTimers()

    try {
      const { context, state, reactions } = createContext()
      new OngoingGameAiBriefController(context).watch()
      mockedRequest.mockRejectedValue(new DeepSeekRequestError('network', 'boom'))

      enterChampSelect(state)
      drive(reactions)

      expect(mockedRequest).toHaveBeenCalledTimes(1)
      expect(state.allyBrief).toEqual({ status: 'loading' })

      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockedRequest).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(15_000)
      expect(mockedRequest).toHaveBeenCalledTimes(3)
      expect(state.allyBrief).toEqual({ status: 'error', errorType: 'network' })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockedRequest).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the ally brief when moving from champ-select into the game', () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    enterChampSelect(state)
    drive(reactions)
    state.allyBrief = { status: 'success', content: '我方简报内容' }

    state.queryStage = createQueryStage('in-game')
    drive(reactions)

    // 我方简报保持不变；进入游戏触发的这一次新调用属于敌方简报
    expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(state.enemyBrief).toEqual({ status: 'loading' })
  })
})

describe('OngoingGameAiBriefController game boundary resets', () => {
  it('clears the ally brief state on end-of-game', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    enterChampSelect(state)
    drive(reactions)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    state.queryStage = createQueryStage('in-game')
    state.isInEog = true
    drive(reactions)

    expect(state.allyBrief).toBeNull()
  })

  it('clears the state on dodge and regenerates for the next champ-select', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    enterChampSelect(state)
    drive(reactions)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    // 选人秒退：回到大厅（queryInLobbyPhase 开启时不经过 unavailable）
    state.queryStage = createQueryStage('lobby')
    state.situationRead = createSituationRead()
    drive(reactions)
    expect(state.allyBrief).toBeNull()

    // 重新排队进入新一局选人：按新对局重新生成
    state.queryStage = createQueryStage('champ-select')
    state.situationRead = createSituationRead()
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(state.allyBrief).toEqual({ status: 'loading' })
  })
})

describe('OngoingGameAiBriefController enemy brief generation', () => {
  it('does not generate the enemy brief during champ-select', () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('简报内容')

    enterChampSelect(state)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(state.enemyBrief).toBeNull()
  })

  it('generates the enemy brief in the in-game phase with the five enemy players and the ally lineup', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('敌方简报内容')

    enterChampSelect(state)
    drive(reactions)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '敌方简报内容' })
    })

    enterInGame(state)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(state.enemyBrief).toEqual({ status: 'loading' })

    await vi.waitFor(() => {
      expect(state.enemyBrief).toEqual({ status: 'success', content: '敌方简报内容' })
    })

    const messages = mockedRequest.mock.calls[1][0].messages
    const payload = JSON.parse(messages[1].content)

    expect(payload.players).toHaveLength(5)
    expect(payload.players.map((player: { name: string }) => player.name)).toEqual(
      ENEMY_PUUIDS.map((puuid) => `name-${puuid}`)
    )
    expect(payload.allies).toHaveLength(5)
    expect(payload.allies.map((ally: { name: string }) => ally.name)).toEqual(
      ALLY_PUUIDS.map((puuid) => `name-${puuid}`)
    )
    expect(payload.allies[0]).not.toHaveProperty('threatScore')
  })

  it('generates the enemy brief only once per game even if the reaction fires repeatedly', () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('敌方简报内容')

    state.queryStage = createQueryStage('in-game')
    state.situationRead = createSituationRead()
    drive(reactions)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('still generates the enemy brief when the ally brief has settled into the terminal error state', async () => {
    vi.useFakeTimers()

    try {
      const { context, state, reactions } = createContext()
      new OngoingGameAiBriefController(context).watch()

      // 我方简报三次全部失败，进入终态错误；敌方简报随后成功
      mockedRequest.mockRejectedValueOnce(new DeepSeekRequestError('network', 'boom'))
      mockedRequest.mockRejectedValueOnce(new DeepSeekRequestError('network', 'boom'))
      mockedRequest.mockRejectedValueOnce(new DeepSeekRequestError('network', 'boom'))
      mockedRequest.mockResolvedValue('敌方简报内容')

      enterChampSelect(state)
      drive(reactions)

      await vi.advanceTimersByTimeAsync(5_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(state.allyBrief).toEqual({ status: 'error', errorType: 'network' })

      // 进游戏：我方终态失败不阻断敌方简报生成
      enterInGame(state)
      drive(reactions)

      expect(state.enemyBrief).toEqual({ status: 'loading' })

      await vi.waitFor(() => {
        expect(state.enemyBrief).toEqual({ status: 'success', content: '敌方简报内容' })
      })
      expect(state.allyBrief).toEqual({ status: 'error', errorType: 'network' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the retry schedules independent between the two briefs', async () => {
    vi.useFakeTimers()

    try {
      const { context, state, reactions } = createContext()
      new OngoingGameAiBriefController(context).watch()
      mockedRequest.mockRejectedValue(new DeepSeekRequestError('network', 'boom'))

      enterChampSelect(state)
      drive(reactions)
      expect(mockedRequest).toHaveBeenCalledTimes(1)

      enterInGame(state)
      drive(reactions)
      expect(mockedRequest).toHaveBeenCalledTimes(2)

      // 5s 后：两份各自完成第一次重试
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockedRequest).toHaveBeenCalledTimes(4)

      // 15s 后：两份各自完成第二次重试并进入终态
      await vi.advanceTimersByTimeAsync(15_000)
      expect(mockedRequest).toHaveBeenCalledTimes(6)
      expect(state.allyBrief).toEqual({ status: 'error', errorType: 'network' })
      expect(state.enemyBrief).toEqual({ status: 'error', errorType: 'network' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the enemy brief state on end-of-game and regenerates for the next game', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('敌方简报内容')

    state.queryStage = createQueryStage('in-game')
    state.situationRead = createSituationRead()
    drive(reactions)
    await vi.waitFor(() => {
      expect(state.enemyBrief).toEqual({ status: 'success', content: '敌方简报内容' })
    })

    state.isInEog = true
    drive(reactions)
    expect(state.enemyBrief).toBeNull()

    // 下一局：进入游戏重新生成敌方简报
    state.isInEog = false
    state.queryStage = createQueryStage('in-game')
    state.situationRead = createSituationRead()
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(state.enemyBrief).toEqual({ status: 'loading' })
  })
})
