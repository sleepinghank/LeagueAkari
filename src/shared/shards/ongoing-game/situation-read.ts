import type {
  AggregatedAnalysis,
  AggregatedJungleAnalysis
} from '@shared/data-adapter/analysis/player'
import { QueueEnum } from '@shared/types/league-client/game-data'
import type { RankedStats } from '@shared/types/league-client/ranked'

/**
 * 局势研判的纯函数计算层。
 *
 * 威胁分（0–10，一位小数）= 段位基线 + 近期表现修正：
 * - 基线来自段位常量映射表（集中可调）；本局为灵活排位时基线向中性压缩并优先取灵活段位；
 * - 修正由近期胜率偏离与 Akari 评分合成，上限按队列取参数组（单双/匹配 ±1.5、灵活 ±3.5）；
 * - 样本不足 5 场时修正按样本量向基线收缩；
 * - 无段位且无近期战绩时输出"数据不足"哨兵（score 为 null）。
 *
 * 对位专报（Matchup Report）：自动识别"我"的位置并按视角产出定向分析——
 * - 分路玩家：同位置对手的最近表现与模板化注意事项（英雄克制 + 近期状态 + 英雄粗分类），
 *   外加敌方打野威胁小节（3 / 4 级 gank 率、偏好路、预组队联动）；
 * - 打野玩家：对位部分替换为敌方各路易被抓排名（被 gank 敏感度特征）。
 * 英雄克制动用注入的克制查询（既有英雄数据适配器的 favorable/unfavorable 关系），
 * 我未选定英雄时克制提示整条跳过。
 */

/** 未定级（无本局相关段位）玩家的基线 */
export const THREAT_SCORE_UNRANKED_BASELINE = 4.0

/** 带小段位（IV→I）的段位，从低到高 */
const DIVISIONAL_TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND'
] as const

const DIVISION_INDICES: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 }

/**
 * 段位档位区间表：区间内的小档位从 fromScore 均匀分布到 toScore。
 * 区间划分与规格一致：黑铁→黄金 2.0–5.0；白金→翡翠 5.0–6.5；钻石 6.5–7.5。
 */
export const THREAT_SCORE_TIER_BANDS = [
  { fromTier: 'IRON', toTier: 'GOLD', fromScore: 2.0, toScore: 5.0 },
  { fromTier: 'PLATINUM', toTier: 'EMERALD', fromScore: 5.0, toScore: 6.5 },
  { fromTier: 'DIAMOND', toTier: 'DIAMOND', fromScore: 6.5, toScore: 7.5 }
] as const

/** 无小段位的高段位基线：大师→宗师区间（7.5–9.0）与王者区间（9.0–10.0）内的代表点 */
export const THREAT_SCORE_APEX_BASELINES = {
  MASTER: 8.0,
  GRANDMASTER: 8.5,
  CHALLENGER: 9.5
} as const

/** 基线压缩的中性中心点（灵活局向该值收敛段位差距） */
export const THREAT_SCORE_BASELINE_COMPRESSION_CENTER = 5.0

/**
 * 威胁分评分参数组（按本局队列二选一，集中可调）：
 * - 基线压缩：基线′ = 压缩中心 + (基线 − 压缩中心) × 系数；
 * - 近期表现修正：胜率与 Akari 评分各自的权重，以及合成后的绝对值上限。
 */
export interface ThreatScoreParams {
  /** 基线压缩系数；1 表示不压缩 */
  baselineCompression: number
  /** 胜率每偏离 50% 一个单位贡献的修正（胜率 100% → +0.5 × 权重） */
  winRateScale: number
  /** Akari 评分比例每偏离中性锚点一个单位贡献的修正（满分 → +0.5 × 权重） */
  akariScale: number
  /** 近期表现修正的绝对值上限 */
  maxAdjustment: number
}

/** 单双排与普通匹配局的评分参数组（段位基线不压缩、修正上限 ±1.5） */
export const THREAT_SCORE_SOLO_PARAMS: ThreatScoreParams = {
  baselineCompression: 1,
  winRateScale: 2.0,
  akariScale: 2.0,
  maxAdjustment: 1.5
}

/** 灵活排位局的评分参数组：段位基线向中性压缩、近期表现主导排序（修正上限 ±3.5） */
export const THREAT_SCORE_FLEX_PARAMS: ThreatScoreParams = {
  baselineCompression: 0.3,
  winRateScale: 4.0,
  akariScale: 4.0,
  maxAdjustment: 3.5
}

/** 修正不收缩所需的最小近期场次 */
export const THREAT_SCORE_FULL_SAMPLE_COUNT = 5

/** Akari 评分比例的中性锚点（比例 = akariScore.total / akariScore.maxScore） */
export const THREAT_SCORE_AKARI_NEUTRAL_RATIO = 0.5

/** 威胁分上下限 */
export const THREAT_SCORE_MIN = 0
export const THREAT_SCORE_MAX = 10

/** 视为"未定级"的 tier 值 */
const UNRANKED_TIERS = new Set(['NA', 'NONE', ''])

/**
 * 次级威胁（次级核心）的分差阈值：第二名与头号威胁分差不超过该值时才展示，覆盖双核阵容。
 * 单双排与匹配局沿用 0.8；灵活局分数分布更密，阈值降为 0.5。
 */
export const SITUATION_SECONDARY_SCORE_GAP = 0.8

/** 灵活排位局的次级威胁分差阈值 */
export const SITUATION_SECONDARY_SCORE_GAP_FLEX = 0.5

/**
 * 头号评选所需的最小近期样本：未定级玩家近期样本不足该数量时不参与评选（防新号小样本误判）。
 */
export const SITUATION_MIN_ELIGIBLE_SAMPLE_COUNT = 3

/**
 * 峡谷之巅超级服（rsoPlatformId）的对局中，单双排段位实际水平按王者档计算。
 */
export const SUPER_SERVER_RSO_PLATFORM_ID = 'BGP2'

