import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OngoingGameAiBriefController } from './ai-brief-controller'
import type { OngoingGameMainContext } from './context'
import { DeepSeekRequestError, requestDeepSeekChatCompletion } from './deepseek-client'

vi.mock('@main/native', () => ({
  magic: () => ''
}))

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
  const champSelect = {
    session: null as { timer: { phase: string } } | null
  }

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
        gameData: { champions: { 238: { name: '阿卡丽' } } },
        champSelect
      }
    },
    appCommon: { settings: { locale: 'zh-CN' } },
    mobxUtils: {
      reaction: vi.fn((selector: () => unknown, effect: (value: unknown) => void) => {
        reactions.push({ selector, effect })
      })
    }
  } as unknown as OngoingGameMainContext

  return { context, state, reactions, champSelect }
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

describe('OngoingGameAiBriefController ally brief lock update', () => {
  /**
   * 模拟选人阶段我方英雄选择状态：championSelections 为 puuid → 英雄，
   * session.timer.phase 驱动"是否已全员锁定"（BAN_PICK 进行中 / FINALIZATION 已锁定）。
   */
  function setChampSelectState(
    state: ReturnType<typeof createContext>['state'],
    champSelect: ReturnType<typeof createContext>['champSelect'],
    allyChampionIds: Record<string, number>,
    timerPhase: string
  ) {
    state.championSelections = { ...allyChampionIds }
    champSelect.session = { timer: { phase: timerPhase } }
  }

  it('regenerates the ally brief once when all allies lock in with changed champions', async () => {
    const { context, state, reactions, champSelect } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    // 首版：研判就绪时仅自己选定英雄，其余队友未定
    setChampSelectState(state, champSelect, { self: 238 }, 'BAN_PICK')
    enterChampSelect(state)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    // 我方 5 人全部锁定，且锁定集合与首版输入不同
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid, index) => [puuid, 238 + index])),
      'FINALIZATION'
    )
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(state.allyBrief).toEqual({ status: 'loading' })
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })
  })

  it('does not regenerate when the locked champions already match the first input', async () => {
    const { context, state, reactions, champSelect } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    // 首版：全员已选定（悬停）同一批英雄
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid) => [puuid, 238])),
      'BAN_PICK'
    )
    enterChampSelect(state)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    // 全员锁定后英雄与首版一致：不触发第二次生成
    champSelect.session = { timer: { phase: 'FINALIZATION' } }
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
  })

  it('does not regenerate when all allies were already locked at first generation', () => {
    const { context, state, reactions, champSelect } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    // 首版生成时我方已全员锁定（如重连进确认阶段）
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid) => [puuid, 238])),
      'FINALIZATION'
    )
    enterChampSelect(state)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)

    // 确认阶段的状态再次变化（如皮肤选择刷新 session）：不再触发第二次生成
    champSelect.session = { timer: { phase: 'GAME_STARTING' } }
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
  })

  it('caps the ally brief at two generations per game', async () => {
    const { context, state, reactions, champSelect } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    setChampSelectState(state, champSelect, { self: 238 }, 'BAN_PICK')
    enterChampSelect(state)
    drive(reactions)

    // 锁定后更新（第 2 次，本局上限）
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid, index) => [puuid, 238 + index])),
      'FINALIZATION'
    )
    drive(reactions)
    expect(mockedRequest).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    // 后续英雄变化（如换肤或重开选人前的异常快照）不再触发
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid, index) => [puuid, 100 + index])),
      'GAME_STARTING'
    )
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)
  })

  it('discards the in-flight first response when the lock update starts', async () => {
    const { context, state, reactions, champSelect } = createContext()
    new OngoingGameAiBriefController(context).watch()

    let resolveFirstRequest!: (content: string) => void
    mockedRequest.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirstRequest = resolve
        })
    )
    mockedRequest.mockResolvedValue('更新后的我方简报')

    setChampSelectState(state, champSelect, { self: 238 }, 'BAN_PICK')
    enterChampSelect(state)
    drive(reactions)
    expect(mockedRequest).toHaveBeenCalledTimes(1)

    // 首版仍在途中即全员锁定且英雄有变：立即发起更新
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid, index) => [puuid, 238 + index])),
      'FINALIZATION'
    )
    drive(reactions)
    expect(state.allyBrief).toEqual({ status: 'loading' })

    // 迟到的首版响应不得覆盖更新结果
    resolveFirstRequest('过期的首版内容')
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '更新后的我方简报' })
    })
  })

  it('allows the lock update again in the next game after a dodge', async () => {
    const { context, state, reactions, champSelect } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    // 第一局：首版 + 锁定更新（达到上限）
    setChampSelectState(state, champSelect, { self: 238 }, 'BAN_PICK')
    enterChampSelect(state)
    drive(reactions)
    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid, index) => [puuid, 238 + index])),
      'FINALIZATION'
    )
    drive(reactions)
    expect(mockedRequest).toHaveBeenCalledTimes(2)

    // 选人秒退回大厅
    state.queryStage = createQueryStage('lobby')
    champSelect.session = null
    drive(reactions)
    expect(state.allyBrief).toBeNull()

    // 新一局选人：首版重新生成，锁定后更新同样可用
    mockedRequest.mockClear()
    setChampSelectState(state, champSelect, { self: 238 }, 'BAN_PICK')
    state.situationRead = createSituationRead()
    state.queryStage = createQueryStage('champ-select')
    drive(reactions)
    expect(mockedRequest).toHaveBeenCalledTimes(1)

    setChampSelectState(
      state,
      champSelect,
      Object.fromEntries(ALLY_PUUIDS.map((puuid, index) => [puuid, 55 + index])),
      'FINALIZATION'
    )
    drive(reactions)
    expect(mockedRequest).toHaveBeenCalledTimes(2)
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

  it('regenerates the ally brief for the new team after a dodge', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('我方简报内容')

    enterChampSelect(state)
    drive(reactions)
    await vi.waitFor(() => {
      expect(state.allyBrief).toEqual({ status: 'success', content: '我方简报内容' })
    })

    // 选人秒退回大厅：旧简报作废
    state.queryStage = createQueryStage('lobby')
    state.situationRead = createSituationRead()
    drive(reactions)
    expect(state.allyBrief).toBeNull()

    // 重新排队进入新一局：匹配到四名新队友（新对局、新队伍）
    const nextGameAllyPuuids = ['self', 'new-ally-2', 'new-ally-3', 'new-ally-4', 'new-ally-5']
    state.teams = { 'TEAM-100': nextGameAllyPuuids, 'TEAM-200': ENEMY_PUUIDS }
    state.summoner = {
      ...state.summoner,
      ...Object.fromEntries(
        nextGameAllyPuuids
          .filter((puuid) => puuid !== 'self')
          .map((puuid) => [puuid, { gameName: `name-${puuid}`, displayName: `display-${puuid}` }])
      )
    }
    state.situationRead = createSituationRead()
    state.queryStage = createQueryStage('champ-select')
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)

    const messages = mockedRequest.mock.calls[1][0].messages
    const payload = JSON.parse(messages[1].content)

    expect(payload.players.map((player: { name: string }) => player.name)).toEqual(
      nextGameAllyPuuids.map((puuid) => `name-${puuid}`)
    )
    for (const oldPuuid of ALLY_PUUIDS.slice(1)) {
      expect(JSON.stringify(payload)).not.toContain(`name-${oldPuuid}`)
    }
  })

  it('issues no new request when returning to the lobby after end-of-game', async () => {
    const { context, state, reactions } = createContext()
    new OngoingGameAiBriefController(context).watch()
    mockedRequest.mockResolvedValue('简报内容')

    // 完整对局：选人生成我方简报、进游戏生成敌方简报
    enterChampSelect(state)
    drive(reactions)
    enterInGame(state)
    drive(reactions)
    await vi.waitFor(() => {
      expect(state.enemyBrief).toEqual({ status: 'success', content: '简报内容' })
    })
    expect(mockedRequest).toHaveBeenCalledTimes(2)

    // EOG：两份简报清空
    state.isInEog = true
    drive(reactions)
    expect(state.allyBrief).toBeNull()
    expect(state.enemyBrief).toBeNull()

    // 回大厅：isInEog 复位、queryInLobbyPhase 使大厅研判就绪——
    // "每局一次"标志此时已清零，若门控失效会再次生成（旧实现的残留路径）
    state.isInEog = false
    state.queryStage = createQueryStage('lobby')
    state.situationRead = createSituationRead()
    drive(reactions)
    drive(reactions)

    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(state.allyBrief).toBeNull()
    expect(state.enemyBrief).toBeNull()
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
