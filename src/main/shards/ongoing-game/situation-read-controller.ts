import type {
  ChampionDataDetails,
  ChampionDataPosition,
  ChampionDataQuery
} from '@shared/data-adapter/champion-data'
import {
  type ChampionCounterQuery,
  type ChampionCounterRelation,
  SUPER_SERVER_RSO_PLATFORM_ID,
  type SituationRead,
  type SituationReadPlayerInput,
  computeSituationRead,
  extractSoloRankedEntry
} from '@shared/shards/ongoing-game'
import { formatError } from '@shared/utils/errors'
import { compareStructural } from 'mobx'

import type { OngoingGameMainContext } from './context'

/** 我的位置指派 → 英雄数据查询的位置筛选；未识别时查询全位置 */
const SELF_POSITION_TO_CHAMPION_DATA_POSITION: Record<string, ChampionDataPosition> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'middle',
  BOTTOM: 'bottom',
  UTILITY: 'utility'
}

/**
 * 局势研判：在既有玩家聚合分析与段位数据的基础上，计算威胁分排行与对位专报并同步到状态。
 * 英雄克制数据经既有英雄数据适配器按我的英雄加载，以查询函数注入纯计算层。
 */
export class OngoingGameSituationReadController {
  /** 当前可用于注入的克制数据（针对我的英雄）；未选定英雄或未加载完成为 null */
  private _counterData: {
    championId: number
    relations: Map<number, ChampionCounterRelation>
  } | null = null
  /** 最近一次请求的克制数据键（数据集 + 我的位置 + 我的英雄）；未请求为 null */
  private _counterKey: string | null = null
  /** 克制数据加载的代次标识，用于丢弃过期请求的结果 */
  private _counterLoadToken = 0
  /** 已加载的克制数据缓存（键含数据集与我方英雄），避免重复请求 */
  private readonly _counterCache = new Map<string, Map<number, ChampionCounterRelation>>()

  constructor(private readonly _context: OngoingGameMainContext) {}

  watch() {
    const { mobxUtils, state } = this._context

    mobxUtils.reaction(
      () => ({
        teamKeys: Object.entries(state.teams)
          .map(([teamIdentifier, puuids]) => `${teamIdentifier}:${puuids.join(',')}`)
          .toSorted(),
        analysisKeys: Object.keys(state.analysis?.players ?? {}).toSorted(),
        rankedSoloKeys: Object.entries(state.rankedStats)
          .map(
            ([puuid, stats]) =>
              `${puuid}:${stats.queueMap?.['RANKED_SOLO_5x5']?.tier ?? ''}:${
                stats.queueMap?.['RANKED_SOLO_5x5']?.division ?? ''
              }`
          )
          .toSorted(),
        selfPuuid: this._getSelfPuuid() ?? '',
        positionKeys: Object.entries(state.positionAssignments)
          .map(([puuid, assignment]) => `${puuid}:${assignment.position}`)
          .toSorted(),
        premadeGroups: state.inferredPremadeTeams
          .map((group) => [...group].toSorted().join(','))
          .toSorted()
          .join(';'),
        championRoleCount: Object.keys(this._context.leagueClient.data.gameData.champions).length,
        isSuperServerGame: this._isSuperServerGame(),
        selfChampionId: this._getSelfChampionId() ?? 0,
        championDataQuery: this._getChampionDataQueryKey()
      }),
      () => {
        this._syncCounterData()
        state.setSituationRead(this._computeSituationRead())
      },
      { delay: 300, equals: compareStructural }
    )
  }

  private _isSuperServerGame() {
    return this._context.leagueClient.state.auth?.rsoPlatformId === SUPER_SERVER_RSO_PLATFORM_ID
  }

  private _getSelfPuuid() {
    return this._context.leagueClient.data.summoner.me?.puuid ?? null
  }

  private _getSelfChampionId() {
    const selfPuuid = this._getSelfPuuid()
    if (!selfPuuid) {
      return null
    }

    return this._context.state.championSelections[selfPuuid] || null
  }

  /** 英雄克制数据的查询范围：沿用用户在英雄数据设置中偏好的数据集（模式 / 大区 / 段位） */
  private _getChampionDataQuery(): ChampionDataQuery {
    const preferences = this._context.championData.settings.preferences
    const selfPuuid = this._getSelfPuuid()
    const selfPosition = selfPuuid
      ? (this._context.state.positionAssignments[selfPuuid]?.position ?? '')
      : ''

    return {
      mode: preferences.mode,
      region: preferences.region,
      tier: preferences.tier,
      position: SELF_POSITION_TO_CHAMPION_DATA_POSITION[selfPosition] ?? 'all'
    }
  }