/** 本局是否为灵活排位（queueId 440）：威胁分切换灵活局参数组与段位回退链 */
export function isFlexQueue(queueId: number | null | undefined): boolean {
  return queueId === QueueEnum.RANK_FLEX
}

/**
 * 研判展示档位（按对局模式降级）：
 * - full：召唤师峡谷（排位 / 匹配）——排行 + 头号卡 + 对位专报；
 * - basic：大乱斗——仅威胁分排行与头号卡（无位置概念，对位专报与打野小节隐藏）；
 * - hidden：斗魂竞技场、人机、自定义及其它模式——研判卡整卡隐藏。
 */
export type SituationReadModeTier = 'full' | 'basic' | 'hidden'

/** 召唤师峡谷内不展示研判的队列：自定义（queueId 0）与人机 */
export const SITUATION_READ_HIDDEN_CLASSIC_QUEUE_IDS: ReadonlySet<number> = new Set([
  QueueEnum.CUSTOM,
  QueueEnum.BOT_INTRO,
  QueueEnum.BOT_INTERMEDIATE,
  QueueEnum.BOT_BEGINNER
])

/**
 * 对局模式 → 研判展示档位。模式未知（null / undefined，如草稿模式未携带 gameMode）时不降级。
 * 自定义对局（queueId 0，含自定义召唤师峡谷与自定义大乱斗）一律整卡隐藏。
 */
export function getSituationReadModeTier(
  gameMode: string | null | undefined,
  queueId: number | null | undefined
): SituationReadModeTier {
  if (queueId === QueueEnum.CUSTOM) {
    return 'hidden'
  }

  switch (gameMode) {
    case 'CLASSIC':
      return queueId != null && SITUATION_READ_HIDDEN_CLASSIC_QUEUE_IDS.has(queueId)
        ? 'hidden'
        : 'full'
    case 'ARAM':
      return 'basic'
    case null:
    case undefined:
    case '':
      return 'full'
    default:
      return 'hidden'
  }
}

/** 头号卡展示的特征标签数量上限 */
export const SITUATION_FEATURE_TAGS_MAX_COUNT = 3

/** 连胜/连败形成标签所需的最小场次（与既有玩家卡连胜/连败标签阈值一致） */
export const SITUATION_FEATURE_TAG_STREAK_MIN_COUNT = 3

/** 极高胜率标签所需的最小场次与最低胜率（与既有玩家卡极高胜率标签阈值一致） */
export const SITUATION_FEATURE_TAG_HIGH_WIN_RATE_MIN_GAMES = 16
export const SITUATION_FEATURE_TAG_HIGH_WIN_RATE_MIN_RATE = 0.85

/** 常用英雄标签所需的最小英雄场次与最低场次占比 */
export const SITUATION_FEATURE_TAG_FAVORITE_CHAMPION_MIN_GAMES = 3
export const SITUATION_FEATURE_TAG_FAVORITE_CHAMPION_MIN_SHARE = 0.3

/** KDA 稳定性标签所需的最小场次，以及稳定/起伏的 KDA 变异系数边界 */
export const SITUATION_FEATURE_TAG_KDA_MIN_GAMES = 5
export const SITUATION_FEATURE_TAG_KDA_STABLE_MAX_CV = 0.35
export const SITUATION_FEATURE_TAG_KDA_VOLATILE_MIN_CV = 0.8

/** gank 敏感（好抓）标签的最低场均早死次数；超过更高一档为非常好抓（与既有玩家卡好抓标签一致） */
export const SITUATION_FEATURE_TAG_GANK_SENSITIVE_MIN_TIMES = 1.5
export const SITUATION_FEATURE_TAG_VERY_GANK_SENSITIVE_MIN_TIMES = 2

/** 预组队标签所需的最小组内人数 */
export const SITUATION_FEATURE_TAG_PREMADE_MIN_SIZE = 2

/**
 * 特征标签：从既有玩家聚合分析按固定优先级选取的结构化标签，由渲染层负责转成 i18n 文案。
 * 优先级：近期状态（连胜/连败/胜率）> 常用英雄 > KDA 稳定性 > 闪现位置/gank 敏感 > 预组队。
 */
export type SituationFeatureTag =
  | { type: 'losing-streak'; count: number }
  | { type: 'winning-streak'; count: number }
  | { type: 'high-win-rate' }
  | { type: 'favorite-champion'; championId: number }
  | { type: 'kda-stability'; stable: boolean }
  | { type: 'gank-sensitive'; level: 'easy' | 'very-easy' }
  | { type: 'suspicious-flash' }
  | { type: 'premade'; size: number }

/** 可识别并参与对位匹配的位置 */
export const MATCHUP_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

/** 连败达到该场数触发"心态可能不佳，可施压"提示 */
export const MATCHUP_LOSING_STREAK_THRESHOLD = 3

/** 连胜达到该场数触发"近期状态在线"提示 */
export const MATCHUP_WINNING_STREAK_THRESHOLD = 3

/** "近期状态火热"所需的最小近期胜率 */
export const MATCHUP_HOT_STREAK_WIN_RATE = 0.6

/** "近期状态火热"所需的最小近期平均 KDA */
export const MATCHUP_HOT_STREAK_KDA = 4.0

/** "近期状态火热"所需的最小近期场次（小样本不触发） */
export const MATCHUP_HOT_STREAK_MIN_GAMES = 5

/** 参与英雄粗分类判定的常用英雄数量 */
export const MATCHUP_FREQUENT_CHAMPION_COUNT = 3

/** 英雄至少使用该场数才视为"常用英雄" */
export const MATCHUP_FREQUENT_CHAMPION_MIN_GAMES = 2

/** LCU roles 粗分类 → 类型提示的固定顺序（文案键与此一致） */
export const MATCHUP_ARCHETYPE_ORDER = [
  'Assassin',
  'Mage',
  'Marksman',
  'Fighter',
  'Tank',
  'Support'
] as const

/** 敌方打野威胁：低于该打野样本数时小节显示降级状态而非结论 */
export const JUNGLE_THREAT_MIN_GAMES = 3

