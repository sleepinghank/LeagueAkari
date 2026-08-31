import type { AggregatedAnalysis } from '@shared/data-adapter/analysis/player'
import type { RankedStats } from '@shared/types/league-client/ranked'

/**
 * 局势研判的纯函数计算层。
 *
 * 威胁分（0–10，一位小数）= 段位基线 + 近期表现修正：
 * - 基线来自单双排段位常量映射表（集中可调）；
 * - 修正由近期胜率偏离与 Akari 评分合成，上限 ±1.5；
 * - 样本不足 5 场时修正按样本量向基线收缩；
 * - 无段位且无近期战绩时输出"数据不足"哨兵（score 为 null）。
 *
 * 对位专报（Matchup Report）：自动识别"我"的位置与同位置敌方对手，
 * 产出最近表现摘要与模板化注意事项（近期状态 + 英雄粗分类规则）。
 */

/** 未定级（无单双排段位）玩家的基线 */
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

/** 近期表现修正的绝对值上限 */
export const THREAT_SCORE_MAX_ADJUSTMENT = 1.5

/** 修正不收缩所需的最小近期场次 */
export const THREAT_SCORE_FULL_SAMPLE_COUNT = 5

/** 胜率每偏离 50% 一个单位贡献的修正（胜率 100% → +1.0） */
export const THREAT_SCORE_WIN_RATE_ADJUSTMENT_SCALE = 2.0

/** Akari 评分比例每偏离中性锚点一个单位贡献的修正（满分 → +1.0） */
export const THREAT_SCORE_AKARI_ADJUSTMENT_SCALE = 2.0

/** Akari 评分比例的中性锚点（比例 = akariScore.total / akariScore.maxScore） */
export const THREAT_SCORE_AKARI_NEUTRAL_RATIO = 0.5

/** 威胁分上下限 */
export const THREAT_SCORE_MIN = 0
export const THREAT_SCORE_MAX = 10

/** 视为"未定级"的 tier 值 */
const UNRANKED_TIERS = new Set(['NA', 'NONE', ''])

/**
 * 峡谷之巅超级服（rsoPlatformId）的对局中，单双排段位实际水平按王者档计算。
 */
export const SUPER_SERVER_RSO_PLATFORM_ID = 'BGP2'

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

export interface SituationReadRankedSolo {
  tier: string
  division: string
}

export interface SituationReadPlayerInput {
  puuid: string
  teamIdentifier: string
  /** 单双排段位；未定级或无数据为 null。灵活组排段位不参与计算，仅展示 */
  rankedSolo: SituationReadRankedSolo | null
  /** 近期对局聚合分析；无战绩为 null */
  analysis: AggregatedAnalysis | null
}

export interface SituationPlayerThreat {
  puuid: string
  teamIdentifier: string
  /** 威胁分（0–10，一位小数）；null 表示数据不足 */
  score: number | null
}

/**
 * 对位专报的注意事项（特征标签 → 固定模板文案）。
 * - 近期状态类：连败 / 连胜 / 高胜率高 KDA（状态平庸时不产生）
 * - 英雄粗分类：对手常用英雄携带的 LCU roles 粗分类
 */
export type MatchupPrecaution =
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

export interface MatchupReport {
  /** 我的位置（TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY） */
  selfPosition: string
  /** 同位置敌方对手；敌方无同位置玩家时为 null */
  opponent: MatchupReportOpponent | null
}

/** 对位专报的计算上下文 */
export interface MatchupReadContext {
  /** 我的 puuid；无法识别为 null */
  selfPuuid: string | null
  /** puuid → 位置指派（选人或对局阶段）；值形如 TOP / NONE / FILL */
  positionAssignments: Record<string, string>
  /** championId → LCU 英雄数据自带的 roles 粗分类 */
  championRoles: Record<number, readonly string[]>
}

export interface SituationRead {
  /** 全部玩家，按威胁分降序排列；数据不足的玩家排在末尾（保持输入顺序） */
  threatRankings: SituationPlayerThreat[]
  /** 对位专报；身份 / 位置 / 对位者无法识别时为 null（小节隐藏） */
  matchupReport: MatchupReport | null
}

/**
 * 从段位数据中提取单双排段位条目；未定级或无数据返回 null。
 */
export function extractSoloRankedEntry(
  rankedStats: RankedStats | null | undefined
): SituationReadRankedSolo | null {
  const entry = rankedStats?.queueMap?.['RANKED_SOLO_5x5']

  if (!entry || !entry.tier || UNRANKED_TIERS.has(entry.tier)) {
    return null
  }

  return { tier: entry.tier, division: entry.division }
}

/**
 * 计算局势研判结果（敌我十人威胁分排行 + 对位专报）。
 * 纯函数，不依赖 IPC / 网络。
 */
