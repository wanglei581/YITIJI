import { randomBytes } from 'node:crypto'
import type { AssistantChatResult, ChatInput, ChatOutput } from '../interfaces/ai-provider.interface'
import { isLlmProviderLabel } from '../interfaces/ai-provider.interface'
import { AiUsageAccumulator, aiLogFieldsFromUsageReport, type AiLlmCallSink, type AiLogService } from '../ai-log.service'
import { currentAiRequestContext } from '../usage/ai-usage-context'
import { quotaSequence, runWithAiQuota, type QuotaAbortRequest, type ReleaseReason } from './ai-quota-run'
import type { AiQuotaService } from './ai-quota.service'
import { policyUnavailableResult } from '../llm/assistant-policy-context'

/** 小青一轮文字的计次。从 AiService 拆出，避免服务文件继续加长。 */
export interface AssistantChargeRunInput<T> {
  endUserId?: string | null
  operationKey: string
  req?: QuotaAbortRequest
  failureOf?: (value: T) => ReleaseReason | null
  work: () => Promise<T>
  saveResult: (value: T) => Promise<string>
}

export interface AssistantChatDeps {
  llmConfig: {
    isReady(feature: 'assistant_chat'): boolean
    getConfig(feature: 'assistant_chat'): { vendor: string }
  }
  llmChat: {
    chat(input: ChatInput, onLlmCall?: AiLlmCallSink, ownerKey?: string, policyPrompt?: string): Promise<ChatOutput>
    readPolicyContext?(policyId: string): Promise<string | null>
    /** 真实对话服务才有。覆盖率桩没有这个方法时，设备故障仍走对话内部的固定回答。 */
    wouldDeviceFault?(input: ChatInput, ownerKey?: string): boolean
  }
  provider: { name: string; chatAssistant(input: ChatInput): Promise<ChatOutput> }
  log: Pick<AiLogService, 'record'>
}

type RunWithAiQuota = typeof runWithAiQuota

/**
 * 没有账本或没有登录身份时不预占，仍执行并保存。
 * 有身份时交给 runWithAiQuota：先存结果再结算。金额封顶由访问守卫在进处理器之前检查。
 */
export function executeAssistantCharge<T>(
  quota: AiQuotaService | undefined,
  input: AssistantChargeRunInput<T>,
  gate: { bucket: 'ai_assistant'; runWithAiQuota: RunWithAiQuota },
): Promise<T> {
  if (!quota || !input.endUserId) {
    return input.work().then(async (value) => {
      await input.saveResult(value)
      return value
    })
  }
  return gate.runWithAiQuota({
    quota,
    bucket: gate.bucket,
    operationKey: input.operationKey,
    endUserId: input.endUserId,
    req: input.req,
    failureOf: input.failureOf,
  }, input.work, input.saveResult)
}

/**
 * 这一轮小青要不要把预占退回去。
 * 词库拦住提问或生成：content_rejected，不扣。
 * 设备故障固定回答没调模型，也不扣；它不是词库命中，不能记成 content_rejected。
 * 正常路径在预占前就返回固定回答，走不到这里。模型教人动手的替换不设退次标记，照常结算。
 */
export function assistantTurnReleaseReason(value: { fixedNotice?: boolean }): ReleaseReason | null {
  if (currentAiRequestContext()?.safetyRefund !== true) return null
  if (value.fixedNotice) return 'provider_error'
  return 'content_rejected'
}

/**
 * 一轮小青文字。操作号只在这里签发，不读客户端传来的会话号或消息号。
 * 回答写入会话之后才把会话号交给结算。
 */
export async function chargeAssistantChat(
  deps: AssistantChatDeps,
  input: ChatInput,
  ownerKey: string,
  endUserId: string | null,
  req: QuotaAbortRequest | undefined,
  runCharge: <T>(input: AssistantChargeRunInput<T>) => Promise<T>,
): Promise<AssistantChatResult> {
  // 控制器的访问/登录与公网配额闸门仍在本层之前；不可见政策不预占会员次数，也不调回落模型。
  const policyPrompt = input.policyId === undefined
    ? undefined
    : await deps.llmChat.readPolicyContext?.(input.policyId) ?? null
  if (policyPrompt === null) return policyUnavailableResult()
  // 设备故障固定回答不调模型，不预占。公网次数仍由对话里的退次标记退回。
  if (deps.llmConfig.isReady('assistant_chat') && deps.llmChat.wouldDeviceFault?.(input, ownerKey)) {
    return completeAssistantTurn(deps, input, ownerKey, endUserId, policyPrompt)
  }
  return runCharge({
    endUserId,
    operationKey: `assistant-chat:${quotaSequence()}`,
    req,
    failureOf: assistantTurnReleaseReason,
    work: () => completeAssistantTurn(deps, input, ownerKey, endUserId, policyPrompt),
    saveResult: async (value) => assistantResultRef(value.sessionId),
  })
}

async function completeAssistantTurn(
  deps: AssistantChatDeps,
  input: ChatInput,
  ownerKey: string,
  endUserId: string | null,
  policyPrompt?: string,
): Promise<AssistantChatResult> {
  const t0 = Date.now()
  const useLlm = deps.llmConfig.isReady('assistant_chat')
  const providerLabel = useLlm ? `llm:${deps.llmConfig.getConfig('assistant_chat').vendor}` : deps.provider.name
  const usage = new AiUsageAccumulator()
  try {
    const result = useLlm
      ? await deps.llmChat.chat(input, usage.add, ownerKey, policyPrompt)
      : await deps.provider.chatAssistant({
          ...input,
          sessionId: input.sessionId ?? randomBytes(16).toString('hex'),
        })
    deps.log.record({
      taskId: result.sessionId,
      ...aiLogFieldsFromUsageReport(usage.toReport(providerLabel), providerLabel),
      operation: 'chatAssistant',
      latencyMs: Date.now() - t0,
      status: 'success',
      endUserId,
    })
    return { ...result, providerLabel, aiGenerated: isLlmProviderLabel(providerLabel) }
  } catch (err) {
    deps.log.record({
      taskId: input.sessionId ?? null,
      ...aiLogFieldsFromUsageReport(usage.toReport(providerLabel), providerLabel),
      operation: 'chatAssistant',
      latencyMs: Date.now() - t0,
      status: 'failed',
      errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      endUserId,
    })
    throw err
  }
}

/** 结算只收记录号。会话号由服务端生成，不合规时改用本次操作号，避免结算被拒。 */
function assistantResultRef(sessionId: string): string {
  if (/^[A-Za-z0-9_.:-]{1,200}$/.test(sessionId)) return sessionId
  return `assistant-chat:${quotaSequence()}`
}