/** 敌方打野 3 / 4 级 gank 率达到该值时触发早期 gank 预警 */
export const JUNGLE_THREAT_EARLY_GANK_RATE = 0.5

/** 敌方打野在某一路的活动占比达到该值时视为"偏好 gank 该路" */
export const JUNGLE_THREAT_PREFERRED_LANE_RATE = 0.45

/** 对位专报的路维度：下路双人组（BOTTOM / UTILITY）共享同一路 */
export type MatchupLane = 'TOP' | 'MIDDLE' | 'BOTTOM'

/** 位置 → 路映射；JUNGLE 不参与（打野视角下无此概念） */
export const MATCHUP_POSITION_TO_LANE: Record<string, MatchupLane> = {
  TOP: 'TOP',
  MIDDLE: 'MIDDLE',
  BOTTOM: 'BOTTOM',
  UTILITY: 'BOTTOM'
}

/** 路 → 敌方打野聚合中对应的活动占比字段 */
const LANE_ZONE_PERCENTAGE_KEYS: Record<MatchupLane, keyof AggregatedJungleAnalysis> = {
  TOP: 'avgTopZonePercentage',
  MIDDLE: 'avgMidZonePercentage',
  BOTTOM: 'avgBotZonePercentage'
}

export interface SituationReadRankedSolo {
  tier: string
  division: string
}

/** 注入的英雄克制查询返回的克制关系：查询英雄对目标英雄 favorable / unfavorable，附对抗表现 */
export interface ChampionCounterRelation {
  relationship: 'favorable' | 'unfavorable'
  /** 查询英雄在该对位中的胜率；数据缺失为 null */
  winRate: number | null
}

/**
 * 注入的英雄克制查询：返回 myChampionId 对 otherChampionId 的克制关系与对抗表现。
 * 无克制数据（含关系 unknown）返回 null，不猜。数据来自既有英雄数据适配器。
 */
export type ChampionCounterQuery = (
  myChampionId: number,
  otherChampionId: number
) => ChampionCounterRelation | null

export interface SituationReadPlayerInput {
  puuid: string
  teamIdentifier: string
  /** 单双排段位；未定级或无数据为 null。灵活局作为基线段位的回退来源 */
  rankedSolo: SituationReadRankedSolo | null
  /** 灵活排位段位；未定级或无数据为 null。灵活局优先作为基线段位 */
  rankedFlex?: SituationReadRankedSolo | null
  /** 近期对局聚合分析；无战绩为 null */
  analysis: AggregatedAnalysis | null
}

export interface SituationPlayerThreat {
  puuid: string
  teamIdentifier: string
  /** 威胁分（0–10，一位小数）；null 表示数据不足 */
  score: number | null
}

export interface SituationReadSecondary {
  puuid: string
  score: number
}

export interface SituationReadHighlight {
  puuid: string
  teamIdentifier: string
  score: number
  /** 同队威胁分第二名；仅当与头号分差不超过阈值时存在 */
  secondary: SituationReadSecondary | null
  /** 头号玩家的特征标签；按固定优先级最多 3 个，无可展示信号时为空数组 */
  featureTags: SituationFeatureTag[]
}

/**
 * 对位专报的注意事项（特征标签 → 固定模板文案）。
 * - 英雄克制：对手常用英雄中克制我当前英雄的（我未选定英雄时整条跳过）
 * - 近期状态类：连败 / 连胜 / 高胜率高 KDA（状态平庸时不产生）
 * - 英雄粗分类：对手常用英雄携带的 LCU roles 粗分类
 */
export type MatchupPrecaution =
  | { kind: 'champion-counter'; championId: number; winRate: number | null }
  | { kind: 'losing-streak'; count: number }
  | { kind: 'winning-streak'; count: number }
  | { kind: 'hot-streak'; winRate: number; kda: number }
  | { kind: 'champion-archetype'; archetype: string }

export interface MatchupReportOpponent {
  puuid: string
  teamIdentifier: string
  /** 单双排段位；未定级或无数据为 null */
  rankedSolo: SituationReadRankedSolo | null
  /** 近期对局场次；无战绩为 null */
  recentGameCount: number | null
  /** 近期胜率；无战绩为 null */
  recentWinRate: number | null
  precautions: MatchupPrecaution[]
}

/** 敌方打野威胁小节的注意事项 */
export type MatchupJunglePrecaution =
  /** 3 / 4 级 gank 率高，前几分钟压线需做视野 */
  | { kind: 'early-gank'; level3GankRate: number; level4GankRate: number }
  /** 偏好 gank 某一路（非我所在路） */
  | { kind: 'preferred-lane'; lane: MatchupLane }
  /** 偏好 gank 我所在的路，预警更明确 */
  | { kind: 'targets-self'; lane: MatchupLane }
  /** 对位者与敌方打野是预组队，警惕联动 gank */
  | { kind: 'premade-link' }

export interface MatchupJungleThreat {
  puuid: string
  teamIdentifier: string
  /** 打野样本低于阈值时为 true：小节显示降级状态，不产出行为类预警 */
  insufficientData: boolean
  precautions: MatchupJunglePrecaution[]
}

/** 打野视角下"敌方各路谁容易被抓"的单个目标 */
export interface MatchupGankTarget {
  puuid: string
  teamIdentifier: string
  /** 目标位置（TOP / MIDDLE / BOTTOM / UTILITY） */
  position: string
  /** 场均早期被敌方打野参与的死亡；无 details 数据为 null（数据不足） */
  earlyGankDeaths: number | null
}

/** 分路玩家视角：同位置对手 + 敌方打野威胁小节 */
export interface LanerMatchupReport {
  perspective: 'laner'
  /** 我的位置（TOP / MIDDLE / BOTTOM / UTILITY） */
  selfPosition: string
  /** 同位置敌方对手；敌方无同位置玩家时为 null（对位者块隐藏） */
  opponent: MatchupReportOpponent | null
  /** 敌方打野威胁；敌方无打野指派时为 null（小节隐藏） */
  jungleThreat: MatchupJungleThreat | null
}

