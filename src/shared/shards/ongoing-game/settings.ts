export type OngoingGamePanelOrderPlayerBy =
  'win-rate' | 'kda' | 'default' | 'akari-score' | 'position' | 'premade-team'

export type OngoingGamePanelChampionUsage = 'recent' | 'mastery' | 'none'

export type OngoingGameMatchHistoryTagPreference = 'current' | 'all'

export interface OngoingGamePanelPlayerCardTagSettings {
  showPremadeTeamTag: boolean
  showSuspiciousFlashPositionTag: boolean
  showWinningStreakTag: boolean
  showLosingStreakTag: boolean
  showSoloKillsTag: boolean
  showEasyGankTag: boolean
  showGreatPerformanceTag: boolean
  showAverageTeamDamageTag: boolean
  showAverageTeamDamageTakenTag: boolean
  showAverageTeamGoldTag: boolean
  showAverageCsPerMinuteTag: boolean
  showAverageDamageGoldEfficiencyTag: boolean
  showAverageEnemyMissingPingsTag: boolean
  showAverageVisionScoreTag: boolean
  showAverageKillDamageEfficiencyTag: boolean
  showSelfTag: boolean
  showMetTag: boolean
  showTaggedTag: boolean
  showWinRateTeamTag: boolean
  showPrivacyTag: boolean
  showAkariScoreTag: boolean
}

export interface OngoingGamePanelSettings {
  enabled: boolean
  matchHistoryLoadCount: number
  orderPlayerBy: OngoingGamePanelOrderPlayerBy
  showChampionUsage: OngoingGamePanelChampionUsage
  showMatchHistoryItemBorder: boolean
  showJunglePathing: boolean
  showJunglePathingForAllPlayers: boolean
  playerCardTags: OngoingGamePanelPlayerCardTagSettings
}

export interface OngoingGameSettingsData extends OngoingGamePanelSettings {
  concurrency: number
  gameDetailsLoadCount: number
  matchHistoryTagPreference: OngoingGameMatchHistoryTagPreference
  autoRouteWhenGameStarts: boolean
  queryInLobbyPhase: boolean
  premadeTeamInferMatchCountThreshold: number
  /** AI 研判总结：DeepSeek API Key（明文存于本地设置文件）；空为默认态，即功能关闭 */
  aiSituationBriefApiKey: string
  /** AI 研判总结：OpenAI 兼容 Base URL，默认官方端点，可填中转 */
  aiSituationBriefBaseUrl: string
  /** AI 研判总结：模型名，默认 deepseek-chat */
  aiSituationBriefModel: string
}

export const DEFAULT_ONGOING_GAME_PANEL_PLAYER_CARD_TAG_SETTINGS =
  Object.freeze<OngoingGamePanelPlayerCardTagSettings>({
    showPremadeTeamTag: true,
    showSuspiciousFlashPositionTag: true,
    showWinningStreakTag: true,
    showLosingStreakTag: true,
    showSoloKillsTag: true,
    showEasyGankTag: true,
    showGreatPerformanceTag: true,
    showAverageTeamDamageTag: false,
    showAverageTeamDamageTakenTag: false,
    showAverageTeamGoldTag: false,
    showAverageCsPerMinuteTag: false,
    showAverageDamageGoldEfficiencyTag: false,
    showAverageEnemyMissingPingsTag: false,
    showAverageVisionScoreTag: false,
    showAverageKillDamageEfficiencyTag: true,
    showSelfTag: true,
    showMetTag: true,
    showTaggedTag: true,
    showWinRateTeamTag: true,
    showPrivacyTag: true,
    showAkariScoreTag: false
  })

export function createDefaultOngoingGamePanelPlayerCardTagSettings(): OngoingGamePanelPlayerCardTagSettings {
  return { ...DEFAULT_ONGOING_GAME_PANEL_PLAYER_CARD_TAG_SETTINGS }
}
