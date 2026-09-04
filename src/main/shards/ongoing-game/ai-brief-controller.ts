import {
  type AiBriefSource,
  buildAllyBriefInput,
  buildAllyBriefMessages,
  buildEnemyBriefInput,
  buildEnemyBriefMessages,
  getAiBriefLanguage,
  getSituationReadModeTier
} from '@shared/shards/ongoing-game'

import { AiBriefExecutor } from './ai-brief-executor'
import type { OngoingGameMainContext } from './context'

/**
 * AI 简报生成（两段式）：以查询阶段为门控前提——我方简报仅在选人阶段触发
 * （研判状态就绪 + 已配置 API Key），只评我方 5 人；敌方简报仅在游戏内阶段触发
 * （研判状态就绪 + 已配置 API Key，每局 1 次），评敌方 5 人并对照我方阵容。
 * 大厅、排队、观战等非对局阶段零请求。
 * EOG 或离开对局阶段（含选人秒退回大厅）时清空两份简报状态与"本局已尝试"标志，
 * 下一局从零开始；进入游戏阶段不清空（两份简报在对局中都可查看）。
 * 两份各自持有独立生成单元：我方简报终态失败不阻断敌方简报生成，
 * 每份简报各自独立重试时间表（5s、15s）与终态。
 * 未配置 Key 时零请求、状态保持 null。
 */
export class OngoingGameAiBriefController {
  /** 我方简报本局是否已发起过生成（含重试），防止研判状态闪断导致重复烧钱 */
  private _allyAttemptedThisGame = false
  /** 敌方简报本局是否已发起过生成（含重试），每局 1 次 */
  private _enemyAttemptedThisGame = false

  private readonly _allyExecutor: AiBriefExecutor
  private readonly _enemyExecutor: AiBriefExecutor

  constructor(private readonly _context: OngoingGameMainContext) {
    const { logger, settings, state } = this._context

    this._allyExecutor = new AiBriefExecutor({
      label: 'ally brief',
      logger,
      getRequestConfig: () => ({
        apiKey: settings.aiSituationBriefApiKey,
        baseUrl: settings.aiSituationBriefBaseUrl,
        model: settings.aiSituationBriefModel
      }),
      collectMessages: () => {
        const source = this._collectBriefSource()
        return source ? buildAllyBriefMessages(buildAllyBriefInput(source)) : null
      },
      setStatus: (status) => state.setAllyBrief(status)
    })

    this._enemyExecutor = new AiBriefExecutor({
      label: 'enemy brief',
      logger,
      getRequestConfig: () => ({
        apiKey: settings.aiSituationBriefApiKey,
        baseUrl: settings.aiSituationBriefBaseUrl,
        model: settings.aiSituationBriefModel
      }),
      collectMessages: () => {
        const source = this._collectBriefSource()
        return source ? buildEnemyBriefMessages(buildEnemyBriefInput(source)) : null
      },
      setStatus: (status) => state.setEnemyBrief(status)
    })
  }

  watch() {
    const { mobxUtils, state } = this._context

    mobxUtils.reaction(
      () =>
        state.situationRead != null &&
        !state.isInEog &&
        state.queryStage.phase === 'champ-select' &&
        this._isConfigured(),
      (isReady) => {
        if (isReady && !this._allyAttemptedThisGame) {
          this._allyAttemptedThisGame = true
          this._allyExecutor.start()
        }
      }
    )

    mobxUtils.reaction(
      () =>
        state.situationRead != null &&
        !state.isInEog &&
        state.queryStage.phase === 'in-game' &&
        this._isConfigured(),
      (isReady) => {
        if (isReady && !this._enemyAttemptedThisGame) {
          this._enemyAttemptedThisGame = true
          this._enemyExecutor.start()
        }
      }
    )

    mobxUtils.reaction(
      () => state.isInEog || !this._isInMatchPhase(),
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

  /** 对局阶段（选人 / 游戏中）：两份简报的生成与展示都限定在这两个阶段 */
  private _isInMatchPhase() {
    const phase = this._context.state.queryStage.phase
    return phase === 'champ-select' || phase === 'in-game'
  }

  /** 离开对局（EOG / 秒退回大厅 / 断开）：作废在途请求与重试、清空两份状态、复位每局标志 */
  private _resetForNextGame() {
    this._allyAttemptedThisGame = false
    this._enemyAttemptedThisGame = false
    this._allyExecutor.reset()
    this._enemyExecutor.reset()
  }

  /** 组装两份简报共用的对局快照；研判状态或模式不可用（hidden）时返回 null */
  private _collectBriefSource(): AiBriefSource | null {
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

    return {
      language: getAiBriefLanguage(appCommon.settings.locale),
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
