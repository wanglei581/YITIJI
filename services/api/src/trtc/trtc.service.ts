import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { genUserSig } from './usersig.util'
import { callTencentApi } from './tencent-api.util'
import {
  DEFAULT_FORBIDDEN_WORDS,
  DEFAULT_ROLE_SCOPE,
  buildGuardedSystemPrompt,
  normalizeForbiddenWords,
} from '../ai/llm/llm-guard'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function envForbiddenWords(primaryName: string, fallbackName: string): string[] {
  const raw = process.env[primaryName] || process.env[fallbackName]
  if (!raw) return DEFAULT_FORBIDDEN_WORDS
  return normalizeForbiddenWords(raw.split(/[,，\n]/))
}

export interface StartSessionResult {
  sdkAppId:   number
  userId:     string
  userSig:    string
  roomId:     string
  taskId:     string
}

@Injectable()
export class TrtcService {
  private readonly logger = new Logger(TrtcService.name)

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
    return { sdkAppId, userId, userSig: genUserSig(sdkAppId, secretKey, userId) }
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
        VoiceType:       envNumber('TRTC_TTS_VOICE', 1008),
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
    const roomId       = `kiosk_${Date.now()}`
    const botUserId    = `ai_bot_${Date.now()}`
    const userSig      = genUserSig(sdkAppId, secretKey, userId)
    const botUserSig   = genUserSig(sdkAppId, secretKey, botUserId)

    // ── LLM 配置 ─────────────────────────────────────────────
    const llmApiKey = process.env['TRTC_LLM_API_KEY']
    const llmModel  = process.env['TRTC_LLM_MODEL']   ?? 'deepseek-chat'
    const llmType   = process.env['TRTC_LLM_TYPE']    ?? 'openai'
    const llmApiUrl = process.env['TRTC_LLM_API_URL'] ?? 'https://api.deepseek.com/v1/chat/completions'

    if (!llmApiKey) {
      throw new InternalServerErrorException('LLM API Key 未配置（TRTC_LLM_API_KEY）')
    }

    const systemPrompt = buildGuardedSystemPrompt({
      systemPrompt: process.env['TRTC_SYSTEM_PROMPT'] ||
        '你是一位专业、亲切的就业政策与求职服务顾问，名字叫小青。' +
        '你为求职者提供简历优化建议、求职指导、就业政策解读和打印服务帮助。' +
        '回答简洁口语化，每次回复控制在 100 字以内。',
      roleScope: process.env['TRTC_ROLE_SCOPE'] || process.env['AI_ASSISTANT_ROLE_SCOPE'] || DEFAULT_ROLE_SCOPE,
      forbiddenWords: envForbiddenWords('TRTC_FORBIDDEN_WORDS', 'AI_ASSISTANT_FORBIDDEN_WORDS'),
    })

    // LLMConfig（OpenAI 兼容协议，DeepSeek）
    const llmConfig = process.env['TRTC_LLM_CONFIG_JSON'] || JSON.stringify({
      LLMType:      llmType,
      Model:        llmModel,
      APIKey:       llmApiKey,
      APIUrl:       llmApiUrl,
      SystemPrompt: systemPrompt,
      History:      5,
      Streaming:    true,
    })

    // ── TTS 配置 ─────────────────────────────────────────────
    const ttsConfig = this.buildTtsConfig(secretId, cloudKey)

    const payload = {
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

    try {
      const resp = await callTencentApi<{ TaskId: string }>({
        secretId, secretKey: cloudKey, region,
        action: 'StartAIConversation',
        payload,
      })

      this.logger.log(`AI 会话已启动 room=${roomId} task=${resp.TaskId}`)
      return { sdkAppId, userId, userSig, roomId, taskId: resp.TaskId }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error('StartAIConversation 失败', msg)
      throw new InternalServerErrorException(`启动 AI 对话失败: ${msg}`)
    }
  }

  /** 结束一次对话式 AI 会话 */
  async stopSession(taskId: string): Promise<void> {
    const { secretId, cloudKey, region } = this.cfg()
    if (!secretId || !cloudKey) {
      throw new InternalServerErrorException('腾讯云 API 凭证未配置')
    }
    try {
      await callTencentApi({
        secretId, secretKey: cloudKey, region,
        action: 'StopAIConversation',
        payload: { TaskId: taskId },
      })
      this.logger.log(`AI 会话已结束 task=${taskId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`StopAIConversation 失败（忽略）: ${msg}`)
    }
  }
}