/** 打野视角：对位部分替换为敌方各路易被抓排名，指引反蹲与 gank 方向 */
export interface JunglerMatchupReport {
  perspective: 'jungler'
  selfPosition: 'JUNGLE'
  /** 敌方各路目标，按场均早期被 gank 死亡降序；数据不足者排在末尾（保持输入顺序） */
  gankTargets: MatchupGankTarget[]
}

export type MatchupReport = LanerMatchupReport | JunglerMatchupReport

/** 对位专报的计算上下文 */
export interface MatchupReadContext {
  /** 我的 puuid；无法识别为 null */
  selfPuuid: string | null
  /** puuid → 位置指派（选人或对局阶段）；值形如 TOP / NONE / FILL */
  positionAssignments: Record<string, string>
  /** championId → LCU 英雄数据自带的 roles 粗分类 */
  championRoles: Record<number, readonly string[]>
  /** 既有预组队推断结果：每组为一路预组队的 puuid 集合 */
  premadeGroups: string[][]
  /** 我已选定的英雄；未选定为 null（克制提示整条跳过） */
  selfChampionId: number | null
  /** 注入的英雄克制查询；缺省时不产出克制提示 */
  counterQuery?: ChampionCounterQuery
}

export interface SituationRead {
  /** 全部玩家，按威胁分降序排列；数据不足的玩家排在末尾（保持输入顺序） */
  threatRankings: SituationPlayerThreat[]
  /** 敌方头号威胁；无敌方队伍或全员无评选资格时为 null */
  topThreat: SituationReadHighlight | null
  /** 我方核心大腿；无我方队伍或全员无评选资格时为 null */
  keyCarry: SituationReadHighlight | null
  /** 对位专报；身份 / 位置 / 对位者无法识别时为 null（小节隐藏） */
  matchupReport: MatchupReport | null
}

/**
 * 从段位数据中提取单双排段位条目；未定级或无数据返回 null。
 */
export function extractSoloRankedEntry(
  rankedStats: RankedStats | null | undefined
): SituationReadRankedSolo | null {
  return extractRankedEntry(rankedStats, 'RANKED_SOLO_5x5')
}

/**
 * 从段位数据中提取灵活排位段位条目；未定级或无数据返回 null。
 */
export function extractFlexRankedEntry(
  rankedStats: RankedStats | null | undefined
): SituationReadRankedSolo | null {
  return extractRankedEntry(rankedStats, 'RANKED_FLEX_SR')
}

function extractRankedEntry(
  rankedStats: RankedStats | null | undefined,
  queueKey: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'
): SituationReadRankedSolo | null {
  const entry = rankedStats?.queueMap?.[queueKey]

  if (!entry || !entry.tier || UNRANKED_TIERS.has(entry.tier)) {
    return null
  }

  return { tier: entry.tier, division: entry.division }
}

/**
 * 玩家参与威胁分计算与判定依据展示的段位来源：
 * 灵活局优先灵活段位（缺失回退单双段位）；其余队列一律单双段位。
 */
export function getEffectiveRankedEntry(
  rankedFlex: SituationReadRankedSolo | null,
  rankedSolo: SituationReadRankedSolo | null,
  isFlexQueueGame: boolean
): SituationReadRankedSolo | null {
  if (isFlexQueueGame && rankedFlex) {
    return rankedFlex
  }

  return rankedSolo
}

/**
 * 计算局势研判结果：敌我十人威胁分排行、敌方头号威胁与我方核心大腿（含次级与特征标签）+ 对位专报。
 * 纯函数，不依赖 IPC / 网络。basic 档位（大乱斗）下对位专报整体不产出。
 * 本局为灵活排位时切换灵活局参数组（压缩基线、修正权重与上限、次级阈值）并优先取灵活段位。
 */
export function computeSituationRead(options: {
  players: SituationReadPlayerInput[]
  /** 我方（本地玩家所在）队伍标识；缺失时不产出头号卡 */
  selfTeamIdentifier?: string | null
  /** 峡谷之巅超级服对局：单双排段位按王者档计算基线 */
  isSuperServerGame?: boolean
  /** 预组队映射（puuid → 组标识），来自既有预组队推断；缺省视为无预组队 */
  premadeTeamMap?: Record<string, number> | null
  /** 对位专报上下文；缺省时不产出专报 */
  matchup?: MatchupReadContext
  /** 展示档位；basic（大乱斗）时对位专报与打野小节隐藏。缺省 full */
  modeTier?: SituationReadModeTier
  /** 本局为灵活排位（queueId 440）：切换灵活局参数组与段位回退链；缺省 false */
  isFlexQueueGame?: boolean
}): SituationRead {
  const isFlexQueueGame = Boolean(options.isFlexQueueGame)
  const params = isFlexQueueGame ? THREAT_SCORE_FLEX_PARAMS : THREAT_SCORE_SOLO_PARAMS
  const secondaryGap = isFlexQueueGame
    ? SITUATION_SECONDARY_SCORE_GAP_FLEX
    : SITUATION_SECONDARY_SCORE_GAP
  const effectiveRanks = new Map(
    options.players.map((player) => [
      player.puuid,
      getEffectiveRankedEntry(player.rankedFlex ?? null, player.rankedSolo, isFlexQueueGame)
    ])
  )

  const threatRankings = options.players.map((player) => ({
    puuid: player.puuid,
    teamIdentifier: player.teamIdentifier,
    score: computeThreatScore(
      effectiveRanks.get(player.puuid) ?? null,
      player.analysis,
      Boolean(options.isSuperServerGame),
      params
    )
  }))

  const sortedRankings = threatRankings.toSorted((a, b) => {
    if (a.score === null && b.score === null) return 0
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score
  })

  const selfTeamIdentifier = options.selfTeamIdentifier ?? null
  const enemyTeamIdentifiers = new Set(
    options.players
      .map((player) => player.teamIdentifier)
      .filter((teamIdentifier) => teamIdentifier !== selfTeamIdentifier)
  )
  const premadeGroupSizes = getPremadeGroupSizes(options.premadeTeamMap ?? null)

  return {
    threatRankings: sortedRankings,
    topThreat: computeTeamHighlight(
      sortedRankings,
      options.players,
      enemyTeamIdentifiers,
      premadeGroupSizes,
      effectiveRanks,
      secondaryGap
    ),
    keyCarry: selfTeamIdentifier
      ? computeTeamHighlight(
          sortedRankings,
          options.players,
          new Set([selfTeamIdentifier]),
          premadeGroupSizes,
          effectiveRanks,
          secondaryGap
        )
      : null,
    matchupReport:
      options.modeTier === 'basic'
        ? null
        : options.matchup
          ? computeMatchupReport(options.players, options.matchup)
          : null
  }
}

