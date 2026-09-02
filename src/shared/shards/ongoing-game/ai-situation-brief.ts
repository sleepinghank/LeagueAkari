import { QueueEnum } from '@shared/types/league-client/game-data'

import {
  SITUATION_SECONDARY_SCORE_GAP,
  SITUATION_SECONDARY_SCORE_GAP_FLEX,
  type SituationFeatureTag,
  type SituationReadModeTier,
  type SituationReadRankedSolo,
  THREAT_SCORE_APEX_BASELINES,
  THREAT_SCORE_BASELINE_COMPRESSION_CENTER,
  THREAT_SCORE_FLEX_PARAMS,
  THREAT_SCORE_FULL_SAMPLE_COUNT,
  THREAT_SCORE_SOLO_PARAMS,
  THREAT_SCORE_TIER_BANDS,
  THREAT_SCORE_UNRANKED_BASELINE
} from './situation-read'

/** DeepSeek 官方 OpenAI 兼容端点（Base URL 可在设置中改为中转地址） */
export const AI_SITUATION_BRIEF_DEFAULT_BASE_URL = 'https://api.deepseek.com'

/** 默认模型 */
export const AI_SITUATION_BRIEF_DEFAULT_MODEL = 'deepseek-chat'

/** AI 研判总结的目标输出语言（跟随界面语言） */
export type AiSituationBriefLanguage = 'zh-CN' | 'en'

/** 提示词中的本局队列类型：决定评分标准描述选用哪套参数 */
export type AiSituationBriefQueueKind = 'solo' | 'flex'

/**
 * 本局队列 → 评分标准描述选套：灵活排位（440）用灵活局参数，
 * 单双排（420）、匹配（430）与大乱斗（450）等其余队列沿用单双/匹配参数。
 */
export function getAiSituationBriefQueueKind(
  queueId: number | null | undefined
): AiSituationBriefQueueKind {
  return queueId === QueueEnum.RANK_FLEX ? 'flex' : 'solo'
}

