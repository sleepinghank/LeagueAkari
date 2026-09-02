import {
  AI_SITUATION_BRIEF_RETRY_DELAYS_MS,
  type AiSituationBriefInput,
  type AiSituationBriefSource,
  buildAiSituationBriefInput,
  buildAiSituationBriefMessages,
  getAiSituationBriefLanguage,
  getSituationReadModeTier
} from '@shared/shards/ongoing-game'
import { formatError } from '@shared/utils/errors'

import type { OngoingGameMainContext } from './context'
import { DeepSeekRequestError, requestDeepSeekChatCompletion } from './deepseek-client'

/**
 * AI 研判总结生成：研判状态就绪（研判卡出现）且已配置 API Key 时自动请求一次，
 * 失败按固定时间表（5s、15s）自动重试，仍失败置为终态错误（本局不再发起）。
 * 结果经既有状态同步机制（state.aiSituationBrief + propSync）暴露给渲染层；
 * 对局结束（EOG）或客户端断开时随研判状态一起清空，下一局不残留。
 * 未配置 Key 时零请求、状态保持 null。
 */
export class OngoingGameAiSituationBriefController {
  /** 本局是否已发起过生成（含重试），防止研判状态闪断导致重复烧钱 */
  private _attemptedThisGame = false
  /** 已失败次数（含首次），用于从重试时间表取下一次间隔 */
  private _failureCount = 0
  /** 生成代次：对局结束时递增，使在途请求与排队中的重试全部作废 */
  private _generationToken = 0
  private _retryTimer: NodeJS.Timeout | null = null

  constructor(private readonly _context: OngoingGameMainContext) {}

  watch() {
    const { mobxUtils, state } = this._context

    mobxUtils.reaction(
      () => state.situationRead != null && !state.isInEog && this._isConfigured(),
      (isReady) => {
        if (isReady && !this._attemptedThisGame) {
          this._attemptedThisGame = true
          this._startGeneration()
        }
      }
    )

    mobxUtils.reaction(
      () => state.isInEog || state.queryStage.phase === 'unavailable',
      (isEnded) => {
        if (isEnded) {
          this._resetForNextGame()
        }
      }
    )
  }

  private _isConfigured() {
    return this._context.settings.aiSituationBriefApiKey.trim() !== ''
  }

  /** 对局结束：作废在途请求与重试、清空状态、允许下一局重新发起 */
  private _resetForNextGame() {
    this._generationToken += 1

    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }

    this._failureCount = 0
    this._attemptedThisGame = false
    this._context.state.setAiSituationBrief(null)
  }

  private _startGeneration() {
    this._failureCount = 0
    this._context.state.setAiSituationBrief({ status: 'loading' })
    void this._request()
  }

  private async _request() {
    const token = this._generationToken
    const { state, settings, logger } = this._context

    const input = this._collectInput()

    if (!input) {
      // 触发后研判状态又消失（如对局即将结束）：不生成，AI 区域随研判卡隐藏
      if (token === this._generationToken) {
        state.setAiSituationBrief(null)
      }
      return
    }

    try {
      const content = await requestDeepSeekChatCompletion({
        apiKey: settings.aiSituationBriefApiKey,
        baseUrl: settings.aiSituationBriefBaseUrl,
        model: settings.aiSituationBriefModel,
        messages: buildAiSituationBriefMessages(input)
      })

      if (token !== this._generationToken) {
        return
      }

      state.setAiSituationBrief({ status: 'success', content })
    } catch (error) {
      if (token !== this._generationToken) {
        return
      }

      const errorType = error instanceof DeepSeekRequestError ? error.type : 'network'
      this._failureCount += 1

      const retryDelayMs = AI_SITUATION_BRIEF_RETRY_DELAYS_MS[this._failureCount - 1]

      if (retryDelayMs !== undefined) {
        logger.warn(
          `AI situation brief request failed (${errorType}), retrying in ${retryDelayMs}ms`,
          formatError(error)
        )
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null
          void this._request()
        }, retryDelayMs)
        return
      }

      logger.warn(
        `AI situation brief request failed (${errorType}), giving up for this game`,
        formatError(error)
      )
      state.setAiSituationBrief({ status: 'error', errorType })
    }
  }

  /** 从既有对局状态收集 AI 研判总结输入；研判状态已不可用时返回 null */
  private _collectInput(): AiSituationBriefInput | null {
    const { state, leagueClient, appCommon } = this._context
    const situationRead = state.situationRead

    if (!situationRead) {
      return null
    }

    const queueId = state.queryStage.gameInfo?.queueId ?? null
    const modeTier = getSituationReadModeTier(this._getGameMode(), queueId)

    if (modeTier === 'hidden') {
      return null
    }

    const champions = leagueClient.data.gameData.champions

    const source: AiSituationBriefSource = {
      language: getAiSituationBriefLanguage(appCommon.settings.locale),
      queueId,
      modeTier,
      selfPuuid: leagueClient.data.summoner.me?.puuid ?? null,
      teams: state.teams,
      summoners: state.summoner,
      championSelections: state.championSelections,
      positionAssignments: Object.fromEntries(
        Object.entries(state.positionAssignments).map(([puuid, assignment]) => [
          puuid,
          assignment.position
        ])
      ),
      rankedStats: state.rankedStats,
      analysis: state.analysis?.players ?? null,
      premadeTeamMap: state.mergedPremadeTeamMap,
      threatRankings: situationRead.threatRankings,
      championNames: Object.fromEntries(
        Object.entries(champions).map(([championId, champion]) => [
          Number(championId),
          champion.name
        ])
      )
    }

    return buildAiSituationBriefInput(source)
  }

  /**
   * 当前对局模式：优先取对局阶段携带的 gameMode；
   * 草稿 / 大厅阶段未携带时退回 queueType（其值同样为 gameMode 字符串）。
   */
  private _getGameMode(): string | null {
    const gameInfo = this._context.state.queryStage.gameInfo
    if (!gameInfo) {
      return null
    }

    if ('gameMode' in gameInfo && gameInfo.gameMode) {
      return gameInfo.gameMode
    }

    return gameInfo.queueType || null
  }
}