/**
 * 从既有玩家聚合分析中按固定优先级选取特征标签（头号卡最多展示 3 个）：
 * 近期状态（连胜/连败/胜率）> 常用英雄 > KDA 稳定性 > 闪现位置/gank 敏感 > 预组队。
 * 每类最多贡献一个标签，保证高优先级信号不会被低优先级标签挤出。纯函数。
 */
export function selectFeatureTags(options: {
  analysis: AggregatedAnalysis | null
  /** 预组队组大小（含本人）；无预组队信息为 null */
  premadeGroupSize?: number | null
}): SituationFeatureTag[] {
  const tags: SituationFeatureTag[] = [
    getRecentFormTag(options.analysis),
    getFavoriteChampionTag(options.analysis),
    getKdaStabilityTag(options.analysis),
    getGankSensitivityTag(options.analysis) ?? getSuspiciousFlashTag(options.analysis),
    getPremadeTag(options.premadeGroupSize ?? null)
  ].filter((tag): tag is SituationFeatureTag => tag !== null)

  return tags.slice(0, SITUATION_FEATURE_TAGS_MAX_COUNT)
}

/** 近期状态类标签：连败 > 连胜 > 极高胜率，一类最多一个 */
function getRecentFormTag(analysis: AggregatedAnalysis | null): SituationFeatureTag | null {
  if (!analysis) {
    return null
  }

  const all = analysis.winLoss.all

  if (all.losingStreak >= SITUATION_FEATURE_TAG_STREAK_MIN_COUNT) {
    return { type: 'losing-streak', count: all.losingStreak }
  }

  if (all.winningStreak >= SITUATION_FEATURE_TAG_STREAK_MIN_COUNT) {
    return { type: 'winning-streak', count: all.winningStreak }
  }

  if (
    all.count >= SITUATION_FEATURE_TAG_HIGH_WIN_RATE_MIN_GAMES &&
    all.winRate >= SITUATION_FEATURE_TAG_HIGH_WIN_RATE_MIN_RATE
  ) {
    return { type: 'high-win-rate' }
  }

  return null
}

/** 常用英雄标签：场次最多且达到最低场次与占比的英雄 */
function getFavoriteChampionTag(analysis: AggregatedAnalysis | null): SituationFeatureTag | null {
  if (!analysis || analysis.count <= 0) {
    return null
  }

  const mostPlayed = Object.values(analysis.champions)
    .toSorted((a, b) => b.winLoss.all.count - a.winLoss.all.count || a.championId - b.championId)
    .at(0)

  if (!mostPlayed) {
    return null
  }

  const games = mostPlayed.winLoss.all.count

  if (
    games < SITUATION_FEATURE_TAG_FAVORITE_CHAMPION_MIN_GAMES ||
    games / analysis.count < SITUATION_FEATURE_TAG_FAVORITE_CHAMPION_MIN_SHARE
  ) {
    return null
  }

  return { type: 'favorite-champion', championId: mostPlayed.championId }
}

/** KDA 稳定性标签：变异系数低为发挥稳定，高为状态起伏 */
function getKdaStabilityTag(analysis: AggregatedAnalysis | null): SituationFeatureTag | null {
  if (!analysis || analysis.count < SITUATION_FEATURE_TAG_KDA_MIN_GAMES) {
    return null
  }

  const kdaCv = analysis.summary.kdaCv

  if (kdaCv <= SITUATION_FEATURE_TAG_KDA_STABLE_MAX_CV) {
    return { type: 'kda-stability', stable: true }
  }

  if (kdaCv >= SITUATION_FEATURE_TAG_KDA_VOLATILE_MIN_CV) {
    return { type: 'kda-stability', stable: false }
  }

  return null
}

/** gank 敏感标签：15 分钟前被敌方打野参与击杀的场均次数达到阈值（好抓/非常好抓） */
function getGankSensitivityTag(analysis: AggregatedAnalysis | null): SituationFeatureTag | null {
  const times = analysis?.details?.avgEarlyDeathsWithEnemyJunglerInvolved

  if (times === null || times === undefined) {
    return null
  }

  if (times > SITUATION_FEATURE_TAG_VERY_GANK_SENSITIVE_MIN_TIMES) {
    return { type: 'gank-sensitive', level: 'very-easy' }
  }

  if (times >= SITUATION_FEATURE_TAG_GANK_SENSITIVE_MIN_TIMES) {
    return { type: 'gank-sensitive', level: 'easy' }
  }

  return null
}

/** 闪现位置标签：近期在 D / F 两个位置都放置过闪现（与既有玩家卡"闪现异位"判定一致） */
function getSuspiciousFlashTag(analysis: AggregatedAnalysis | null): SituationFeatureTag | null {
  const spells = analysis?.spells

  if (!spells) {
    return null
  }

  return spells.flashOnD > 0 && spells.flashOnF > 0 ? { type: 'suspicious-flash' } : null
}

