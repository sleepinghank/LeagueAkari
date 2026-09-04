import {
  type AiBriefMessage,
  buildAllyBriefInput,
  buildAllyBriefMessages,
  getAiBriefLanguage,
  getSituationReadModeTier
} from '@shared/shards/ongoing-game'

import { AiBriefExecutor } from './ai-brief-executor'
import { isChampSelectFinalized } from './champ-select-members'
import type { OngoingGameMainContext } from './context'

/**
 * AI 简报生成（两段式）：以查询阶段为门控前提——我方简报仅在选人阶段触发
 * （研判状态就绪 + 已配置 API Key），只评我方 5 人；敌方简报仅在游戏内阶段触发
 * （本票仅落地状态位，触发逻辑由后续版本接入）。大厅、排队、观战等非对局阶段零请求。
 * 我方简报的信息完整性补全：首版生成后，我方 5 人全部锁定英雄且锁定集合与首版输入
 * 不同时自动重新生成一次（新版本含英雄玩法维度的完整评估）；首版生成时已全员锁定
 * 或锁定后英雄与首版一致则不额外生成。每局硬上限 2 次生成（首版 + 锁定后更新一次），
 * 后续英雄变化不再触发，计费可预期。
 * EOG 或离开对局阶段（含选人秒退回大厅）时清空两份简报状态与"本局已尝试"标志，
 * 下一局从零开始；进入游戏阶段不清空（两份简报在对局中都可查看）。
 * 每份简报各自独立重试时间表（5s、15s）与终态。
 * 未配置 Key 时零请求、状态保持 null。
 */
export class OngoingGameAiBriefController {
  /** 我方简报本局是否已发起过生成（含重试），防止研判状态闪断导致重复烧钱 */
  private _allyAttemptedThisGame = false
  /** 我方简报首版生成时刻的英雄输入（稳定序列化），锁定后与之比较判定是否需要更新 */
  private _allyFirstInputSelectionsKey: string | null = null
  /** 锁定后更新是否已发起：每局硬上限 2 次生成（首版 1 次 + 更新 1 次） */
  private _allyUpdateAttemptedThisGame = false

  private readonly _allyExecutor: AiBriefExecutor
  /** 敌方简报：状态位就位，进入游戏后的触发与输入组装由后续版本接入 */
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
      collectMessages: () => this._collectAllyMessages(),
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
      collectMessages: () => null,
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
          this._allyFirstInputSelectionsKey = this._serializeAllySelections()
          this._allyExecutor.start()
        }
      }
    )

    // 我方 5 人全员锁定后：锁定集合与首版输入不同则重新生成一次（每局至多一次更新）
    mobxUtils.reaction(
      () => this._getLockedAllySelectionsKey(),
      (lockedSelectionsKey) => {
        if (
          !lockedSelectionsKey ||
          !this._allyFirstInputSelectionsKey ||
          this._allyUpdateAttemptedThisGame ||
          lockedSelectionsKey === this._allyFirstInputSelectionsKey
        ) {
          return
        }

        this._allyUpdateAttemptedThisGame = true
        this._allyExecutor.start()
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

  /**
   * 我方 5 人全员锁定后的英雄集合（puuid → championId 的稳定序列化）：
   * 选人进入确认阶段（FINALIZATION / GAME_STARTING）且每名我方成员都有锁定英雄时
   * 返回序列化键，否则返回 null。悬停未锁定不计入。
   */
  private _getLockedAllySelectionsKey(): string | null {
    const { state, leagueClient } = this._context

    if (!this._allyAttemptedThisGame || this._allyUpdateAttemptedThisGame) {
      return null
    }

    if (state.queryStage.phase !== 'champ-select') {
      return null
    }

    const session = leagueClient.data.champSelect.session
    if (!session || !isChampSelectFinalized(session)) {
      return null
    }

    const entries = this._collectAllySelectionEntries()
    if (!entries || entries.some(([, championId]) => !championId)) {
      return null
    }

    return JSON.stringify(entries)
  }

  /** 首版生成时刻的我方英雄集合序列化（与锁定集合同构，供比较） */
  private _serializeAllySelections(): string | null {
    const entries = this._collectAllySelectionEntries()
    return entries ? JSON.stringify(entries) : null
  }

  /** 定位我方队伍并收集 [puuid, championId]（未锁定为 0）；无法定位我时返回 null */
  private _collectAllySelectionEntries(): [string, number][] | null {
    const { state, leagueClient } = this._context
    const selfPuuid = leagueClient.data.summoner.me?.puuid ?? null

    if (!selfPuuid) {
      return null
    }

    const allyPuuids = Object.values(state.teams).find((puuids) => puuids.includes(selfPuuid))
    if (!allyPuuids) {
      return null
    }

    return allyPuuids.map((puuid) => [puuid, state.championSelections[puuid] ?? 0])
  }

  /** 离开对局（EOG / 秒退回大厅 / 断开）：作废在途请求与重试、清空两份状态、复位每局标志 */
  private _resetForNextGame() {
    this._allyAttemptedThisGame = false
    this._allyFirstInputSelectionsKey = null
    this._allyUpdateAttemptedThisGame = false
    this._allyExecutor.reset()
    this._enemyExecutor.reset()
  }

  /** 组装我方简报提示词；研判状态或模式不可用时返回 null */
  private _collectAllyMessages(): AiBriefMessage[] | null {
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

    return buildAllyBriefMessages(
      buildAllyBriefInput({
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
      })
    )
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
