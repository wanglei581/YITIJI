import type { PrintJobParams } from '@ai-job-print/shared'
import {
  createContractReviewReport,
  type ContractReviewAccess,
} from '../../services/api/contractReview'
import {
  clearPrintMaterialSession,
  type PrintFileState,
  type PrintMaterialSource,
} from '../print/printMaterialSession'
import { clearContractReviewSession } from './contractReviewSession'

const REPORT_PRINT_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

export interface ContractReviewReportPrintHandoff {
  file: PrintFileState
  params: PrintJobParams
  source: PrintMaterialSource
  contractReport: {
    fileId: string
    abandonToken: string
  }
}

/**
 * 合同结果页与打印履约链之间的唯一适配层。
 *
 * 新旧视觉页面都只调用本函数：报告接口成功（也意味着原合同已优先清理）后，
 * 才清空合同/通用材料易失会话并返回现有 PrintConfirmPage 所需的最小 state。
 * 不得在页面组件中复制报告参数、凭证裁剪或会话清理逻辑。
 */
export async function prepareContractReviewReportPrint(
  taskId: string,
  access: ContractReviewAccess,
): Promise<ContractReviewReportPrintHandoff> {
  const report = await createContractReviewReport(taskId, access)
  clearContractReviewSession()
  clearPrintMaterialSession()
  return {
    file: {
      name: report.filename,
      size: formatBytes(report.sizeBytes),
      pages: report.pages,
      fileId: report.fileId,
      fileUrl: report.printFileUrl,
      mimeType: report.mimeType,
    },
    params: REPORT_PRINT_PARAMS,
    source: 'document',
    contractReport: {
      fileId: report.fileId,
      abandonToken: report.abandonToken,
    },
  }
}

export function isContractReviewReportPrintEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT === 'true'
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '大小待确认'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}
