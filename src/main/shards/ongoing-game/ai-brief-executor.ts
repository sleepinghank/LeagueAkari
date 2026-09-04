import {
  AI_BRIEF_RETRY_DELAYS_MS,
  type AiBriefMessage,
  type AiBriefStatus
} from '@shared/shards/ongoing-game'
import { formatError } from '@shared/utils/errors'

import type { AkariLogger } from '../logger-factory'
import { DeepSeekRequestError, requestDeepSeekChatCompletion } from './deepseek-client'

export interface AiBriefExecutorOptions {
  /** 日志归属标签（如 "ally brief" / "enemy brief"） */
  label: string
  logger: AkariLogger
  /** 每次发起时读取请求配置（保证使用最新设置） */
  getRequestConfig: () => {
    apiKey: string
    baseUrl: string
    model: string
  }
  /** 组装提示词消息；数据不可用（如研判状态消失）时返回 null */
  collectMessages: () => AiBriefMessage[] | null
  /** 状态写入（经既有状态同步机制暴露给渲染层） */
  setStatus: (status: AiBriefStatus | null) => void
}

/**
 * 单份简报的生成单元（我方简报与敌方简报共享）：置 loading → 组装输入 → 调用 LLM →
 * 写入状态，失败按固定时间表（5s、15s）自动重试，仍失败置为终态错误（本局该份不再发起）。
 * reset() 递增代次以作废在途请求与排队中的重试并清空状态；两份简报各自持有独立实例，
 * 重试时间表与终态互不影响。
 */
export class AiBriefExecutor {
  /** 已失败次数（含首次），用于从重试时间表取下一次间隔 */
  private _failureCount = 0
  /** 生成代次：reset() 时递增，使在途请求与排队中的重试全部作废 */
  private _generationToken = 0
  private _retryTimer: NodeJS.Timeout | null = null

  constructor(private readonly _options: AiBriefExecutorOptions) {}

  /**
   * 发起一次生成（loading → 请求 → 成功 / 重试 / 终态错误）。
   * 同一份简报一局内可能再次 start（如我方简报锁定后更新）：递增代次作废上一次
   * 在途请求与排队中的重试，避免迟到的旧响应覆盖新版本。
   */
  start() {
    this._generationToken += 1

    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }

    this._failureCount = 0
    this._options.setStatus({ status: 'loading' })
    void this._request()
  }

  /** 作废在途请求与重试、清空状态、复位失败计数（对局结束或离开对局阶段时调用） */
  reset() {
    this._generationToken += 1

    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }

    this._failureCount = 0
    this._options.setStatus(null)
  }

  private async _request() {
    const token = this._generationToken
    const { logger } = this._options

    const messages = this._options.collectMessages()

    if (!messages) {
      // 触发后数据又不可用（如对局即将结束）：不生成，该简报区域随研判卡隐藏
      if (token === this._generationToken) {
        this._options.setStatus(null)
      }
      return
    }

    try {
      const content = await requestDeepSeekChatCompletion({
        ...this._options.getRequestConfig(),
        messages
      })

      if (token !== this._generationToken) {
        return
      }

      this._options.setStatus({ status: 'success', content })
    } catch (error) {
      if (token !== this._generationToken) {
        return
      }

      const errorType = error instanceof DeepSeekRequestError ? error.type : 'network'
      this._failureCount += 1

      const retryDelayMs = AI_BRIEF_RETRY_DELAYS_MS[this._failureCount - 1]

      if (retryDelayMs !== undefined) {
        logger.warn(
          `${this._options.label} request failed (${errorType}), retrying in ${retryDelayMs}ms`,
          formatError(error)
        )
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null
          void this._request()
        }, retryDelayMs)
        return
      }

      logger.warn(
        `${this._options.label} request failed (${errorType}), giving up for this game`,
        formatError(error)
      )
      this._options.setStatus({ status: 'error', errorType })
    }
  }
}
