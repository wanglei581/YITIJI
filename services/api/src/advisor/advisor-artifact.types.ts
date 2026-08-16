import type { CompareItem } from './llm-advisor.service'
import type { EvidenceLevel } from './advisor-skills'

// ============================================================
// S3-3 · P26 顾问作业面产物的落盘形状（AdvisorArtifact.payloadJson）。
//
// 单独成文件是为了打破环依赖：PDF 服务要认识产物形状，产物服务要调 PDF 服务。
// 这里只放类型，不放任何逻辑。
//
// 三种产物一一对应三种作业型，kind 作为判别式联合的 tag。
// ============================================================

/** 问答型产物：用户主动钉住的条目单。对话本身不落盘，只有钉住的留下。 */
export interface QaPinsPayload {
  kind: 'qa_pins'
  pins: Array<{
    content: string
    evidenceLevel: EvidenceLevel
    sourceNote: string | null
  }>
}

/** 填槽型产物：成稿 + 留空项 + 成稿所依据的用户原话（E1，打印时一并带出）。 */
export interface SlotDraftPayload {
  kind: 'slot_draft'
  draft: string
  blanks: string[]
  summary: string
  basedOn: Array<{ slotKey: string; prompt: string; value: string }>
}

/** 比对型产物：逐条判定 + 材料多出项 + 总览。「本机比不了的」是服务端常量，不入库。 */
export interface CompareReportPayload {
  kind: 'compare_report'
  items: CompareItem[]
  extras: Array<{ point: string; note: string }>
  summary: string
}

export type AdvisorArtifactPayload = QaPinsPayload | SlotDraftPayload | CompareReportPayload
