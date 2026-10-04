import { randomBytes } from 'node:crypto'
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { GenerateResumeOutput, GeneratedResume, OptimizeResumeOutput, ParseResumeOutput, ResumeGenerateInput, ResumeLayoutSettings } from '../interfaces/ai-provider.interface'
import type { ResumeLayoutAdjustAction } from '../dto/resume-generate.dto'
import { AiUsageAccumulator } from '../ai-log.service'
import { LlmResumeOptimizeService } from '../resume/llm-resume-optimize.service'
import { quotaSequence, type QuotaAbortRequest } from './ai-quota-run'
import { rethrowQuota, type ResumeChargeBindings, type ResumeChargeRequester, type ResumeChargeRunInput } from './ai-resume-charge'

/** 优化懒生成。解析未成功或原文已清理时不预占。失败不落库，归还后换序号重试。 */
export async function chargeComputeResumeOptimize(
  bindings: ResumeChargeBindings,
  taskId: string,
  requester: ResumeChargeRequester,
  req: QuotaAbortRequest | undefined,
  runCharge: <T>(input: ResumeChargeRunInput<T>) => Promise<T>,
): Promise<OptimizeResumeOutput> {
  const cached = await bindings.load<OptimizeResumeOutput>(taskId, 'optimize', requester)
  if (cached) return cached
  const parseResult = await bindings.load<ParseResumeOutput>(taskId, 'parse', requester)
  if (!parseResult) {
    throw new NotFoundException({
      error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' },
    })
  }
  const report = parseResult.report
  if (!report) return { taskId, status: 'failed', failReason: '简历解析未成功，无法生成优化建议' }

  const t0 = Date.now()
  try {
    const parseOwner = await bindings.parseOwner(taskId)
    let extractedText: string | undefined
    if (bindings.providerName === 'llm') {
      const fileId = parseResult.fileId
      if (fileId) {
        const extraction = await bindings.extract(fileId, parseOwner?.endUserId ?? null)
        if (extraction.ok) extractedText = extraction.text
      }
      if (!extractedText) {
        return {
          taskId,
          status: 'failed',
          providerName: bindings.providerName,
          failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再生成优化版',
        }
      }
    }
    return await runCharge({
      endUserId: parseOwner?.endUserId ?? null,
      operationKey: `${taskId}:optimize`,
      req,
      loadStored: () => bindings.load<OptimizeResumeOutput>(taskId, 'optimize', requester),
      failureOf: (value) => (value.status === 'failed' ? 'provider_error' : null),
      work: async () => {
        const result = await bindings.optimizeResume(taskId, report, extractedText, parseResult.targetContext)
        const withProvider: OptimizeResumeOutput = { ...result, providerName: bindings.providerName }
        bindings.log.optimize(withProvider, taskId, t0)
        return withProvider
      },
      saveResult: async (value) => {
        if (value.status === 'completed') {
          await bindings.persistResult(
            taskId, 'optimize', value.status, value,
            parseOwner?.endUserId ?? null,
            parseOwner?.accessTokenHash ?? null,
          )
        }
        return taskId
      },
    })
  } catch (err) {
    rethrowQuota(err)
    bindings.log.optimizeThrown(taskId, t0, err)
    throw err
  }
}

/** 排版调整。未接账本时不另存一行；接入后先落库再结算，断开也能重开。 */
export async function chargeAdjustResumeLayout(
  bindings: ResumeChargeBindings,
  taskId: string,
  currentResume: GeneratedResume,
  action: ResumeLayoutAdjustAction,
  layout: ResumeLayoutSettings | undefined,
  requester: ResumeChargeRequester,
  req: QuotaAbortRequest | undefined,
  runCharge: <T>(input: ResumeChargeRunInput<T>) => Promise<T>,
): Promise<{ resume: GeneratedResume; warnings: string[] }> {
  const parseResult = await bindings.load<ParseResumeOutput>(taskId, 'parse', requester)
  if (!parseResult) {
    throw new NotFoundException({
      error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' },
    })
  }
  if (bindings.providerName !== 'llm') {
    throw new ServiceUnavailableException({
      error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI 简历优化模型尚未配置或未启用，请联系管理员' },
    })
  }
  const t0 = Date.now()
  const usage = new AiUsageAccumulator()
  try {
    const parseOwner = await bindings.parseOwner(taskId)
    const fileId = parseResult.fileId
    let originalText: string | undefined
    if (fileId) {
      const extraction = await bindings.extract(fileId, parseOwner?.endUserId ?? null)
      if (extraction.ok) originalText = extraction.text
    }
    if (!originalText) bindings.sourceUnavailable()
    const charging = bindings.charging(parseOwner?.endUserId)
    return await runCharge({
      endUserId: parseOwner?.endUserId ?? null,
      operationKey: `${taskId}:layout:${quotaSequence()}`,
      req,
      work: async () => {
        const optimizer = new LlmResumeOptimizeService(bindings.llmConfig)
        const result = await optimizer.adjustLayoutDraft({ currentResume, originalText, action, layout, onLlmCall: usage.add })
        bindings.log.layout(taskId, t0, usage.toReport(bindings.providerName))
        return result
      },
      saveResult: async (value) => {
        if (charging) {
          await bindings.persistPayload(taskId, 'layout_adjust', 'completed', value, parseOwner?.endUserId ?? null, null)
        }
        return taskId
      },
    })
  } catch (err) {
    rethrowQuota(err)
    bindings.log.layoutThrown(taskId, t0, usage.toReport(bindings.providerName), err)
    throw err
  }
}

/** 引导式简历生成。失败结果仍落库再归还，匿名令牌只在本次响应里出现一次。 */
export async function chargeSubmitResumeGenerate(
  bindings: ResumeChargeBindings,
  input: ResumeGenerateInput,
  endUserId: string | null | undefined,
  req: QuotaAbortRequest | undefined,
  runCharge: <T>(input: ResumeChargeRunInput<T>) => Promise<T>,
): Promise<GenerateResumeOutput> {
  const t0 = Date.now()
  const charging = bindings.charging(endUserId)
  const serverTaskId = charging ? randomBytes(16).toString('hex') : undefined
  try {
    return await runCharge({
      endUserId,
      operationKey: `${serverTaskId ?? `gen-${randomBytes(8).toString('hex')}`}:generate`,
      req,
      failureOf: (value) => (value.status === 'failed' ? 'provider_error' : null),
      persistFailure: true,
      work: async () => {
        let result: GenerateResumeOutput
        if (bindings.generateResume) result = await bindings.generateResume(input)
        else {
          result = {
            taskId: `gen-unsupported-${randomBytes(8).toString('hex')}`,
            status: 'failed',
            failReason: `当前 AI 服务(${bindings.providerName})不支持简历生成，请联系管理员`,
          }
        }
        if (serverTaskId) result = { ...result, taskId: serverTaskId }
        return { ...result, providerName: bindings.providerName }
      },
      saveResult: async (value) => {
        const accessToken = endUserId ? undefined : randomBytes(24).toString('hex')
        const accessTokenHash = accessToken ? bindings.hashAccessToken(accessToken) : null
        await bindings.persistResult(value.taskId, 'generate', value.status, value, endUserId ?? null, accessTokenHash)
        bindings.log.generate(value, t0)
        if (accessToken) value.accessToken = accessToken
        return value.taskId
      },
    })
  } catch (err) {
    rethrowQuota(err)
    bindings.log.generateThrown(t0, err)
    throw err
  }
}
