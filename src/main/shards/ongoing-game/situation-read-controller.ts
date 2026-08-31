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
 * 局势研判：在既有玩家聚合分析与段位数据的基础上，计算威胁分排行与对位专报并同步到状态。
 */
export class OngoingGameSituationReadController {
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
        championRoleCount: Object.keys(this._context.leagueClient.data.gameData.champions).length,
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

  private _getSelfPuuid() {
    return this._context.leagueClient.data.summoner.me?.puuid ?? null
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
        )
      }
    })
  }
}
