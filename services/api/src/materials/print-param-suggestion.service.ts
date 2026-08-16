// ============================================================
// S3-1 · P06 打印参数预填 —— 服务层
//
// 只读一条链：已完成的 inspection 任务 → 确定性规则 → 四项建议。
// 不写库、不建单、不报价、不碰支付、不碰出纸判定。
//
// 「AI 是加速器不是前置条件」的落点：
//   本服务的任何一种不可用（功能位关闭、体检未完成、体检读不出、文件不可打印），
//   都返回 200 + available:false + 明确原因，**不抛错**。P06 的打印流程照常走，
//   用户自己设四项即可（对应 V6 原型 06-print-workbench.html:2106 的 ai-down 文案）。
//   只有「任务不存在 / 无权访问 / 已过期 / 任务类型不对」才是调用方错误，照常抛。
// ============================================================

import { BadRequestException, Injectable } from '@nestjs/common'
import { LlmConfigService } from '../ai/llm/llm-config.service'
import { MaterialsService } from './materials.service'
import type { MaterialsRequester } from './materials.types'
import {
  derivePrintParamSuggestions,
  readCapabilityProfile,
  readInspectionFacts,
  selectNotices,
} from './print-param-suggestion.rules'
import {
  PRINT_PARAM_PREFILL_FEATURE_KEY,
  type PrintParamSuggestionReason,
  type PrintParamSuggestionView,
} from './print-param-suggestion.types'

const DISCLAIMER =
  '以下参数是按文件体检结果预填的建议值，全部可改；确认前不会生效，也不会影响金额与出纸。'

/** 四项全部不可用时给前端的统一口径（与 V6 原型 ai-down 文案一致）。 */
const FALLBACK_HINT = '预填不可用，四项都需要你自己设；打印流程不受影响。'

@Injectable()
export class PrintParamSuggestionService {
  constructor(
    private readonly materials: MaterialsService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  async suggestForInspectionTask(
    taskId: string,
    requester: MaterialsRequester,
  ): Promise<PrintParamSuggestionView> {
    // 访问控制、过期判定全部复用 getTask，不在这里另写一份（另写一份就会漂移）。
    const task = await this.materials.getTask(taskId, requester)

    if (task.kind !== 'inspection') {
      throw new BadRequestException({
        error: {
          code: 'MATERIAL_TASK_KIND_MISMATCH',
          message: '打印参数预填只能基于文件体检（inspection）任务',
        },
      })
    }

    if (!this.isFeatureEnabled()) {
      return this.unavailable(taskId, {
        code: 'AI_FEATURE_DISABLED',
        text: `参数预填当前已关闭。${FALLBACK_HINT}`,
      })
    }

    if (task.status !== 'completed') {
      return this.unavailable(taskId, {
        code: 'INSPECTION_NOT_COMPLETED',
        text: `文件体检尚未完成（当前状态：${task.status}）。${FALLBACK_HINT}`,
      })
    }

    const facts = readInspectionFacts(task.result)
    if (!facts) {
      return this.unavailable(taskId, {
        code: 'INSPECTION_RESULT_UNREADABLE',
        text: `没有读到可用的文件体检结果。${FALLBACK_HINT}`,
      })
    }

    if (!facts.canPrint) {
      return this.unavailable(taskId, {
        code: 'INSPECTION_FILE_NOT_PRINTABLE',
        text: `文件体检判定这份文件当前不能直接打印，参数预填没有依据。${FALLBACK_HINT}`,
      })
    }

    const capabilityProfile = readCapabilityProfile()
    return {
      taskId,
      featureKey: PRINT_PARAM_PREFILL_FEATURE_KEY,
      derivation: 'deterministic_rules',
      advisory: true,
      available: true,
      unavailableReason: null,
      capabilityProfile,
      items: derivePrintParamSuggestions(facts, capabilityProfile),
      notices: selectNotices(facts),
      evidence: facts,
      disclaimer: DISCLAIMER,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * 功能位开关。
   *
   * 只看 enabled，**故意不看 apiKey** —— 本能力是确定性规则，不发起任何模型调用，
   * 若跟着 isReady()（enabled && apiKey）走，就会出现「没配大模型凭证 → 连数页数
   * 都不给预填」这种假耦合。凭证缺失不得影响本能力，由 verify 脚本反向验证。
   */
  private isFeatureEnabled(): boolean {
    return this.llmConfig.getConfig(PRINT_PARAM_PREFILL_FEATURE_KEY).enabled
  }

  private unavailable(taskId: string, reason: PrintParamSuggestionReason): PrintParamSuggestionView {
    return {
      taskId,
      featureKey: PRINT_PARAM_PREFILL_FEATURE_KEY,
      derivation: 'deterministic_rules',
      advisory: true,
      available: false,
      unavailableReason: reason,
      capabilityProfile: readCapabilityProfile(),
      items: [],
      notices: [],
      evidence: null,
      disclaimer: DISCLAIMER,
      generatedAt: new Date().toISOString(),
    }
  }
}