/** 预组队标签：组内人数达到阈值 */
function getPremadeTag(premadeGroupSize: number | null): SituationFeatureTag | null {
  if (premadeGroupSize === null || premadeGroupSize < SITUATION_FEATURE_TAG_PREMADE_MIN_SIZE) {
    return null
  }

  return { type: 'premade', size: premadeGroupSize }
}

/** 由预组队映射（puuid → 组标识）得出每个玩家所在组的人数 */
function getPremadeGroupSizes(premadeTeamMap: Record<string, number> | null): Map<string, number> {
  const groupSizes = new Map<string, number>()

  if (!premadeTeamMap) {
    return groupSizes
  }

  const counts = new Map<number, number>()
  for (const groupId of Object.values(premadeTeamMap)) {
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1)
  }

  for (const [puuid, groupId] of Object.entries(premadeTeamMap)) {
    groupSizes.set(puuid, counts.get(groupId) ?? 1)
  }

  return groupSizes
}

/**
 * 从威胁分排行中判定一支（或多支）队伍的头号玩家与次级玩家。
 * 与排行共用同一排序，仅样本资格规则会导致"排行第一却不是头号"。
 */
function computeTeamHighlight(
  sortedRankings: SituationPlayerThreat[],
  players: SituationReadPlayerInput[],
  teamIdentifiers: Set<string>,
  premadeGroupSizes: Map<string, number>,
  effectiveRanks: Map<string, SituationReadRankedSolo | null>,
  secondaryGap: number
): SituationReadHighlight | null {
  const playerInputs = new Map(players.map((player) => [player.puuid, player]))

  const eligible: (SituationPlayerThreat & { score: number })[] = []
  for (const entry of sortedRankings) {
    const { score } = entry
    if (score === null) {
      continue
    }
    if (!teamIdentifiers.has(entry.teamIdentifier)) {
      continue
    }
    if (!isEligibleForHighlight(playerInputs.get(entry.puuid), effectiveRanks.get(entry.puuid))) {
      continue
    }

    eligible.push({ ...entry, score })
  }

  if (!eligible.length) {
    return null
  }

  const [top, second] = eligible
  const topPlayer = playerInputs.get(top.puuid)

  return {
    puuid: top.puuid,
    teamIdentifier: top.teamIdentifier,
    score: top.score,
    secondary:
      second && isWithinSecondaryGap(top.score, second.score, secondaryGap)
        ? { puuid: second.puuid, score: second.score }
        : null,
    featureTags: selectFeatureTags({
      analysis: topPlayer?.analysis ?? null,
      premadeGroupSize: premadeGroupSizes.get(top.puuid) ?? null
    })
  }
}

/**
 * 评选资格：数据不足（无分）的玩家已在调用方排除；
 * 无本局相关段位（未定级/无段位）的玩家还需至少 3 场近期样本。
 */
function isEligibleForHighlight(
  player: SituationReadPlayerInput | undefined,
  effectiveRank: SituationReadRankedSolo | null | undefined
): boolean {
  if (!player) {
    return false
  }

  if (effectiveRank) {
    return true
  }

  return (player.analysis?.count ?? 0) >= SITUATION_MIN_ELIGIBLE_SAMPLE_COUNT
}

/** 分差阈值按一位小数整数比较，规避浮点误差（如 9.5 - 8.7） */
function isWithinSecondaryGap(topScore: number, secondScore: number, gap: number): boolean {
  return Math.round((topScore - secondScore) * 10) <= Math.round(gap * 10)
}

/**
 * 对位专报：识别"我"的位置并按视角产出定向分析。
 * - 分路玩家：同位置对手的最近表现与注意事项 + 敌方打野威胁小节；
 * - 打野玩家：对位部分替换为敌方各路易被抓排名；
 * 身份或位置无法识别时返回 null（渲染层隐藏专报小节）。
 */
function computeMatchupReport(
  players: SituationReadPlayerInput[],
  context: MatchupReadContext
): MatchupReport | null {
  if (!context.selfPuuid) {
    return null
  }

  const self = players.find((player) => player.puuid === context.selfPuuid)
  if (!self) {
    return null
  }

  const selfPosition = context.positionAssignments[context.selfPuuid] ?? ''
  if (!(MATCHUP_POSITIONS as readonly string[]).includes(selfPosition)) {
    return null
  }

  const enemies = players.filter((player) => player.teamIdentifier !== self.teamIdentifier)

  if (selfPosition === 'JUNGLE') {
    return {
      perspective: 'jungler',
      selfPosition,
      gankTargets: computeGankTargets(enemies, context.positionAssignments)
    }
  }

  const opponent = enemies.find(
    (player) => context.positionAssignments[player.puuid] === selfPosition
  )

  return {
    perspective: 'laner',
    selfPosition,
    opponent: opponent
      ? {
          puuid: opponent.puuid,
          teamIdentifier: opponent.teamIdentifier,
          rankedSolo: opponent.rankedSolo,
          recentGameCount: opponent.analysis?.count ?? null,
          recentWinRate: opponent.analysis ? opponent.analysis.summary.winRate : null,
          precautions: computeMatchupPrecautions(opponent.analysis, context)
        }
      : null,
    jungleThreat: computeJungleThreat(enemies, context, selfPosition, opponent ?? null)
  }
}

/**
 * 打野视角：敌方各路目标按场均早期被敌方打野参与的死亡降序排列。
 * 数据不足（无 details）的目标排在末尾并保持输入顺序，渲染层显示降级状态。
 */
function computeGankTargets(
  enemies: SituationReadPlayerInput[],
  positionAssignments: Record<string, string>
): MatchupGankTarget[] {
  const targets = enemies
    .map((player) => {
      const position = positionAssignments[player.puuid] ?? ''
      if (!(position in MATCHUP_POSITION_TO_LANE)) {
        return null
      }

      return {
        puuid: player.puuid,
        teamIdentifier: player.teamIdentifier,
        position,
        earlyGankDeaths: player.analysis?.details?.avgEarlyDeathsWithEnemyJunglerInvolved ?? null
      }
    })
    .filter((target): target is MatchupGankTarget => target !== null)

  return targets.toSorted((a, b) => {
    if (a.earlyGankDeaths === null && b.earlyGankDeaths === null) return 0
    if (a.earlyGankDeaths === null) return 1
    if (b.earlyGankDeaths === null) return -1
    return b.earlyGankDeaths - a.earlyGankDeaths
  })
}

