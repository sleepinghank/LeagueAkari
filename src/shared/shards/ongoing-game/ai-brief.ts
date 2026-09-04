import type { AggregatedAnalysis } from '@shared/data-adapter/analysis/player'
import { QueueEnum } from '@shared/types/league-client/game-data'
import type { RankedStats } from '@shared/types/league-client/ranked'
import type { SummonerInfo } from '@shared/types/league-client/summoner'

import {
  SITUATION_SECONDARY_SCORE_GAP,
  SITUATION_SECONDARY_SCORE_GAP_FLEX,
  type SituationFeatureTag,
  type SituationPlayerThreat,
  type SituationReadModeTier,
  type SituationReadRankedSolo,
  THREAT_SCORE_APEX_BASELINES,
  THREAT_SCORE_BASELINE_COMPRESSION_CENTER,
  THREAT_SCORE_FLEX_PARAMS,
  THREAT_SCORE_FULL_SAMPLE_COUNT,
  THREAT_SCORE_SOLO_PARAMS,
  THREAT_SCORE_TIER_BANDS,
  THREAT_SCORE_UNRANKED_BASELINE,
  extractFlexRankedEntry,
  extractSoloRankedEntry,
  getEffectiveRankedEntry,
  getPremadeGroupSizes,
  isFlexQueue,
  selectFeatureTags
} from './situation-read'

/** DeepSeek 官方 OpenAI 兼容端点（Base URL 可在设置中改为中转地址） */
export const AI_BRIEF_DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** 默认模型 */
export const AI_BRIEF_DEFAULT_MODEL = 'deepseek-chat'

/** 简报（我方/敌方）的目标输出语言（跟随界面语言） */
export type AiBriefLanguage = 'zh-CN' | 'en'

/** 提示词中的本局队列类型：决定评分标准描述选用哪套参数 */
export type AiBriefQueueKind = 'solo' | 'flex'

/**
 * 本局队列 → 评分标准描述选套：灵活排位（440）用灵活局参数，
 * 单双排（420）、匹配（430）与大乱斗（450）等其余队列沿用单双/匹配参数。
 */
export function getAiBriefQueueKind(queueId: number | null | undefined): AiBriefQueueKind {
  return queueId === QueueEnum.RANK_FLEX ? 'flex' : 'solo'
}

/**
 * 简报请求的错误三分类（与 DeepSeek 客户端的归一结果一致）：
 * 配置错误（key 无效）/ 网络错误 / 超时。
 */
export type AiBriefErrorType = 'config' | 'network' | 'timeout'

/**
 * 单份简报的同步状态（我方简报与敌方简报同构）：
 * 加载占位 / Markdown 内容 / 一行错误文案。
 * 主进程生成并经既有状态同步机制暴露给渲染层；null 表示本局无该简报区域。
 */
export type AiBriefStatus =
  | { status: 'loading' }
  | { status: 'success'; content: string }
  | { status: 'error'; errorType: AiBriefErrorType }

/** 自动重试时间表（两份简报各自独立）：首次失败后间隔 5s、15s 各重试一次，仍失败即终态 */
export const AI_BRIEF_RETRY_DELAYS_MS = [5_000, 15_000] as const

/**
 * 界面语言 → 提示词输出语言：以 zh 开头的 locale 输出简体中文，其余输出英文。
 */