/** 单个玩家的研判数据（已由调用方从研判状态解析，不含 IPC / 网络依赖） */
export interface AiSituationBriefPlayerInput {
  /** 召唤师昵称 */
  name: string
  /** 是否与我同队 */
  isAlly: boolean
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

export interface AiSituationBriefInput {
  /** 目标输出语言 */
  language: AiSituationBriefLanguage
  /** 本局队列；null 时按单双/匹配描述 */
  queueId: number | null
  /** 展示档位：basic（大乱斗）裁剪位置与对位/打野相关内容；hidden 不生成总结 */
  modeTier: Exclude<SituationReadModeTier, 'hidden'>
  /** 我方上下文 */
  self: {
    position: string | null
    championId: number | null
  }
  /** championId → 英雄显示名（来自 LCU 英雄数据）；缺失时回退为 #<id> */
  championNames: Record<number, string>
  /** 十人研判数据 */
  players: AiSituationBriefPlayerInput[]
}

/** OpenAI 兼容的消息结构，DeepSeek 客户端直接作为请求体使用 */
export interface AiSituationBriefMessage {
  role: 'system' | 'user'
  content: string
}

const POSITION_LABELS: Record<AiSituationBriefLanguage, Record<string, string>> = {
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

const TIER_LABELS: Record<AiSituationBriefLanguage, Record<string, string>> = {
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

const INSUFFICIENT_DATA_LABELS: Record<AiSituationBriefLanguage, string> = {
  'zh-CN': '数据不足',
  en: 'insufficient data'
}

/** 提示词中的参数数值统一保留一位小数（2 → “2.0”），压缩系数保留两位（0.3 → “0.30”） */
function formatScale(value: number, fractionDigits = 1): string {
  return value.toFixed(fractionDigits)
}

function getModeLabel(language: AiSituationBriefLanguage, input: AiSituationBriefInput): string {
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

function getPositionLabel(
  language: AiSituationBriefLanguage,
  position: string | null
): string | null {
  if (!position) {
    return null
  }

  return POSITION_LABELS[language][position] ?? position
}

function getRankLabel(
  language: AiSituationBriefLanguage,
  ranked: SituationReadRankedSolo | null
): string | null {
  if (!ranked) {
    return null
  }

  const tierLabel = TIER_LABELS[language][ranked.tier] ?? ranked.tier
  return APEX_TIERS.has(ranked.tier) ? tierLabel : `${tierLabel} ${ranked.division}`
}

function getChampionLabel(input: AiSituationBriefInput, championId: number | null): string | null {
  if (championId === null) {
    return null
  }

  return input.championNames[championId] ?? `#${championId}`
}

function getFeatureTagLabel(
  language: AiSituationBriefLanguage,
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

function getScoringStandardSection(
  language: AiSituationBriefLanguage,
  queueKind: AiSituationBriefQueueKind
): string {
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

function getSystemPrompt(language: AiSituationBriefLanguage, input: AiSituationBriefInput): string {
  const queueKind = getAiSituationBriefQueueKind(input.queueId)
  const modeLabel = getModeLabel(language, input)
  const isBasic = input.modeTier === 'basic'

  if (language === 'zh-CN') {
    const focusLine = isBasic
      ? '4. 聚焦对“我”有利的信息与应对建议：头号威胁怎么应对、资源该向谁倾斜。'
      : '4. 聚焦对“我”有利的信息与应对建议：头号威胁怎么应对、我对线的人怎么打、敌方打野大概几级可能来抓、资源该向谁倾斜。'

    return [
      '你是《英雄联盟》开局局势解读助手。用户即将开始一局游戏，你将收到本局十名玩家的局势研判数据，请为用户（下称“我”）生成一段直接服务开局决策的 AI 研判总结。',
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
      '2. 篇幅控制在 300–500 字，分条列出。',
      '3. 头号威胁、次级威胁、我方核心大腿等结论性排名一律以数据中的威胁分排序为准，不得另立排名。',
      focusLine,
      '5. 玩家数据中 champion 为 null 表示尚未锁定英雄，跳过英雄相关分析；显示“数据不足”表示无战绩数据，跳过战绩相关分析。'
    ].join('\n')
  }

  const focusLine = isBasic
    ? '4. Focus on information and counterplay advice that benefits "me": how to play against the top threat, and who to funnel resources to.'
    : '4. Focus on information and counterplay advice that benefits "me": how to play against the top threat, how to lane against my direct opponent, around what level the enemy jungler is likely to gank, and who to funnel resources to.'

  return [
    'You are a League of Legends pre-game situation analyst. The user is about to start a match and will receive situation-read data for all ten players below. Write an AI situation brief that directly serves the early-game decisions of the user (referred to as "me").',
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
    '2. Keep the summary within 300–500 words, presented as a list of bullet points.',
    '3. Conclusive rankings (top threat, secondary threat, key carry) must follow the threat scores given in the data — you must not establish your own rankings.',
    focusLine,
    '5. A null champion means the player has not locked a champion yet — skip champion-specific analysis for them; "insufficient data" means no match history — skip performance analysis for them.'
  ].join('\n')
}

function buildUserPayload(language: AiSituationBriefLanguage, input: AiSituationBriefInput) {
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
        name: player.name,
        team: player.isAlly ? 'ally' : 'enemy'
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
 * 构建 AI 研判总结的提示词（system + user 消息数组）。
 * 纯函数，无 IPC / 网络依赖；user 消息为本局研判数据的 JSON 序列化，
 * 外发字段与设置区隐私说明披露的清单一致。
 */
export function buildAiSituationBriefMessages(
  input: AiSituationBriefInput
): AiSituationBriefMessage[] {
  return [
    { role: 'system', content: getSystemPrompt(input.language, input) },
    { role: 'user', content: JSON.stringify(buildUserPayload(input.language, input), null, 2) }
  ]
}