/**
 * 敌方打野威胁小节：3 / 4 级 gank 率、偏好路与预组队联动的模板化预警。
 * 打野样本不足时输出降级状态（insufficientData），不产出行为类预警；
 * 预组队联动不依赖打野样本，降级状态下仍然生效。
 */
function computeJungleThreat(
  enemies: SituationReadPlayerInput[],
  context: MatchupReadContext,
  selfPosition: string,
  opponent: SituationReadPlayerInput | null
): MatchupJungleThreat | null {
  const enemyJungler = enemies.find(
    (player) => context.positionAssignments[player.puuid] === 'JUNGLE'
  )

  if (!enemyJungler) {
    return null
  }

  const jungle = enemyJungler.analysis?.jungle ?? null
  const insufficientData = !jungle || jungle.gamesAnalyzed < JUNGLE_THREAT_MIN_GAMES
  const precautions: MatchupJunglePrecaution[] = []

  if (!insufficientData && jungle) {
    const earlyGank = getEarlyGankPrecaution(jungle)
    if (earlyGank) {
      precautions.push(earlyGank)
    }

    const preferredLane = getPreferredLanePrecaution(jungle, selfPosition)
    if (preferredLane) {
      precautions.push(preferredLane)
    }
  }

  if (opponent && isInSamePremadeGroup(context.premadeGroups, opponent.puuid, enemyJungler.puuid)) {
    precautions.push({ kind: 'premade-link' })
  }

  return {
    puuid: enemyJungler.puuid,
    teamIdentifier: enemyJungler.teamIdentifier,
    insufficientData,
    precautions
  }
}

/** 3 / 4 级 gank 率预警：任一档位的 gank 率达到阈值 */
function getEarlyGankPrecaution(jungle: AggregatedJungleAnalysis): MatchupJunglePrecaution | null {
  const { level3GankRate, level4GankRate } = jungle.earlyGank

  if (
    level3GankRate < JUNGLE_THREAT_EARLY_GANK_RATE &&
    level4GankRate < JUNGLE_THREAT_EARLY_GANK_RATE
  ) {
    return null
  }

  return { kind: 'early-gank', level3GankRate, level4GankRate }
}

/** 偏好路预警：活动占比最高的路达到阈值；该路即我所在路时预警更明确 */
function getPreferredLanePrecaution(
  jungle: AggregatedJungleAnalysis,
  selfPosition: string
): MatchupJunglePrecaution | null {
  let preferredLane: MatchupLane | null = null
  let preferredRate = -1

  for (const [lane, key] of Object.entries(LANE_ZONE_PERCENTAGE_KEYS) as [
    MatchupLane,
    keyof AggregatedJungleAnalysis
  ][]) {
    const rate = jungle[key] as number
    if (rate > preferredRate) {
      preferredLane = lane
      preferredRate = rate
    }
  }

  if (preferredLane === null || preferredRate < JUNGLE_THREAT_PREFERRED_LANE_RATE) {
    return null
  }

  return MATCHUP_POSITION_TO_LANE[selfPosition] === preferredLane
    ? { kind: 'targets-self', lane: preferredLane }
    : { kind: 'preferred-lane', lane: preferredLane }
}

function isInSamePremadeGroup(premadeGroups: string[][], a: string, b: string): boolean {
  return premadeGroups.some((group) => group.includes(a) && group.includes(b))
}

/**
 * 注意事项规则：英雄克制（我已选定英雄时）+ 近期状态（连败 / 连胜 / 高胜率高 KDA，
 * 互斥取最强信号）+ 常用英雄粗分类。状态平庸时不产出状态类提示。
 */
function computeMatchupPrecautions(
  analysis: AggregatedAnalysis | null,
  context: MatchupReadContext
): MatchupPrecaution[] {
  if (!analysis) {
    return []
  }

  const precautions: MatchupPrecaution[] = [...getChampionCounterPrecautions(analysis, context)]
  const recentForm = getRecentFormPrecaution(analysis)

  if (recentForm) {
    precautions.push(recentForm)
  }

  precautions.push(...getChampionArchetypePrecautions(analysis, context.championRoles))

  return precautions
}

/**
 * 英雄克制规则：对手常用英雄中克制我当前英雄的，经注入的克制查询判定。
 * 我未选定英雄、未注入查询或无克制数据时不产出（不猜）。
 */
function getChampionCounterPrecautions(
  analysis: AggregatedAnalysis,
  context: MatchupReadContext
): MatchupPrecaution[] {
  const { selfChampionId, counterQuery } = context

  if (selfChampionId === null || !counterQuery) {
    return []
  }

  return getFrequentChampionIds(analysis)
    .map((championId) => ({ championId, relation: counterQuery(selfChampionId, championId) }))
    .filter(
      (item): item is { championId: number; relation: ChampionCounterRelation } =>
        item.relation !== null && item.relation.relationship === 'unfavorable'
    )
    .map(({ championId, relation }) => ({
      kind: 'champion-counter' as const,
      championId,
      winRate: relation.winRate
    }))
}

/** 近期状态规则；连败 > 连胜 > 状态火热，三者互斥 */
function getRecentFormPrecaution(analysis: AggregatedAnalysis): MatchupPrecaution | null {
  const normal = analysis.winLoss.normal

  if (normal.losingStreak >= MATCHUP_LOSING_STREAK_THRESHOLD) {
    return { kind: 'losing-streak', count: normal.losingStreak }
  }

  if (normal.winningStreak >= MATCHUP_WINNING_STREAK_THRESHOLD) {
    return { kind: 'winning-streak', count: normal.winningStreak }
  }

  if (
    analysis.count >= MATCHUP_HOT_STREAK_MIN_GAMES &&
    analysis.summary.winRate >= MATCHUP_HOT_STREAK_WIN_RATE &&
    analysis.summary.avgKda >= MATCHUP_HOT_STREAK_KDA
  ) {
    return { kind: 'hot-streak', winRate: analysis.summary.winRate, kda: analysis.summary.avgKda }
  }

  return null
}

