import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common'
import { describeBackgroundError, runBackground, scheduleBackground } from '../common/process/background-task'
import { randomUUID } from 'node:crypto'
import { TrtcSessionRegistry, readTrtcMaxSessionSeconds } from './trtc-session-registry.service'
import { genUserSig } from './usersig.util'
import { callTencentApi } from './tencent-api.util'
import { assertTrtcDelegatedEndpoints } from './trtc-delegated-endpoints'
import { AiEndpointNotAllowedError } from '../common/outbound/ai-endpoint-allowlist'
import { llmEndpointNotAllowedError } from '../ai/llm/llm-failure'
import { withAiSafety } from '../ai/llm/ai-prompt-safety'
import { guardTrtcLlmConfigJson } from './trtc-llm-safety'
import {
  DEFAULT_FORBIDDEN_WORDS,
  DEFAULT_ROLE_SCOPE,
  normalizeForbiddenWords,
} from '../ai/llm/llm-guard'
import { deepseekThinkingOff } from '../ai/llm/deepseek-thinking'

export const TRTC_DEFAULT_SYSTEM_PROMPT = withAiSafety(
  '你是一位专业、亲切的就业服务顾问，名字叫小青。' +
  '你只提供简历整理、打印帮助和就业政策说明。' +
  '不引导查询云上的岗位或招聘会。' +
  '回答简洁口语化，每次回复控制在 100 字以内。',
  { policyVariant: 'voice' },
)

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/** 小青音色 ID。buildTtsConfig 与思考模式在线探针共用，避免默认值 1008 写两处。 */
export function readXiaoqingVoiceType(): number {
  return envNumber('TRTC_TTS_VOICE', 1008)
}

function envForbiddenWords(primaryName: string, fallbackName: string): string[] {
  const raw = process.env[primaryName] || process.env[fallbackName]
  if (!raw) return DEFAULT_FORBIDDEN_WORDS
  return normalizeForbiddenWords(raw.split(/[,，\n]/))
}

export interface TrtcLlmConfigInput {
  llmType:      string
  model:        string
  apiKey:       string
  apiUrl:       string
  systemPrompt: string
}

/**
 * 数字人「小青」发给腾讯云 StartAIConversation 的 LLMConfig（JSON 字符串）。
 *
 * - `overrideJson`（TRTC_LLM_CONFIG_JSON）非空时**原样**返回，不改写一个字节：
 *   覆盖者自己负责带上关闭思考（.env.example 里写明了怎么带）。
 * - 默认配置：DeepSeek 系模型加 `ExtraBody: { thinking: { type: 'disabled' } }`。
 *   依据是腾讯云官方「大模型配置」页（https://cloud.tencent.com/document/product/647/115413，
 *   页面更新 2025-09-09，2026-09-29 访问）：ExtraBody =「额外透传给大模型的参数，
 *   例如关闭思考」，官方示例是千问的 `{"enable_thinking": false}`（千问该字段在请求体顶层），
 *   据此推断 ExtraBody 的内容并进上游请求体顶层（官方没有明写合并方式，需真机对话核对一次）。
 *   DeepSeek 的关闭写法与文字版各功能
 *   共用 deepseekThinkingOff()，保证两边口径一致。
 *   非 DeepSeek 模型不加 ExtraBody，配置与改动前逐字相同。
 */
export function buildTrtcLlmConfigJson(input: TrtcLlmConfigInput, overrideJson?: string): string {
  if (overrideJson) return overrideJson
  const thinkingOff = deepseekThinkingOff(input.model)
  return JSON.stringify({
    LLMType:      input.llmType,
    Model:        input.model,
    APIKey:       input.apiKey,
    APIUrl:       input.apiUrl,
    SystemPrompt: input.systemPrompt,
    History:      5,
    Streaming:    true,
    ...(Object.keys(thinkingOff).length > 0 ? { ExtraBody: thinkingOff } : {}),
  })
}

export interface StartSessionResult {
  sdkAppId:   number
  userId:     string
  userSig:    string
  roomId:     string
  taskId:     string
  maxSessionSeconds: number
  expiresAt: string
}

