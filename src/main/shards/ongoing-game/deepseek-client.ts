import { AI_BRIEF_DEFAULT_BASE_URL, type AiBriefErrorType } from '@shared/shards/ongoing-game'
import axios, { AxiosError } from 'axios'

/** DeepSeek 请求超时时间（毫秒）：超过即视为失败，界面不会无限等待 */
export const DEEPSEEK_REQUEST_TIMEOUT_MS = 60_000

/** 错误三分类：配置错误（key 无效）/ 网络错误 / 超时 */
export type DeepSeekRequestErrorType = AiBriefErrorType

export class DeepSeekRequestError extends Error {
  constructor(
    public readonly type: DeepSeekRequestErrorType,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'DeepSeekRequestError'
  }
}

export interface DeepSeekChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface DeepSeekChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[]
}

/** 视为 key 无效的 HTTP 状态码 */
const INVALID_KEY_STATUS_CODES = new Set([401, 403])

/** axios 超时类错误码：请求超时（ECONNABORTED）或连接超时（ETIMEDOUT） */
const TIMEOUT_ERROR_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT'])

function normalizeBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = (baseUrl ?? '').trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : AI_BRIEF_DEFAULT_BASE_URL
}

function classifyRequestError(error: unknown): DeepSeekRequestError {
  if (error instanceof AxiosError) {
    if (TIMEOUT_ERROR_CODES.has(error.code ?? '')) {
      return new DeepSeekRequestError('timeout', 'DeepSeek request timed out', { cause: error })
    }

    if (error.response && INVALID_KEY_STATUS_CODES.has(error.response.status)) {
      return new DeepSeekRequestError('config', 'DeepSeek API key was rejected', { cause: error })
    }

    return new DeepSeekRequestError('network', 'DeepSeek request failed', { cause: error })
  }

  return new DeepSeekRequestError('network', 'DeepSeek request failed', { cause: error })
}

/**
 * DeepSeek 薄封装：OpenAI 兼容的 chat/completions 端点，非流式，60s 超时。
 * 空 API Key 不发起请求（直接抛配置错误）；错误统一归类为配置错误 / 网络错误 / 超时三类。
 * 不做日志与重试——由 AI 简报的生成逻辑负责。
 */
export async function requestDeepSeekChatCompletion(options: {
  apiKey: string
  /** 缺省或空白时使用官方端点 */
  baseUrl?: string
  model: string
  messages: DeepSeekChatMessage[]
  /** 缺省 60s */
  timeoutMs?: number
}): Promise<string> {
  const apiKey = options.apiKey.trim()

  if (!apiKey) {
    throw new DeepSeekRequestError('config', 'DeepSeek API key is not configured')
  }

  let response: { data: DeepSeekChatCompletionResponse }

  try {
    response = await axios.post(
      `${normalizeBaseUrl(options.baseUrl)}/chat/completions`,
      {
        model: options.model,
        messages: options.messages,
        stream: false
      },
      {
        timeout: options.timeoutMs ?? DEEPSEEK_REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (error) {
    throw classifyRequestError(error)
  }

  const content = response.data.choices?.[0]?.message?.content

  if (typeof content !== 'string') {
    throw new DeepSeekRequestError('network', 'DeepSeek returned an unexpected response body')
  }

  return content
}
