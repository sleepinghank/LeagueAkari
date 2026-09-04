import type { LcuOrSgpGameDetails, LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import type { MatchHistoryQueryParams } from '@shared/http-api-axios-helper/sgp/match-history-query'
import { ONGOING_GAME_DEOBFUSCATION_FEATURE_GATE } from '@shared/shards/feature-gating/keys'
import type {
  AdditionalResult,
  DraftOptions,
  OngoingGameAnalysis,
  OngoingGameMatchHistoryTagPreference,
  OngoingGamePanelChampionUsage,
  OngoingGamePanelOrderPlayerBy,
  OngoingGamePanelPlayerCardTagSettings,
  OngoingGameSettingsData,
  OngoingGameSimplifiedChampMastery,
  SituationRead
} from '@shared/shards/ongoing-game'
import {
  AI_BRIEF_DEFAULT_BASE_URL,
  AI_BRIEF_DEFAULT_MODEL,
  type AiBriefStatus
} from '@shared/shards/ongoing-game/ai-brief'
import { createDefaultOngoingGamePanelPlayerCardTagSettings } from '@shared/shards/ongoing-game/settings'
import type { SavedInfo } from '@shared/shards/saved-player'
import type { RankedStats } from '@shared/types/league-client/ranked'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import { removeSubsets } from '@shared/utils/team-up-calc'
import {
  computedStruct,
  makeAutoObservable,
  observableRef,
  observableShallow,
  observableStruct
} from 'mobx'

import { AppCommonMain } from '../app-common'
import type { FeatureGatingMain } from '../feature-gating'
import { LeagueClientData } from '../league-client/lc-state'
import { SgpMain } from '../sgp'
import type { ChampSelectHandoffSnapshot } from './champ-select-handoff'
import {
  getDraftChampionSelections,
  getDraftPositionAssignments,
  getDraftQueryStage,
  getDraftTeams,
  getLiveChampionSelections,
  getLivePositionAssignments,
  getLiveQueryStage,
  getLiveTeamParticipantGroups,
  getLiveTeams
} from './computed-state'

export class OngoingGameSettings implements OngoingGameSettingsData {
  enabled: boolean = true
  matchHistoryLoadCount: number = 50

  /**
   * 会拉取战绩中前 n 局的时间线数量
   */
  gameDetailsLoadCount: number = 20

  concurrency: number = 2

  /**
   * 战绩查询时, 优先查询当前模式还是全部模式, 仅当 SGP API 启用时有效
   */
  matchHistoryTagPreference: OngoingGameMatchHistoryTagPreference = 'current'

  orderPlayerBy: OngoingGamePanelOrderPlayerBy = 'default'

  showChampionUsage: OngoingGamePanelChampionUsage = 'recent'
  showMatchHistoryItemBorder = false
  showJunglePathing = true
  showJunglePathingForAllPlayers = false
  autoRouteWhenGameStarts = false
  playerCardTags: OngoingGamePanelPlayerCardTagSettings =
    createDefaultOngoingGamePanelPlayerCardTagSettings()

  /**
   * 是否在 lobby 阶段查询战绩
   */
  queryInLobbyPhase = true

  /**
   * 推测预组队时，需要至少多少局游戏才能被推测
   */
  premadeTeamInferMatchCountThreshold: number = 5

  /**
   * AI 简报：DeepSeek API Key，空为默认态（功能关闭），明文存于本地设置文件
   */
  aiSituationBriefApiKey: string = ''

  /**
   * AI 简报：OpenAI 兼容 Base URL，空白时使用官方端点
   */
  aiSituationBriefBaseUrl: string = AI_BRIEF_DEFAULT_BASE_URL

  /**
   * AI 简报：模型名
   */
  aiSituationBriefModel: string = AI_BRIEF_DEFAULT_MODEL

  setAiSituationBriefApiKey(value: string) {
    this.aiSituationBriefApiKey = value
  }

  setAiSituationBriefBaseUrl(value: string) {
    this.aiSituationBriefBaseUrl = value
  }

  setAiSituationBriefModel(value: string) {
    this.aiSituationBriefModel = value
  }

  setOrderPlayerBy(value: OngoingGamePanelOrderPlayerBy) {
    this.orderPlayerBy = value
  }

  setMatchHistoryTagPreference(value: OngoingGameMatchHistoryTagPreference) {
    this.matchHistoryTagPreference = value
  }

  setShowChampionUsage(value: OngoingGamePanelChampionUsage) {
    this.showChampionUsage = value
  }

  setShowMatchHistoryItemBorder(value: boolean) {
    this.showMatchHistoryItemBorder = value
  }

  setShowJunglePathing(value: boolean) {
    this.showJunglePathing = value
  }

  setShowJunglePathingForAllPlayers(value: boolean) {
    this.showJunglePathingForAllPlayers = value
  }

  setAutoRouteWhenGameStarts(value: boolean) {
    this.autoRouteWhenGameStarts = value
  }

  setPlayerCardTags(value: OngoingGamePanelPlayerCardTagSettings) {
    this.playerCardTags = value
  }

  setEnabled(value: boolean) {
    this.enabled = value
  }

  setMatchHistoryLoadCount(value: number) {
    this.matchHistoryLoadCount = value
  }

  setConcurrency(limit: number) {
    this.concurrency = limit
  }

  setGameDetailsLoadCount(value: number) {
    this.gameDetailsLoadCount = value
  }

  setQueryInLobbyPhase(value: boolean) {
    this.queryInLobbyPhase = value
  }

  setPremadeTeamInferMatchCountThreshold(value: number) {
    this.premadeTeamInferMatchCountThreshold = value
  }

  constructor() {
    makeAutoObservable(this, {
      playerCardTags: observableRef
    })
  }
}

export class OngoingGameState {
  get championSelections() {
    if (this.draft) {
      return getDraftChampionSelections(this.draft)
    }

    return getLiveChampionSelections({
      data: this._leagueClientData,
      queryStage: this.queryStage,
      additional: this.additional,
      deobfuscationEnabled: this._deobfuscationEnabled,
      champSelectHandoffSnapshot: this.champSelectHandoffSnapshot
    })
  }

  get positionAssignments() {
    if (this.draft) {
      return getDraftPositionAssignments(this.draft)
    }

    return getLivePositionAssignments({
      data: this._leagueClientData,
      queryStage: this.queryStage,
      additional: this.additional,
      deobfuscationEnabled: this._deobfuscationEnabled,
      champSelectHandoffSnapshot: this.champSelectHandoffSnapshot
    })
  }

  get teams() {
    if (this.draft) {
      return getDraftTeams(this.draft)
    }

    return getLiveTeams({
      data: this._leagueClientData,
      settings: this._settings,
      queryStage: this.queryStage,
      additional: this.additional,
      deobfuscationEnabled: this._deobfuscationEnabled,
      champSelectHandoffSnapshot: this.champSelectHandoffSnapshot
    })
  }

  get queryStage() {
    if (this.draft) {
      return getDraftQueryStage(this.draft)
    }

    return getLiveQueryStage({
      data: this._leagueClientData,
      settings: this._settings
    })
  }

  get isInEog() {
    return (
      this._leagueClientData.gameflow.phase === 'WaitingForStats' ||
      this._leagueClientData.gameflow.phase === 'PreEndOfGame' ||
      this._leagueClientData.gameflow.phase === 'EndOfGame'
    )
  }

  get teamParticipantGroups() {
    if (this.draft) {
      return {}
    }

    return getLiveTeamParticipantGroups({
      data: this._leagueClientData,
      additional: this.additional
    })
  }

  analysis: OngoingGameAnalysis | null = null

  setAnalysis(value: OngoingGameAnalysis | null) {
    this.analysis = value
  }

  situationRead: SituationRead | null = null

  setSituationRead(value: SituationRead | null) {
    this.situationRead = value
  }

  /** 我方简报状态（选人阶段生成）：加载中 / 成功 / 终态失败；未配置 key 或不在对局为 null */
  allyBrief: AiBriefStatus | null = null

  setAllyBrief(value: AiBriefStatus | null) {
    this.allyBrief = value
  }

  /** 敌方简报状态（进入游戏后生成，两份同构三态）：本阶段未触发时为 null */
  enemyBrief: AiBriefStatus | null = null

  setEnemyBrief(value: AiBriefStatus | null) {
    this.enemyBrief = value
  }

  matchHistoryTagParams: Pick<MatchHistoryQueryParams, 'tag' | 'tagsQueryType'> = {}

  setMatchHistoryTagParams(value: Pick<MatchHistoryQueryParams, 'tag' | 'tagsQueryType'>) {
    this.matchHistoryTagParams = value
  }

  matchHistory: Record<
    string,
    {
      source: 'lcu' | 'sgp'
      params: MatchHistoryQueryParams
      data: LcuOrSgpGameSummary[]
    }
  > = {}

  matchHistoryLoadingState: Record<string, string> = {}

  setMatchHistoryLoadingState(player: string, state: string) {
    this.matchHistoryLoadingState = {
      ...this.matchHistoryLoadingState,
      [player]: state
    }
  }

  summoner: Record<string, SummonerInfo> = {}
  summonerLoadingState: Record<string, string> = {}
  rankedStats: Record<string, RankedStats> = {}
  rankedStatsLoadingState: Record<string, string> = {}
  championMastery: Record<string, Record<number, OngoingGameSimplifiedChampMastery>> = {}
  championMasteryLoadingState: Record<string, string> = {}
  savedInfo: Record<string, SavedInfo> = {}
  savedInfoLoadingState: Record<string, string> = {}
  gameDetails: Record<number, LcuOrSgpGameDetails> = {}
  additionalGame: Record<number, LcuOrSgpGameSummary> = {}
  gameDetailsLoadingState: Record<number, string> = {}
  inferredPremadeTeams: string[][] = []

  setInferredPremadeTeams(value: string[][]) {
    this.inferredPremadeTeams = value
  }

  champSelectHandoffSnapshot: ChampSelectHandoffSnapshot | null = null

  setChampSelectHandoffSnapshot(value: ChampSelectHandoffSnapshot | null) {
    this.champSelectHandoffSnapshot = value
  }

  clear(options?: { keepTagParams?: boolean; keepAdditionalInfo?: boolean }) {
    this.analysis = null
    this.situationRead = null
    this.allyBrief = null
    this.enemyBrief = null
    this.matchHistory = {}
    this.summoner = {}
    this.savedInfo = {}
    this.rankedStats = {}
    this.championMastery = {}
    this.matchHistoryLoadingState = {}
    this.summonerLoadingState = {}
    this.savedInfoLoadingState = {}
    this.rankedStatsLoadingState = {}
    this.championMasteryLoadingState = {}
    this.gameDetailsLoadingState = {}
    this.gameDetails = {}
    this.additionalGame = {}
    this.inferredPremadeTeams = []

    if (!options?.keepAdditionalInfo) {
      this.clearAdditional()
    }

    if (!options?.keepTagParams) {
      this.matchHistoryTagParams = {}
    }
  }

  draft: DraftOptions | null = null

  setDraft(value: DraftOptions | null) {
    this.draft = value
  }

  get mergedPremadeTeamMap() {
    const teamIdentifierMap: Record<string, string> = {}
    for (const [teamIdentifier, puuids] of Object.entries(this.teams)) {
      for (const puuid of puuids) {
        teamIdentifierMap[puuid] = teamIdentifier
      }
    }

    let assignedTeamIndex = 0
    const premadeTeamMap: Record<string, number> = {}
    const participationGroups = Object.values(this.teamParticipantGroups)
    const inferredGroups = this.inferredPremadeTeams

    const simplified = removeSubsets(
      [...participationGroups, ...inferredGroups].filter((team) => team.length > 1),
      (team) => team
    )

    for (const puuids of simplified) {
      if (puuids.some((puuid) => teamIdentifierMap[puuid] !== teamIdentifierMap[puuids[0]])) {
        continue
      }

      const index = ++assignedTeamIndex
      for (const puuid of puuids) {
        premadeTeamMap[puuid] = index
      }
    }

    return premadeTeamMap
  }

  get apiShouldUse() {
    if (
      this._appCommon.settings.preferredLolSource === 'sgp' &&
      this._sgpMain.state.availability.serversSupported.matchHistory
    ) {
      return 'sgp'
    }

    return 'lcu'
  }

  private get _deobfuscationEnabled() {
    return this._featureGating.isEnabled(ONGOING_GAME_DEOBFUSCATION_FEATURE_GATE, true)
  }

  additional: AdditionalResult = {
    teams: {},
    selections: {},
    teamParticipantGroups: {},
    spells: {},
    positions: {}
  }

  setAdditional(value: AdditionalResult) {
    this.additional = value
  }

  clearAdditional() {
    this.additional = {
      teams: {},
      selections: {},
      teamParticipantGroups: {},
      spells: {},
      positions: {}
    }
  }

  constructor(
    private readonly _leagueClientData: LeagueClientData,
    private readonly _appCommon: AppCommonMain,
    private readonly _sgpMain: SgpMain,
    private readonly _settings: OngoingGameSettings,
    private readonly _featureGating: FeatureGatingMain
  ) {
    makeAutoObservable(this, {
      matchHistory: observableShallow,
      summoner: observableShallow,
      rankedStats: observableShallow,
      savedInfo: observableShallow,
      championMastery: observableShallow,
      gameDetails: observableShallow,
      additionalGame: observableShallow,
      matchHistoryLoadingState: observableRef,
      summonerLoadingState: observableRef,
      rankedStatsLoadingState: observableRef,
      savedInfoLoadingState: observableRef,
      gameDetailsLoadingState: observableRef,
      championSelections: computedStruct,
      positionAssignments: computedStruct,
      teams: computedStruct,
      analysis: observableStruct,
      situationRead: observableStruct,
      allyBrief: observableStruct,
      enemyBrief: observableStruct,
      queryStage: computedStruct,
      teamParticipantGroups: computedStruct,
      draft: observableStruct,
      matchHistoryTagParams: observableStruct,
      additional: observableStruct,
      inferredPremadeTeams: observableStruct,
      champSelectHandoffSnapshot: observableStruct,
      mergedPremadeTeamMap: computedStruct
    })
  }
}