export function computeSituationRead(options: {
  players: SituationReadPlayerInput[]
  /** 峡谷之巅超级服对局：单双排段位按王者档计算基线 */
  isSuperServerGame?: boolean
  /** 对位专报上下文；缺省时不产出专报 */
  matchup?: MatchupReadContext
}): SituationRead {
  const threatRankings = options.players.map((player) => ({
    puuid: player.puuid,
    teamIdentifier: player.teamIdentifier,
    score: computeThreatScore(player, Boolean(options.isSuperServerGame))
  }))

  return {
    threatRankings: threatRankings.toSorted((a, b) => {
      if (a.score === null && b.score === null) return 0
      if (a.score === null) return 1
      if (b.score === null) return -1
      return b.score - a.score
    }),
    matchupReport: options.matchup ? computeMatchupReport(options.players, options.matchup) : null
  }
}

/**
 * 对位专报：识别"我"的位置与同位置敌方对手，产出最近表现摘要与模板化注意事项。
 * 身份、位置或对位者无法识别时返回 null（渲染层隐藏专报小节）。
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

  const opponent = players.find(
    (player) =>
      player.teamIdentifier !== self.teamIdentifier &&
      context.positionAssignments[player.puuid] === selfPosition
  )

  if (!opponent) {
    return null
  }

  return {
    selfPosition,
    opponent: {
      puuid: opponent.puuid,
      teamIdentifier: opponent.teamIdentifier,
      rankedSolo: opponent.rankedSolo,
      recentGameCount: opponent.analysis?.count ?? null,
      recentWinRate: opponent.analysis ? opponent.analysis.summary.winRate : null,
      precautions: computeMatchupPrecautions(opponent.analysis, context.championRoles)
    }
  }
}

/**
 * 注意事项规则：近期状态（连败 / 连胜 / 高胜率高 KDA，互斥取最强信号）+ 常用英雄粗分类。
 * 状态平庸时不产出状态类提示。
 */
function computeMatchupPrecautions(
  analysis: AggregatedAnalysis | null,
  championRoles: Record<number, readonly string[]>
): MatchupPrecaution[] {
  if (!analysis) {
    return []
  }

  const precautions: MatchupPrecaution[] = []
  const recentForm = getRecentFormPrecaution(analysis)

  if (recentForm) {
    precautions.push(recentForm)
  }

  precautions.push(...getChampionArchetypePrecautions(analysis, championRoles))

  return precautions
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

/** 英雄粗分类规则：对手常用英雄携带的 LCU roles 粗分类 → 类型提示（固定顺序去重） */
function getChampionArchetypePrecautions(
  analysis: AggregatedAnalysis,
  championRoles: Record<number, readonly string[]>
): MatchupPrecaution[] {
  const frequentChampionIds = Object.values(analysis.champions)
    .filter((champion) => champion.winLoss.all.count >= MATCHUP_FREQUENT_CHAMPION_MIN_GAMES)
    .toSorted((a, b) => b.winLoss.all.count - a.winLoss.all.count)
    .slice(0, MATCHUP_FREQUENT_CHAMPION_COUNT)
    .map((champion) => champion.championId)

  const archetypes = new Set<string>()
  for (const championId of frequentChampionIds) {
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

function computeThreatScore(player: SituationReadPlayerInput, isSuperServerGame: boolean) {
  const baseline = getThreatScoreBaseline(player.rankedSolo, isSuperServerGame)
  const hasRecentGames = player.analysis !== null

  if (baseline === null && !hasRecentGames) {
    return null
  }

  const effectiveBaseline = baseline ?? THREAT_SCORE_UNRANKED_BASELINE
  const adjustment = getPerformanceAdjustment(player.analysis)

  return roundToOneDecimal(
    Math.min(THREAT_SCORE_MAX, Math.max(THREAT_SCORE_MIN, effectiveBaseline + adjustment))
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

/** 近期表现修正：胜率偏离 + Akari 评分，clamp 到 ±1.5 后按样本量收缩 */
function getPerformanceAdjustment(analysis: AggregatedAnalysis | null): number {
  if (!analysis || analysis.count <= 0) {
    return 0
  }

  const winRateAdjustment =
    (analysis.summary.winRate - 0.5) * THREAT_SCORE_WIN_RATE_ADJUSTMENT_SCALE

  const akariRatio =
    analysis.akariScore.maxScore > 0 ? analysis.akariScore.total / analysis.akariScore.maxScore : 0
  const akariAdjustment =
    (akariRatio - THREAT_SCORE_AKARI_NEUTRAL_RATIO) * THREAT_SCORE_AKARI_ADJUSTMENT_SCALE

  const clamped = Math.min(
    THREAT_SCORE_MAX_ADJUSTMENT,
    Math.max(-THREAT_SCORE_MAX_ADJUSTMENT, winRateAdjustment + akariAdjustment)
  )

  const shrinkFactor = Math.min(1, analysis.count / THREAT_SCORE_FULL_SAMPLE_COUNT)
  return clamped * shrinkFactor
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
