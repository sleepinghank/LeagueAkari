import { magic } from '@main/native'
import { EMPTY_PUUID } from '@shared/constants/common'
import { ChampSelectSession, ChampSelectTeam } from '@shared/types/league-client/champ-select'

export interface VisibleChampSelectMember {
  puuid: string
  teamIdentifier: string
  championId: number
  position: string
  isAutofilled: boolean
  spell1Id: number
  spell2Id: number
}

export function collectVisibleChampSelectMembers(
  session: ChampSelectSession,
  deobfuscationEnabled: boolean
): VisibleChampSelectMember[] {
  const members: VisibleChampSelectMember[] = []

  const collectMember = (member: ChampSelectTeam) => {
    const puuid = getVisibleChampSelectPuuid(member, deobfuscationEnabled)
    if (!puuid) {
      return
    }

    const teamIdentifier = member.team === 100 || member.team === 1 ? 'TEAM-100' : 'TEAM-200'
    members.push({
      puuid,
      teamIdentifier,
      championId: member.championId || member.championPickIntent || 0,
      position: member.assignedPosition.toUpperCase(),
      isAutofilled: member.isAutofilled,
      spell1Id: member.spell1Id || 0,
      spell2Id: member.spell2Id || 0
    })
  }

  session.myTeam.forEach(collectMember)
  session.theirTeam.forEach(collectMember)

  return members
}

export function getVisibleChampSelectPuuid(member: ChampSelectTeam, deobfuscationEnabled: boolean) {
  if (member.nameVisibilityType === 'HIDDEN' && member.obfuscatedPuuid && deobfuscationEnabled) {
    return magic(member.obfuscatedPuuid) || null
  }

  if (!member.puuid || member.puuid === EMPTY_PUUID) {
    return null
  }

  return member.puuid
}

/**
 * 判定选人是否已全员锁定：ban/pick 全部完成后客户端进入确认阶段
 * （FINALIZATION）或开局转场（GAME_STARTING），此后每名成员的英雄不再变化。
 * 悬停（championPickIntent）不算锁定，只有进入这两个阶段才视为锁定完成。
 */
export function isChampSelectFinalized(session: ChampSelectSession): boolean {
  return session.timer.phase === 'FINALIZATION' || session.timer.phase === 'GAME_STARTING'
}