/** UserSig 只在进房时校验：保持原来的 5 分钟短 TTL，上限配得更短时再跟着收紧（上限 + 30 秒）。 */
function trtcUserSigTtlSeconds(): number {
  return Math.min(300, readTrtcMaxSessionSeconds() + 30)
}

@Injectable()
export class TrtcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrtcService.name)

  private deadlineTimer?: ReturnType<typeof setInterval>
  private scanning = false
  constructor(private readonly sessions: TrtcSessionRegistry) {}

  onModuleInit(): void {
    // 重启立即扫描 Redis；不等待腾讯云，避免依赖故障卡住 API 启动。
    const onError = (error: unknown) => this.logger.error(`TRTC_DEADLINE_SCAN_FAILED ${describeBackgroundError(error)}`)
    runBackground(() => this.expireSessions(), onError)
    this.deadlineTimer = scheduleBackground(() => this.expireSessions(), 1_000, onError)
  }

  onModuleDestroy(): void { if (this.deadlineTimer) clearInterval(this.deadlineTimer) }

  async expireSessions(now = Date.now()): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const due = await this.sessions.due(now)
      // 一次故障不能把其他已到期会话串行拖住；每批最多 10 个云侧停止请求。
      for (let offset = 0; offset < due.length; offset += 10) {
        await Promise.all(due.slice(offset, offset + 10).map(async (record) => {
          try {
            if (record.taskId) {
              await this.stopSession(record.taskId)
              return
            }
            await this.sessions.finish(record.sessionId, async (item) => {
              let taskId = item.taskId
              if (!taskId) {
                // Start 返回前崩溃/超时：用预写的 SessionId 找回腾讯任务，不丢停止责任。
                // 官方：https://cloud.tencent.com/document/api/647/108515（2026-09-30 核对）。
                const { secretId, cloudKey } = this.cfg()
                if (!secretId || !cloudKey) throw new Error('TRTC credentials unavailable')
                try {
                  const result = await callTencentApi<{ TaskId: string }>({
                    secretId, secretKey: cloudKey, region: item.region, action: 'DescribeAIConversation',
                    payload: { SdkAppId: item.sdkAppId, SessionId: item.sessionId },
                  })
                  taskId = result.TaskId
                  if (!taskId) throw new Error('TRTC task not yet resolved')
                } catch (error) {
                  if (error instanceof Error && error.message.startsWith('FailedOperation.TaskNotExist:')) return
                  throw error
                }
              }
              await this.stopCloudSession(taskId, item.region)
            })
          } catch (error) {
            await this.sessions.retry(record.sessionId, now)
            this.logger.error('TRTC_DEADLINE_STOP_RETRY', error instanceof Error ? error.message : String(error))
          }
        }))
      }
    } catch (error) {
      this.logger.error('TRTC_DEADLINE_SCAN_FAILED', error instanceof Error ? error.message : String(error))
    } finally { this.scanning = false }
  }

  private cfg() {
    const sdkAppId  = Number(process.env['TRTC_SDK_APP_ID'])
    const secretKey = process.env['TRTC_SDK_SECRET_KEY']
    const secretId  = process.env['TENCENT_SECRET_ID']
    const cloudKey  = process.env['TENCENT_SECRET_KEY']
    const region    = process.env['TRTC_REGION'] ?? 'ap-guangzhou'
    return { sdkAppId, secretKey, secretId, cloudKey, region }
  }

  /** 仅生成进房凭证（前端进 TRTC 房间用） */
  issueUserSig(userId: string): { sdkAppId: number; userId: string; userSig: string } {
    const { sdkAppId, secretKey } = this.cfg()
    if (!sdkAppId || !secretKey) {
      throw new InternalServerErrorException('TRTC 应用凭证未配置')
    }
    return { sdkAppId, userId, userSig: genUserSig(sdkAppId, secretKey, userId, trtcUserSigTtlSeconds()) }
  }

  private buildTtsConfig(secretId: string, cloudKey: string): string {
    const explicitConfig = process.env['TRTC_TTS_CONFIG_JSON']?.trim()
    if (explicitConfig) return explicitConfig

    const ttsType = (process.env['TRTC_TTS_TYPE'] ?? 'tencent').toLowerCase()

    if (ttsType === 'tencent') {
      const appId = Number(process.env['TRTC_TTS_APP_ID'] ?? process.env['TENCENT_APP_ID'])
      if (!Number.isFinite(appId) || appId <= 0) {
        throw new InternalServerErrorException('腾讯 TTS AppId 未配置（TRTC_TTS_APP_ID 或 TENCENT_APP_ID）')
      }

      return JSON.stringify({
        TTSType:         'tencent',
        AppId:           appId,
        SecretId:        secretId,
        SecretKey:       cloudKey,
        VoiceType:       readXiaoqingVoiceType(),
        Volume:          envNumber('TRTC_TTS_VOLUME', 5),
        Speed:           envNumber('TRTC_TTS_SPEED', 0),
        PrimaryLanguage: envNumber('TRTC_TTS_PRIMARY_LANGUAGE', 1),
      })
    }

    throw new InternalServerErrorException(`不支持的 TRTC_TTS_TYPE: ${ttsType}，请使用 tencent 或 TRTC_TTS_CONFIG_JSON`)
  }

  /**
   * 启动一次对话式 AI 会话：
   *  1. 为用户和 AI 机器人各生成 UserSig
   *  2. 调用腾讯云 StartAIConversation 把 AI 拉进房间
   */
  async startSession(userId: string): Promise<StartSessionResult> {
    const { sdkAppId, secretKey, secretId, cloudKey, region } = this.cfg()

    if (!sdkAppId || !secretKey) {
      throw new InternalServerErrorException('TRTC 应用凭证未配置')
    }
    if (!secretId || !cloudKey) {
      throw new InternalServerErrorException('腾讯云 API 凭证（SecretId/SecretKey）未配置')
    }

    // 房间号：用时间戳派生，保证每次唯一（字符串房间）
    const sessionId = randomUUID()
    const maxSessionSeconds = readTrtcMaxSessionSeconds()
    const roomId       = `kiosk_${sessionId}`
    const botUserId    = `ai_bot_${sessionId}`
    const userSig      = genUserSig(sdkAppId, secretKey, userId, trtcUserSigTtlSeconds())
    const botUserSig   = genUserSig(sdkAppId, secretKey, botUserId, trtcUserSigTtlSeconds())

    // ── LLM 配置 ─────────────────────────────────────────────
    const llmApiKey = process.env['TRTC_LLM_API_KEY']
    const llmModel  = process.env['TRTC_LLM_MODEL']   ?? 'deepseek-v4-flash'
    const llmType   = process.env['TRTC_LLM_TYPE']    ?? 'openai'
    const llmApiUrl = process.env['TRTC_LLM_API_URL'] ?? 'https://api.deepseek.com/v1/chat/completions'

    if (!llmApiKey) {
      throw new InternalServerErrorException('LLM API Key 未配置（TRTC_LLM_API_KEY）')
    }

    const promptConfig = {
      systemPrompt: process.env['TRTC_SYSTEM_PROMPT'] || TRTC_DEFAULT_SYSTEM_PROMPT,
      roleScope: process.env['TRTC_ROLE_SCOPE'] || process.env['AI_ASSISTANT_ROLE_SCOPE'] || DEFAULT_ROLE_SCOPE,
      forbiddenWords: envForbiddenWords('TRTC_FORBIDDEN_WORDS', 'AI_ASSISTANT_FORBIDDEN_WORDS'),
    }

    // LLMConfig（OpenAI 兼容协议，DeepSeek；DeepSeek 系默认关闭思考，见 buildTrtcLlmConfigJson）
    const llmConfig = buildTrtcLlmConfigJson(
      { llmType, model: llmModel, apiKey: llmApiKey, apiUrl: llmApiUrl, systemPrompt: promptConfig.systemPrompt },
      process.env['TRTC_LLM_CONFIG_JSON'],
    )

    // ── TTS 配置 ─────────────────────────────────────────────
    const ttsConfig = this.buildTtsConfig(secretId, cloudKey)

    const payload = {
      SessionId:  sessionId,
      SdkAppId:   sdkAppId,
      RoomId:     roomId,
      RoomIdType: 1, // 1 = 字符串房间号
      AgentConfig: {
        UserId:         botUserId,
        UserSig:        botUserSig,
        TargetUserId:   userId,
        MaxIdleTime:    60,
        WelcomeMessage: '您好，我是就业服务顾问小青，请问有什么可以帮您？',
        InterruptMode:  0,
        WelcomeMessagePriority: 1,
      },
      STTConfig: { Language: 'zh' },
      LLMConfig: llmConfig,
      TTSConfig: ttsConfig,
    }

    // 官方 Start/AgentConfig 仅有无推流的 MaxIdleTime，没有总时长字段：
    // https://cloud.tencent.com/document/api/647/108514
    // https://cloud.tencent.com/document/api/647/44055#AgentConfig（2026-09-30 核对）。
    // 服务端截止从调用腾讯前开始，永不因重连/停止令牌重放而续期。
    const startedAt = Date.now()
    const record = { sessionId, sdkAppId, region, startedAt,
      expiresAt: startedAt + maxSessionSeconds * 1000, taskId: null, stopped: false }
    try {
      // 交给腾讯云代调的模型 / 语音合成地址先过出站白名单：不在单内就不调腾讯云、不建房。
      assertTrtcDelegatedEndpoints(llmConfig, ttsConfig)
      payload.LLMConfig = guardTrtcLlmConfigJson(llmConfig, promptConfig)
      await this.sessions.reserve(record) // Redis 不可用时不向腾讯发起计费请求。
      const resp = await callTencentApi<{ TaskId: string }>({
        secretId, secretKey: cloudKey, region,
        action: 'StartAIConversation',
        payload,
      })

      try {
        await this.sessions.activate(record, resp.TaskId)
        if (Date.now() >= record.expiresAt) throw new Error('TRTC session deadline elapsed during start')
      } catch (error) {
        await this.stopCloudSession(resp.TaskId, region)
        throw error
      }
      this.logger.log(`AI 会话已启动 room=${roomId} task=${resp.TaskId}`)
      return { sdkAppId, userId, userSig, roomId, taskId: resp.TaskId, maxSessionSeconds, expiresAt: new Date(record.expiresAt).toISOString() }
    } catch (err: unknown) {
      // 地址未通过出站白名单（代调地址或腾讯云主机）：一个请求都没发，如实报 503，不报成 500。
      if (err instanceof AiEndpointNotAllowedError) throw llmEndpointNotAllowedError()
      if (err instanceof ServiceUnavailableException) throw err
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error('StartAIConversation 失败', msg)
      throw new InternalServerErrorException(`启动 AI 对话失败: ${msg}`)
    }
  }

  /** 结束一次对话式 AI 会话 */
  async stopSession(taskId: string): Promise<void> {
    const sessionId = await this.sessions.sessionForTask(taskId)
    if (!sessionId) return this.stopCloudSession(taskId) // 发布前已开出的旧会话仍可止损。
    await this.sessions.finish(sessionId, item => this.stopCloudSession(taskId, item.region))
  }

  private async stopCloudSession(taskId: string, sessionRegion?: string): Promise<void> {
    const { secretId, cloudKey, region } = this.cfg()
    if (!secretId || !cloudKey) {
      throw new InternalServerErrorException('腾讯云 API 凭证未配置')
    }
    try {
      await callTencentApi({
        secretId, secretKey: cloudKey, region: sessionRegion ?? region,
        action: 'StopAIConversation',
        payload: { TaskId: taskId },
      })
      this.logger.log(`AI 会话已结束 task=${taskId}`)
    } catch (err: unknown) {
      // 腾讯云主机被移出出站白名单：请求没发出，重试也不会成功，不报成「请重试」。
      if (err instanceof AiEndpointNotAllowedError) throw llmEndpointNotAllowedError()
      // 腾讯官方停止/查询的 TaskNotExist 表示任务已结束，重复停止视为成功。
      if (err instanceof Error && err.message.startsWith('FailedOperation.TaskNotExist:')) return
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`StopAIConversation 失败: ${msg}`)
      throw new ServiceUnavailableException({
        error: { code: 'TRTC_STOP_FAILED', message: '结束 AI 对话失败，请重试', retryable: true },
      })
    }
  }
}