export function getAiBriefLanguage(locale: string | null | undefined): AiBriefLanguage {
  return (locale ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** 单个玩家的简报数据（已由调用方从研判状态解析，不含 IPC / 网络依赖） */
export interface AiBriefPlayerInput {
  /** 召唤师昵称 */
  name: string
  /** 位置指派（TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY）；大乱斗等无位置对局为 null */
  position: string | null
  /** 本局已锁定的英雄；未锁定为 null */
  championId: number | null
  /** 本局相关段位；未定级或无数据为 null */
  ranked: SituationReadRankedSolo | null
  /** 威胁分；数据不足为 null */
  threatScore: number | null
  /** 近期胜率（0–1）；无战绩为 null */
  recentWinRate: number | null
  /** 近期场次；无战绩为 null */
  recentGameCount: number | null
  /** Akari 评分（total，满分约 16.67）；无战绩为 null */
  akariScore: number | null
  /** 特征标签（调用方按固定优先级给出，最多取前 3 个外发） */
  featureTags: SituationFeatureTag[]
  /** 预组队组标识（同组即预组队）；无预组队为 null */
  premadeGroupId: number | null
}

/**
 * 我方简报输入：只含我方玩家与我方上下文，不含任何敌方玩家——
 * 敌方信息留给进游戏后的敌方简报。
 */
export interface AllyBriefInput {
  /** 目标输出语言 */
  language: AiBriefLanguage
  /** 本局队列；null 时按单双/匹配描述 */
  queueId: number | null
  /** 展示档位：basic（大乱斗）裁剪位置维度；hidden 不生成简报 */
  modeTier: Exclude<SituationReadModeTier, 'hidden'>
  /** 我的上下文 */
  self: {
    position: string | null
    championId: number | null
  }
  /** championId → 英雄显示名（来自 LCU 英雄数据）；缺失时回退为 #<id> */
  championNames: Record<number, string>
  /** 我方玩家的研判数据 */
  players: AiBriefPlayerInput[]
}

/** OpenAI 兼容的消息结构，DeepSeek 客户端直接作为请求体使用（两份简报共用） */
export interface AiBriefMessage {
  role: 'system' | 'user'
  content: string
}

const POSITION_LABELS: Record<AiBriefLanguage, Record<string, string>> = {
  'zh-CN': {
    TOP: '上单',
    JUNGLE: '打野',
    MIDDLE: '中单',
    BOTTOM: '下路',
    UTILITY: '辅助'
  },
  en: {
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MIDDLE: 'Mid',
    BOTTOM: 'ADC',
    UTILITY: 'Support'
  }
}

const TIER_LABELS: Record<AiBriefLanguage, Record<string, string>> = {
  'zh-CN': {
    IRON: '黑铁',
    BRONZE: '青铜',
    SILVER: '白银',
    GOLD: '黄金',
    PLATINUM: '铂金',
    EMERALD: '翡翠',
    DIAMOND: '钻石',
    MASTER: '大师',
    GRANDMASTER: '宗师',
    CHALLENGER: '王者'
  },
  en: {
    IRON: 'Iron',
    BRONZE: 'Bronze',
    SILVER: 'Silver',
    GOLD: 'Gold',
    PLATINUM: 'Platinum',
    EMERALD: 'Emerald',
    DIAMOND: 'Diamond',
    MASTER: 'Master',
    GRANDMASTER: 'Grandmaster',
    CHALLENGER: 'Challenger'
  }
}

/** 大师以上无小段位 */
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER'])

const INSUFFICIENT_DATA_LABELS: Record<AiBriefLanguage, string> = {
  'zh-CN': '数据不足',
  en: 'insufficient data'
}

/** 提示词中的参数数值统一保留一位小数（2 → “2.0”），压缩系数保留两位（0.3 → “0.30”） */
function formatScale(value: number, fractionDigits = 1): string {
  return value.toFixed(fractionDigits)
}

function getModeLabel(language: AiBriefLanguage, input: AllyBriefInput): string {
  if (input.modeTier === 'basic') {
    return language === 'zh-CN' ? '极地大乱斗' : 'ARAM'
  }

  if (language === 'zh-CN') {
    if (input.queueId === QueueEnum.RANK_SOLO) return '单双排位'
    if (input.queueId === QueueEnum.RANK_FLEX) return '灵活排位'
    if (input.queueId === 430) return '匹配模式'
    return '召唤师峡谷'
  }

  if (input.queueId === QueueEnum.RANK_SOLO) return 'Ranked Solo/Duo'
  if (input.queueId === QueueEnum.RANK_FLEX) return 'Ranked Flex'
  if (input.queueId === 430) return 'Normal'
  return "Summoner's Rift"
}

function getPositionLabel(language: AiBriefLanguage, position: string | null): string | null {
  if (!position) {
    return null
  }

  return POSITION_LABELS[language][position] ?? position
}

function getRankLabel(
  language: AiBriefLanguage,
  ranked: SituationReadRankedSolo | null
): string | null {
  if (!ranked) {
    return null
  }

  const tierLabel = TIER_LABELS[language][ranked.tier] ?? ranked.tier
  return APEX_TIERS.has(ranked.tier) ? tierLabel : `${tierLabel} ${ranked.division}`
}

function getChampionLabel(input: AllyBriefInput, championId: number | null): string | null {
  if (championId === null) {
    return null
  }

  return input.championNames[championId] ?? `#${championId}`
}

function getFeatureTagLabel(
  language: AiBriefLanguage,
  tag: SituationFeatureTag,
  championNames: Record<number, string>
): string {
  switch (tag.type) {
    case 'losing-streak':
      return language === 'zh-CN' ? `${tag.count} 连败` : `${tag.count}-game losing streak`
    case 'winning-streak':
      return language === 'zh-CN' ? `${tag.count} 连胜` : `${tag.count}-game winning streak`
    case 'high-win-rate':
      return language === 'zh-CN' ? '极高胜率' : 'very high win rate'
    case 'favorite-champion': {
      const championName = championNames[tag.championId] ?? `#${tag.championId}`
      return language === 'zh-CN' ? `常用 ${championName}` : `frequently plays ${championName}`
    }
    case 'kda-stability':
      if (language === 'zh-CN') {
        return tag.stable ? '发挥稳定' : '状态起伏'
      }
      return tag.stable ? 'consistent performance' : 'volatile performance'
    case 'gank-sensitive':
      if (language === 'zh-CN') {
        return tag.level === 'easy' ? '好抓' : '非常好抓'
      }
      return tag.level === 'easy' ? 'easy to gank' : 'very easy to gank'
    case 'suspicious-flash':
      return language === 'zh-CN' ? '闪现异位' : 'inconsistent flash placement'
    case 'premade':
      return language === 'zh-CN' ? `预组队 ${tag.size} 人` : `premade of ${tag.size}`
  }
}

function getScoringStandardSection(language: AiBriefLanguage, queueKind: AiBriefQueueKind): string {
  const soloScaleFrom = formatScale(THREAT_SCORE_TIER_BANDS[0].fromScore)
  const soloScaleTo = formatScale(THREAT_SCORE_APEX_BASELINES.CHALLENGER)
  const unrankedBaseline = formatScale(THREAT_SCORE_UNRANKED_BASELINE)

  if (language === 'zh-CN') {
    return queueKind === 'flex'
      ? [
          '- 威胁分 = 段位基线 + 近期表现修正；灵活排位压缩段位影响，以近期表现主导排序；',
          `- 段位基线先按与单双排相同的段位区间映射（${soloScaleFrom}–${soloScaleTo}，未定级 ${unrankedBaseline}），再向中性值压缩：基线′ = ${formatScale(THREAT_SCORE_BASELINE_COMPRESSION_CENTER)} + (基线 − ${formatScale(THREAT_SCORE_BASELINE_COMPRESSION_CENTER)}) × ${formatScale(THREAT_SCORE_FLEX_PARAMS.baselineCompression, 2)}；`,
          `- 近期表现修正 = 胜率偏离 50% 的部分 × ${formatScale(THREAT_SCORE_FLEX_PARAMS.winRateScale)} + Akari 评分偏离中性的部分 × ${formatScale(THREAT_SCORE_FLEX_PARAMS.akariScale)}，上限 ±${formatScale(THREAT_SCORE_FLEX_PARAMS.maxAdjustment)}；`,
          `- 近期场次不足 ${THREAT_SCORE_FULL_SAMPLE_COUNT} 场时，修正按样本量向基线收缩；`,
          `- 次级威胁：同队威胁分第二名与最高分分差不超过 ${formatScale(SITUATION_SECONDARY_SCORE_GAP_FLEX)} 时视为双核。`
        ].join('\n')
      : [
          '- 威胁分 = 段位基线 + 近期表现修正，以段位为主导；',
          `- 段位基线由段位映射到 ${soloScaleFrom}（黑铁最低）至 ${soloScaleTo}（王者最高），未定级基线为 ${unrankedBaseline}；`,
          `- 近期表现修正 = 胜率偏离 50% 的部分 × ${formatScale(THREAT_SCORE_SOLO_PARAMS.winRateScale)} + Akari 评分偏离中性的部分 × ${formatScale(THREAT_SCORE_SOLO_PARAMS.akariScale)}，上限 ±${formatScale(THREAT_SCORE_SOLO_PARAMS.maxAdjustment)}；`,
          `- 近期场次不足 ${THREAT_SCORE_FULL_SAMPLE_COUNT} 场时，修正按样本量向基线收缩；`,
          `- 次级威胁：同队威胁分第二名与最高分分差不超过 ${formatScale(SITUATION_SECONDARY_SCORE_GAP)} 时视为双核。`
        ].join('\n')
  }

  return queueKind === 'flex'
    ? [
        `- Threat score = rank baseline + recent-performance adjustment. In ranked flex, rank influence is compressed and recent performance dominates.`,
        `- The rank baseline is first mapped with the same tier scale as solo queue (${soloScaleFrom}–${soloScaleTo}, unranked ${unrankedBaseline}), then compressed toward the neutral value: baseline' = ${formatScale(THREAT_SCORE_BASELINE_COMPRESSION_CENTER)} + (baseline − ${formatScale(THREAT_SCORE_BASELINE_COMPRESSION_CENTER)}) × ${formatScale(THREAT_SCORE_FLEX_PARAMS.baselineCompression, 2)}.`,
        `- The recent-performance adjustment = (win rate deviation from 50%) × ${formatScale(THREAT_SCORE_FLEX_PARAMS.winRateScale)} + (Akari score deviation from neutral) × ${formatScale(THREAT_SCORE_FLEX_PARAMS.akariScale)}, capped at ±${formatScale(THREAT_SCORE_FLEX_PARAMS.maxAdjustment)}.`,
        `- With fewer than ${THREAT_SCORE_FULL_SAMPLE_COUNT} recent games, the adjustment shrinks toward the baseline proportionally to the sample size.`,
        `- Secondary threat: a teammate within ${formatScale(SITUATION_SECONDARY_SCORE_GAP_FLEX)} of the highest threat score counts as a second core.`
      ].join('\n')
    : [
        `- Threat score = rank baseline + recent-performance adjustment, with rank as the dominant factor.`,
        `- The rank baseline maps tiers onto ${soloScaleFrom} (lowest, Iron) to ${soloScaleTo} (highest, Challenger); unranked players use ${unrankedBaseline}.`,
        `- The recent-performance adjustment = (win rate deviation from 50%) × ${formatScale(THREAT_SCORE_SOLO_PARAMS.winRateScale)} + (Akari score deviation from neutral) × ${formatScale(THREAT_SCORE_SOLO_PARAMS.akariScale)}, capped at ±${formatScale(THREAT_SCORE_SOLO_PARAMS.maxAdjustment)}.`,
        `- With fewer than ${THREAT_SCORE_FULL_SAMPLE_COUNT} recent games, the adjustment shrinks toward the baseline proportionally to the sample size.`,
        `- Secondary threat: a teammate within ${formatScale(SITUATION_SECONDARY_SCORE_GAP)} of the highest threat score counts as a second core.`
      ].join('\n')
}

function getSystemPrompt(language: AiBriefLanguage, input: AllyBriefInput): string {
  const queueKind = getAiBriefQueueKind(input.queueId)
  const modeLabel = getModeLabel(language, input)
  const isBasic = input.modeTier === 'basic'

  if (language === 'zh-CN') {
    const dimensionLine = isBasic
      ? '3. 每条结论综合五个维度评估：英雄玩法（定位、强势期、节奏）、玩家风格（近期战绩、常用英雄）、段位与胜率、威胁分。'
      : '3. 每条结论综合五个维度评估：英雄玩法（定位、强势期、节奏）、玩家风格（近期战绩、常用英雄）、位置、段位与胜率、威胁分。'

    return [
      '你是《英雄联盟》开局局势解读助手。用户正处于一局游戏的选人阶段，你将收到用户所在队伍（下称“我方”）五名玩家的局势研判数据，请为用户（下称“我”）生成一段我方简报，帮助其在进入游戏前了解队伍并规划本局配合。',
      '',
      '【背景设定】',
      '- 威胁分：本地工具对玩家综合实力的评估，0–10 分，分数越高越可能左右胜负；',
      '- Akari 评分：近期发挥评分，满分约 16.67，分数越高近期状态越好，不含段位因素。',
      '',
      `【威胁分评分标准 · ${modeLabel}】`,
      getScoringStandardSection(language, queueKind),
      '',
      '【输出要求】',
      '1. 使用简体中文撰写。',
      '2. 输出 3–5 条总纲式综合研判与打法建议，不逐人罗列（逐人数据用户已可在界面查看）。',
      dimensionLine,
      '4. 聚焦对“我”与团队有利的内容：队伍实力结构（谁可能 carry、谁需要帮助）、配合预期（预组队关系）、本局节奏建议。',
      '5. 结论性判断（如我方核心大腿）一律以数据中的威胁分排序为准，不得另立排名。',
      '6. 玩家数据中 champion 为 null 表示尚未锁定英雄，跳过英雄相关分析；显示“数据不足”表示无战绩数据，跳过战绩相关分析。'
    ].join('\n')
  }

  const dimensionLine = isBasic
    ? '3. Ground every conclusion in five dimensions: champion playstyle (role, power spikes, tempo), player style (recent results, most-played champions), rank and win rate, and threat score.'
    : '3. Ground every conclusion in five dimensions: champion playstyle (role, power spikes, tempo), player style (recent results, most-played champions), position, rank and win rate, and threat score.'

  return [
    'You are a League of Legends pre-game situation analyst. The user is in the champion select phase of a match and will receive situation-read data for the five players on their own team ("our team") below. Write an ally brief that helps the user ("me") understand the team and plan coordination before the game starts.',
    '',
    '[Background]',
    "- Threat score: a local assessment of a player's overall strength, 0–10; the higher the score, the more likely the player swings the game.",
    '- Akari score: a recent-form rating with a maximum of about 16.67; higher means better recent form. It does not include rank.',
    '',
    `[Threat score standard · ${modeLabel}]`,
    getScoringStandardSection(language, queueKind),
    '',
    '[Output requirements]',
    '1. Write in English.',
    '2. Produce 3–5 overarching analytical takeaways with gameplay advice; do not list players one by one (per-player data is already visible in the app).',
    dimensionLine,
    '4. Focus on what benefits "me" and the team: team strength structure (who can carry, who needs help), coordination expectations (premade relations), and tempo advice for this game.',
    '5. Conclusive judgements (such as the key carry) must follow the threat scores given in the data — you must not establish your own rankings.',
    '6. A null champion means the player has not locked a champion yet — skip champion-specific analysis for them; "insufficient data" means no match history — skip performance analysis for them.'
  ].join('\n')
}

function buildUserPayload(language: AiBriefLanguage, input: AllyBriefInput) {
  const insufficientData = INSUFFICIENT_DATA_LABELS[language]
  const isBasic = input.modeTier === 'basic'

  return {
    mode: getModeLabel(language, input),
    self: isBasic
      ? { champion: getChampionLabel(input, input.self.championId) }
      : {
          position: getPositionLabel(language, input.self.position),
          champion: getChampionLabel(input, input.self.championId)
        },
    players: input.players.map((player) => {
      const record: Record<string, unknown> = {
        name: player.name
      }

      if (!isBasic) {
        record.position = getPositionLabel(language, player.position)
      }

      record.champion = getChampionLabel(input, player.championId)
      record.rank = getRankLabel(language, player.ranked)
      record.threatScore = player.threatScore ?? insufficientData
      record.recentWinRate = player.recentWinRate ?? insufficientData
      record.recentGameCount = player.recentGameCount ?? insufficientData
      record.akariScore = player.akariScore ?? insufficientData
      record.featureTags = player.featureTags
        .slice(0, 3)
        .map((tag) => getFeatureTagLabel(language, tag, input.championNames))
      record.premadeGroup = player.premadeGroupId

      return record
    })
  }
}

/**
 * 构建我方简报的提示词（system + user 消息数组）。
 * 纯函数，无 IPC / 网络依赖；user 消息为我方研判数据的 JSON 序列化，
 * 外发字段与设置区隐私说明披露的清单一致，且不含任何敌方玩家。
 */
export function buildAllyBriefMessages(input: AllyBriefInput): AiBriefMessage[] {
  return [
    { role: 'system', content: getSystemPrompt(input.language, input) },
    { role: 'user', content: JSON.stringify(buildUserPayload(input.language, input), null, 2) }
  ]
}

/** 组装我方简报输入所需的对局快照（主进程从既有状态收集） */
export interface AllyBriefSource {
  language: AiBriefLanguage
  /** 本局队列（来自对局阶段 gameInfo） */
  queueId: number | null
  /** 展示档位；hidden 模式不生成简报（调用方不触发） */
  modeTier: Exclude<SituationReadModeTier, 'hidden'>
  /** 我的 puuid；无法识别为 null */
  selfPuuid: string | null
  /** 队伍标识 → puuid 列表（既有 teams 状态，含敌方队伍；只序列化我方队伍） */
  teams: Record<string, string[]>
  /** puuid → 召唤师信息（昵称来源） */
  summoners: Record<string, Pick<SummonerInfo, 'gameName' | 'displayName'> | undefined>
  /** puuid → 本局已锁定英雄 */
  championSelections: Record<string, number>
  /** puuid → 位置指派（原样，含 NONE / FILL 等未识别值） */
  positionAssignments: Record<string, string>
  /** puuid → 段位数据（本局相关段位按队列从中提取） */
  rankedStats: Record<string, RankedStats | undefined>
  /** puuid → 近期对局聚合分析；无战绩为缺失 */
  analysis: Record<string, AggregatedAnalysis> | null
  /** 预组队映射（puuid → 组标识），来自既有预组队推断 */
  premadeTeamMap: Record<string, number>
  /** 威胁分排行（既有研判结果），用于按 puuid 查威胁分 */
  threatRankings: SituationPlayerThreat[]
  /** championId → 英雄显示名（来自 LCU 英雄数据） */
  championNames: Record<number, string>
}

/** 位置指派规范化：未指派（空 / NONE）视为无位置 */
function normalizePosition(position: string | undefined): string | null {
  return !position || position === 'NONE' ? null : position
}

function getPlayerDisplayName(
  summoner: Pick<SummonerInfo, 'gameName' | 'displayName'> | undefined,
  puuid: string
): string {
  return summoner?.gameName || summoner?.displayName || puuid
}

/**
 * 从对局快照组装我方简报输入：定位我方队伍、昵称回退、按队列取本局相关段位、
 * 威胁分与近期表现取数、特征标签与预组队关系。纯函数，无 IPC / 网络依赖，
 * 字段取数与研判卡同源（威胁分排行、selectFeatureTags、getEffectiveRankedEntry）。
 * 只序列化我所在队伍的玩家；无法定位我时不含任何玩家。
 */
export function buildAllyBriefInput(source: AllyBriefSource): AllyBriefInput {
  const isFlexQueueGame = isFlexQueue(source.queueId)
  const selfTeamIdentifier = source.selfPuuid
    ? (Object.entries(source.teams).find(([, puuids]) => puuids.includes(source.selfPuuid!))?.[0] ??
      null)
    : null
  const threatScores = new Map(source.threatRankings.map((entry) => [entry.puuid, entry.score]))
  const premadeGroupSizes = getPremadeGroupSizes(source.premadeTeamMap)

  const players: AiBriefPlayerInput[] = []

  for (const puuid of selfTeamIdentifier ? (source.teams[selfTeamIdentifier] ?? []) : []) {
    const analysis = source.analysis?.[puuid] ?? null
    const rankedStats = source.rankedStats[puuid]

    players.push({
      name: getPlayerDisplayName(source.summoners[puuid], puuid),
      position: normalizePosition(source.positionAssignments[puuid]),
      championId: source.championSelections[puuid] || null,
      ranked: getEffectiveRankedEntry(
        extractFlexRankedEntry(rankedStats),
        extractSoloRankedEntry(rankedStats),
        isFlexQueueGame
      ),
      threatScore: threatScores.get(puuid) ?? null,
      recentWinRate: analysis ? analysis.summary.winRate : null,
      recentGameCount: analysis ? analysis.count : null,
      akariScore: analysis ? analysis.akariScore.total : null,
      featureTags: selectFeatureTags({
        analysis,
        premadeGroupSize: premadeGroupSizes.get(puuid) ?? null
      }),
      premadeGroupId: source.premadeTeamMap[puuid] ?? null
    })
  }

  return {
    language: source.language,
    queueId: source.queueId,
    modeTier: source.modeTier,
    self: {
      position: normalizePosition(
        source.selfPuuid ? source.positionAssignments[source.selfPuuid] : undefined
      ),
      championId:
        (source.selfPuuid ? source.championSelections[source.selfPuuid] : undefined) || null
    },
    championNames: source.championNames,
    players
  }
}
