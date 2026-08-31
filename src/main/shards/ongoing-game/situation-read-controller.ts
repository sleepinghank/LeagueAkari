import {
  SUPER_SERVER_RSO_PLATFORM_ID,
  type SituationRead,
  type SituationReadPlayerInput,
  computeSituationRead,
  extractSoloRankedEntry
} from '@shared/shards/ongoing-game'
import { compareStructural } from 'mobx'

import type { OngoingGameMainContext } from './context'

/**
 * 局势研判：在既有玩家聚合分析与段位数据的基础上，计算威胁分排行并同步到状态。
 */
export class OngoingGameSituationReadController {
  constructor(private readonly _context: OngoingGameMainContext) {}

  watch() {
    const { leagueClient, mobxUtils, state } = this._context

    mobxUtils.reaction(
      () => ({
        teamKeys: Object.entries(state.teams)
          .map(([teamIdentifier, puuids]) => `${teamIdentifier}:${puuids.join(',')}`)
          .toSorted(),
        analysisKeys: Object.entries(state.analysis?.players ?? {})
          .map(([puuid, analysis]) => `${puuid}:${analysis.count}:${analysis.detailsCount}`)
          .toSorted(),
        rankedSoloKeys: Object.entries(state.rankedStats)
          .map(
            ([puuid, stats]) =>
              `${puuid}:${stats.queueMap?.['RANKED_SOLO_5x5']?.tier ?? ''}:${
                stats.queueMap?.['RANKED_SOLO_5x5']?.division ?? ''
              }`
          )
          .toSorted(),
        premadeTeamKeys: Object.entries(state.mergedPremadeTeamMap)
          .map(([puuid, group]) => `${puuid}:${group}`)
          .toSorted(),
        selfPuuid: leagueClient.data.summoner.me?.puuid ?? null,
        isSuperServerGame: this._isSuperServerGame()
      }),
      () => {
        state.setSituationRead(this._computeSituationRead())
      },
      { delay: 300, equals: compareStructural }
    )
  }

  private _isSuperServerGame() {
    return this._context.leagueClient.state.auth?.rsoPlatformId === SUPER_SERVER_RSO_PLATFORM_ID
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
      selfTeamIdentifier: this._getSelfTeamIdentifier(),
      isSuperServerGame: this._isSuperServerGame(),
      premadeTeamMap: this._context.state.mergedPremadeTeamMap
    })
  }

  /** 我方队伍：本地玩家所在队伍；未找到时返回 null（不产出头号卡） */
  private _getSelfTeamIdentifier(): string | null {
    const selfPuuid = this._context.leagueClient.data.summoner.me?.puuid
    if (!selfPuuid) {
      return null
    }

    const selfTeam = Object.entries(this._context.state.teams).find(([, puuids]) =>
      puuids.includes(selfPuuid)
    )

    return selfTeam?.[0] ?? null
  }
}