  private _getChampionDataQueryKey() {
    const query = this._getChampionDataQuery()
    return [
      this._context.championData.settings.preferredSource,
      query.mode,
      query.region,
      query.tier,
      query.position
    ].join(':')
  }

  /**
   * 克制数据同步：请求范围（数据集 + 我的位置 + 我的英雄）变化时使既有数据失效并按需加载，
   * 我未选定英雄时直接清空（克制提示整条跳过）。
   */
  private _syncCounterData() {
    const championId = this._getSelfChampionId() ?? 0
    const key = `${this._getChampionDataQueryKey()}:${championId}`

    if (key === this._counterKey) {
      return
    }

    this._counterKey = key
    this._counterLoadToken += 1
    this._counterData = null

    if (!championId) {
      return
    }

    const cached = this._counterCache.get(key)
    if (cached) {
      this._counterData = { championId, relations: cached }
      return
    }

    void this._loadCounterData(championId, key)
  }

  /** 经既有英雄数据适配器加载我的英雄的克制关系；失败或无数据时按空数据处理（不猜） */
  private async _loadCounterData(championId: number, key: string) {
    const token = this._counterLoadToken

    let relations = new Map<number, ChampionCounterRelation>()

    try {
      const result = await this._context.championData.loadDetails(
        this._getChampionDataQuery(),
        championId
      )

      if (token === this._counterLoadToken && result.status === 'success') {
        relations = distillCounterRelations(result.data)
      }
    } catch (error) {
      if (token === this._counterLoadToken) {
        this._context.logger.warn(
          `Failed to load champion counter data for ${championId}`,
          formatError(error)
        )
      }
    }

    if (token !== this._counterLoadToken) {
      return
    }

    this._counterCache.set(key, relations)
    this._counterData = { championId, relations }
    this._context.state.setSituationRead(this._computeSituationRead())
  }

  /** 把注入的克制数据包装成纯计算层使用的查询函数；仅回答我当前英雄的关系 */
  private _createCounterQuery(
    championId: number,
    relations: Map<number, ChampionCounterRelation>
  ): ChampionCounterQuery {
    return (myChampionId, otherChampionId) =>
      myChampionId === championId ? (relations.get(otherChampionId) ?? null) : null
  }

  private _computeSituationRead(): SituationRead | null {
    const { state } = this._context

    const teamEntries = Object.entries(state.teams)
    if (!teamEntries.length) {
      return null
    }

    const players: SituationReadPlayerInput[] = []

    for (const [teamIdentifier, puuids] of teamEntries) {
      for (const puuid of puuids) {
        players.push({
          puuid,
          teamIdentifier,
          rankedSolo: extractSoloRankedEntry(state.rankedStats[puuid]),
          analysis: state.analysis?.players[puuid] ?? null
        })
      }
    }

    if (!players.length) {
      return null
    }

    return computeSituationRead({
      players,
      isSuperServerGame: this._isSuperServerGame(),
      matchup: {
        selfPuuid: this._getSelfPuuid(),
        positionAssignments: Object.fromEntries(
          Object.entries(state.positionAssignments).map(([puuid, assignment]) => [
            puuid,
            assignment.position
          ])
        ),
        championRoles: Object.fromEntries(
          Object.entries(this._context.leagueClient.data.gameData.champions).map(
            ([championId, champion]) => [Number(championId), champion.roles]
          )
        ),
        premadeGroups: state.inferredPremadeTeams,
        selfChampionId: this._getSelfChampionId(),
        counterQuery: this._counterData
          ? this._createCounterQuery(this._counterData.championId, this._counterData.relations)
          : undefined
      }
    })
  }
}

/** 从英雄详情中提炼克制关系；关系 unknown 的条目不进入（视为无数据） */
function distillCounterRelations(
  details: ChampionDataDetails
): Map<number, ChampionCounterRelation> {
  const relations = new Map<number, ChampionCounterRelation>()

  for (const matchup of details.sections.matchups ?? []) {
    if (matchup.relationship === 'favorable' || matchup.relationship === 'unfavorable') {
      relations.set(matchup.championId, {
        relationship: matchup.relationship,
        winRate: matchup.performance.winRate
      })
    }
  }

  return relations
}
