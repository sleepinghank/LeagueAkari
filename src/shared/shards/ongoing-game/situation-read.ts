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
 * 次级威胁（次级核心）的分差阈值：第二名与头号威胁分差不超过该值时才展示，覆盖双核阵容。
 */
export const SITUATION_SECONDARY_SCORE_GAP = 0.8

/**
 * 头号评选所需的最小近期样本：未定级玩家近期样本不足该数量时不参与评选（防新号小样本误判）。
 */
export const SITUATION_MIN_ELIGIBLE_SAMPLE_COUNT = 3

/**
 * 峡谷之巅超级服（rsoPlatformId）的对局中，单双排段位实际水平按王者档计算。
 */
export const SUPER_SERVER_RSO_PLATFORM_ID = 'BGP2'

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
}

export interface SituationRead {
  /** 全部玩家，按威胁分降序排列；数据不足的玩家排在末尾（保持输入顺序） */
  threatRankings: SituationPlayerThreat[]
  /** 敌方头号威胁；无敌方队伍或全员无评选资格时为 null */
  topThreat: SituationReadHighlight | null
  /** 我方核心大腿；无我方队伍或全员无评选资格时为 null */
  keyCarry: SituationReadHighlight | null
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
 * 计算局势研判结果：敌我十人威胁分排行、敌方头号威胁与我方核心大腿（含次级）。
 * 纯函数，不依赖 IPC / 网络。
 */
export function computeSituationRead(options: {
  players: SituationReadPlayerInput[]
  /** 我方（本地玩家所在）队伍标识；缺失时不产出头号卡 */
  selfTeamIdentifier?: string | null
  /** 峡谷之巅超级服对局：单双排段位按王者档计算基线 */
  isSuperServerGame?: boolean
}): SituationRead {
  const threatRankings = options.players.map((player) => ({
    puuid: player.puuid,
    teamIdentifier: player.teamIdentifier,
    score: computeThreatScore(player, Boolean(options.isSuperServerGame))
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

  return {
    threatRankings: sortedRankings,
    topThreat: computeTeamHighlight(sortedRankings, options.players, enemyTeamIdentifiers),
    keyCarry: selfTeamIdentifier
      ? computeTeamHighlight(sortedRankings, options.players, new Set([selfTeamIdentifier]))
      : null
  }
}

/**
 * 从威胁分排行中判定一支（或多支）队伍的头号玩家与次级玩家。
 * 与排行共用同一排序，仅样本资格规则会导致"排行第一却不是头号"。
 */
function computeTeamHighlight(
  sortedRankings: SituationPlayerThreat[],
  players: SituationReadPlayerInput[],
  teamIdentifiers: Set<string>
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
    if (!isEligibleForHighlight(playerInputs.get(entry.puuid))) {
      continue
    }

    eligible.push({ ...entry, score })
  }

  if (!eligible.length) {
    return null
  }

  const [top, second] = eligible

  return {
    puuid: top.puuid,
    teamIdentifier: top.teamIdentifier,
    score: top.score,
    secondary:
      second && isWithinSecondaryGap(top.score, second.score)
        ? { puuid: second.puuid, score: second.score }
        : null
  }
}

/** 评选资格：数据不足（无分）的玩家已在调用方排除；未定级玩家还需至少 3 场近期样本 */
function isEligibleForHighlight(player: SituationReadPlayerInput | undefined): boolean {
  if (!player) {
    return false
  }

  if (player.rankedSolo) {
    return true
  }

  return (player.analysis?.count ?? 0) >= SITUATION_MIN_ELIGIBLE_SAMPLE_COUNT
}

/** 分差阈值按一位小数整数比较，规避浮点误差（如 9.5 - 8.7） */
function isWithinSecondaryGap(topScore: number, secondScore: number): boolean {
  return Math.round((topScore - secondScore) * 10) <= Math.round(SITUATION_SECONDARY_SCORE_GAP * 10)
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