/** 常用英雄：近期使用集中的前几个（按场次降序，至少 MATCHUP_FREQUENT_CHAMPION_MIN_GAMES 场） */
function getFrequentChampionIds(analysis: AggregatedAnalysis): number[] {
  return Object.values(analysis.champions)
    .filter((champion) => champion.winLoss.all.count >= MATCHUP_FREQUENT_CHAMPION_MIN_GAMES)
    .toSorted((a, b) => b.winLoss.all.count - a.winLoss.all.count)
    .slice(0, MATCHUP_FREQUENT_CHAMPION_COUNT)
    .map((champion) => champion.championId)
}

/** 英雄粗分类规则：对手常用英雄携带的 LCU roles 粗分类 → 类型提示（固定顺序去重） */
function getChampionArchetypePrecautions(
  analysis: AggregatedAnalysis,
  championRoles: Record<number, readonly string[]>
): MatchupPrecaution[] {
  const archetypes = new Set<string>()
  for (const championId of getFrequentChampionIds(analysis)) {
    for (const role of championRoles[championId] ?? []) {
      if ((MATCHUP_ARCHETYPE_ORDER as readonly string[]).includes(role)) {
        archetypes.add(role)
      }
    }
  }

  return MATCHUP_ARCHETYPE_ORDER.filter((archetype) => archetypes.has(archetype)).map(
    (archetype) => ({ kind: 'champion-archetype' as const, archetype })
  )
}

function computeThreatScore(
  effectiveRank: SituationReadRankedSolo | null,
  analysis: AggregatedAnalysis | null,
  isSuperServerGame: boolean,
  params: ThreatScoreParams
) {
  const baseline = getThreatScoreBaseline(effectiveRank, isSuperServerGame)
  const hasRecentGames = analysis !== null

  if (baseline === null && !hasRecentGames) {
    return null
  }

  const effectiveBaseline = compressBaseline(baseline ?? THREAT_SCORE_UNRANKED_BASELINE, params)
  const adjustment = getPerformanceAdjustment(analysis, params)

  return roundToOneDecimal(
    Math.min(THREAT_SCORE_MAX, Math.max(THREAT_SCORE_MIN, effectiveBaseline + adjustment))
  )
}

/**
 * 基线压缩：向中性中心收敛段位差距（灵活局）。系数为 1 时原样返回，单双/匹配局零漂移。
 */
function compressBaseline(baseline: number, params: ThreatScoreParams): number {
  if (params.baselineCompression === 1) {
    return baseline
  }

  return (
    THREAT_SCORE_BASELINE_COMPRESSION_CENTER +
    (baseline - THREAT_SCORE_BASELINE_COMPRESSION_CENTER) * params.baselineCompression
  )
}

/** 段位基线；未定级（且非峡谷之巅）返回 null 交由调用方结合样本判断 */
function getThreatScoreBaseline(
  rankedSolo: SituationReadRankedSolo | null,
  isSuperServerGame: boolean
): number | null {
  if (!rankedSolo) {
    return null
  }

  // 峡谷之巅按王者档
  if (isSuperServerGame) {
    return THREAT_SCORE_APEX_BASELINES.CHALLENGER
  }

  const apexBaseline =
    THREAT_SCORE_APEX_BASELINES[rankedSolo.tier as keyof typeof THREAT_SCORE_APEX_BASELINES]
  if (typeof apexBaseline === 'number') {
    return apexBaseline
  }

  const tierIndex = DIVISIONAL_TIERS.indexOf(rankedSolo.tier as (typeof DIVISIONAL_TIERS)[number])
  if (tierIndex === -1) {
    return null
  }

  const band =
    THREAT_SCORE_TIER_BANDS.find(
      (band) =>
        DIVISIONAL_TIERS.indexOf(band.fromTier as (typeof DIVISIONAL_TIERS)[number]) <= tierIndex &&
        tierIndex <= DIVISIONAL_TIERS.indexOf(band.toTier as (typeof DIVISIONAL_TIERS)[number])
    ) ?? null

  if (!band) {
    return null
  }

  const divisionIndex = DIVISION_INDICES[rankedSolo.division] ?? 0
  const step = DIVISIONAL_TIERS.indexOf(band.fromTier as (typeof DIVISIONAL_TIERS)[number]) * 4
  const rankFrom = step
  const rankTo = DIVISIONAL_TIERS.indexOf(band.toTier as (typeof DIVISIONAL_TIERS)[number]) * 4 + 3
  const rank = tierIndex * 4 + divisionIndex
  const ratio = (rank - rankFrom) / (rankTo - rankFrom)

  return band.fromScore + (band.toScore - band.fromScore) * ratio
}

/** 近期表现修正：胜率偏离 + Akari 评分，按参数组 clamp 后按样本量收缩 */
function getPerformanceAdjustment(analysis: AggregatedAnalysis | null, params: ThreatScoreParams) {
  if (!analysis || analysis.count <= 0) {
    return 0
  }

  const winRateAdjustment = (analysis.summary.winRate - 0.5) * params.winRateScale

  const akariRatio =
    analysis.akariScore.maxScore > 0 ? analysis.akariScore.total / analysis.akariScore.maxScore : 0
  const akariAdjustment = (akariRatio - THREAT_SCORE_AKARI_NEUTRAL_RATIO) * params.akariScale

  const clamped = Math.min(
    params.maxAdjustment,
    Math.max(-params.maxAdjustment, winRateAdjustment + akariAdjustment)
  )

  const shrinkFactor = Math.min(1, analysis.count / THREAT_SCORE_FULL_SAMPLE_COUNT)
  return clamped * shrinkFactor
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
