import type { ReactNode } from 'react'
import { ENCRYPTED_PDF_BLOCK_COPY } from './components/printPreviewKind'
import type { MaterialCheckStage } from './components/MaterialCheckPresentation'

/**
 * 稿 13 打印台：小青横幅标题、顶栏状态、底栏说明按**运行页真实状态**换句子。
 * 稿里有、但运行页判定不了的话（例如「宁可白等也不放行」这类与真实禁用条件不符的）不照搬。
 */

type Tone = 'ok' | 'warn' | 'bad'

export interface DeskCopy {
  title: ReactNode
  detail: string
  status: { tone: Tone; label: string }
}

const STEP2 = '第 2 步 / 共 4 步 · '
const STEP3 = '第 3 步 / 共 4 步 · '

export interface CheckCopyInput {
  encryptedPdf: boolean
  stage: MaterialCheckStage
  isWorking: boolean
  retrying: boolean
  submitFailed: boolean
  requiresFormatReview: boolean
  piiScanIncomplete: boolean
  scanSkipped: boolean
  findingCount: number
  remaining: number
}

export function checkDeskCopy(input: CheckCopyInput): DeskCopy & { why: string } {
  const { findingCount: n, remaining } = input
  if (input.encryptedPdf) {
    return {
      title: <>这份 PDF <em>打不开</em>。</>,
      detail: ENCRYPTED_PDF_BLOCK_COPY,
      status: { tone: 'bad', label: '这份 PDF 打不开' },
      why: ENCRYPTED_PDF_BLOCK_COPY,
    }
  }
  if (input.stage === 'error') {
    return {
      title: <>检查<em>没做成</em>。</>,
      detail: '结果未知。没检查完不能继续打印。可以重试，也可以返回选文件。',
      status: { tone: 'bad', label: '材料检查失败 · 结果未知' },
      why: '检查结果未知，隐私预检不可跳过。请重试或返回重新选择文件。',
    }
  }
  if (input.isWorking || input.stage === 'idle') {
    if (input.stage === 'submitting') {
      return {
        title: <>正在<em>生成遮挡文件</em>。</>,
        detail: '按你选的遮挡另出一份用于打印，上传的原件不改。完成前不能进入预览。',
        status: { tone: 'warn', label: '正在生成遮挡文件' },
        why: '正在保存选择并生成遮挡文件，完成前不能进入预览。',
      }
    }
    if (input.retrying) {
      return {
        title: <>正在<em>重新检查</em>。</>,
        detail: '还是刚才那一份，再查一次，不重复收费。',
        status: { tone: 'warn', label: '正在重新检查' },
        why: '正在重新检查这份文件，结果返回前不能进入预览，也不会自动放行。',
      }
    }
    return {
      title: <>正在<em>读这份文件</em>。</>,
      detail: '结论没回来之前不说「没问题」，也不自动放行。',
      status: { tone: 'warn', label: `${STEP2}正在检查` },
      why: '正在检查材料，结果返回前不能进入预览，也不会自动放行。',
    }
  }
  if (input.submitFailed) {
    return {
      title: <>遮挡<em>没做成</em>。</>,
      detail: '打印文件还没更新。你的选择还在，再点一次继续就会重试。',
      status: { tone: 'bad', label: '遮挡处理未完成 · 请重试' },
      why: '上次保存选择或遮挡处理没有完成，打印文件未更新。请再次点击继续重试。',
    }
  }
  if (input.requiresFormatReview) {
    return {
      title: <>这份文件<em>印不了</em>。</>,
      detail: '文件体检判定它不能直接打印，请返回重新上传。',
      status: { tone: 'bad', label: '文件需要重新上传' },
      why: '文件体检判定当前文件不能直接打印，请返回重新上传。',
    }
  }
  if (input.piiScanIncomplete) {
    return {
      title: <>隐私检查<em>没查全</em>。</>,
      detail: remaining > 0 ? '先把已标出的每一处选好，再由你确认按原件继续。' : '剩下的只能靠你自己再看一遍，确认后按原件继续。',
      status: { tone: 'warn', label: '请你确认后按原件继续' },
      why: remaining > 0
        ? '每一处已经标出的内容都要先选择保留或遮挡，然后再确认按原件继续。'
        : '文字识别这次没覆盖这份文件。确认后按原件继续，本机不会生成遮挡文件。',
    }
  }
  if (n > 0 && remaining === n) {
    return {
      title: <>有 {n} 处<em>要你拿主意</em>。</>,
      detail: '逐条选保留或遮挡；选完才能继续。',
      status: { tone: 'warn', label: `${STEP2}${n} 处待决定` },
      why: '每一处隐私片段都必须由你选择保留或遮挡。',
    }
  }
  if (n > 0 && remaining > 0) {
    return {
      title: <>还剩 {remaining} 处<em>没决定</em>。</>,
      detail: `${n} 处都得你亲自选「保留」或「遮挡」，选完才放行。`,
      status: { tone: 'warn', label: `${STEP2}还剩 ${remaining} 处` },
      why: '每一处隐私片段都必须由你选择保留或遮挡。',
    }
  }
  if (n > 0) {
    return {
      title: n === 1 ? <>这一处<em>决定好了</em>。</> : <>{n} 处<em>都决定完了</em>。</>,
      detail: '可以去预览，核对版面和参数。',
      status: { tone: 'ok', label: `${STEP2}决定完成` },
      why: '继续后会保存选择，并按处理结果准备打印文件。',
    }
  }
  if (input.scanSkipped) {
    return {
      title: <>这类文件<em>不做内容扫描</em>。</>,
      detail: '没扫描就不说没有隐私内容。你自己再看一眼更稳妥。',
      status: { tone: 'ok', label: `${STEP2}检查完成` },
      why: '继续后会保存选择，并按处理结果准备打印文件。',
    }
  }
  return {
    title: <><em>没命中</em>敏感片段。</>,
    detail: '规则没查到，不等于一定没有。你自己再看一眼更稳妥。',
    status: { tone: 'ok', label: `${STEP2}检查完成` },
    why: '继续后会保存选择，并按处理结果准备打印文件。',
  }
}

export interface PreviewCopyInput {
  unsupported: boolean
  printerLoading: boolean
  printerNotice: string | null
  printerLabel: string
  printerKind: string
  printerReady: boolean
  capabilityLoading: boolean
  capabilityUnknown: boolean
  capabilityNote: string | null
}

export function previewDeskCopy(input: PreviewCopyInput): DeskCopy {
  if (input.unsupported) {
    return {
      title: <>这份文件<em>印不了</em>。</>,
      detail: '打印只收 PDF / JPG / PNG，请返回重新选择文件。',
      status: { tone: 'bad', label: '当前文件不能预览打印' },
    }
  }
  if (input.printerLoading) {
    return {
      title: <>正在<em>读设备状态</em>。</>,
      detail: '读到之前不放行，免得你白跑一趟。',
      status: { tone: 'warn', label: '正在读取打印机状态' },
    }
  }
  if (input.printerNotice) {
    return {
      title: <>这台打印机<em>暂时不接单</em>。</>,
      detail: input.printerNotice,
      status: { tone: 'bad', label: input.printerLabel },
    }
  }
  if (!input.printerReady) {
    if (input.printerKind === 'offline') {
      return {
        title: <>打印机<em>离线</em>。</>,
        detail: '现在联系不上这台打印机，出不了纸。',
        status: { tone: 'bad', label: '打印机离线' },
      }
    }
    if (input.printerKind === 'error') {
      return {
        title: <>打印机<em>报了异常</em>。</>,
        detail: '需要工作人员处理之后才能出纸。',
        status: { tone: 'bad', label: '打印机异常' },
      }
    }
    return {
      title: <>打印机状态<em>读不到</em>。</>,
      detail: '不说它离线，也不说它正常 —— 确实不知道，所以不放行。',
      status: { tone: 'warn', label: '打印机状态未知' },
    }
  }
  if (input.capabilityLoading) {
    return {
      title: <>本机能力<em>还在确认</em>。</>,
      detail: '确认完才知道彩色和双面能不能选；黑白单面照常可设。',
      status: { tone: 'ok', label: `${STEP3}预览与参数` },
    }
  }
  if (input.capabilityNote) {
    return {
      title: <>你带来的参数<em>本机暂未开通</em>。</>,
      detail: `${input.capabilityNote}，核对后就能继续。`,
      status: { tone: 'warn', label: '参数已按本机能力调整' },
    }
  }
  if (input.capabilityUnknown) {
    return {
      title: <>读不到<em>本机能力</em>。</>,
      detail: '彩色和双面先按暂未开通处理；黑白单面照常可设。',
      status: { tone: 'ok', label: `${STEP3}预览与参数` },
    }
  }
  return {
    title: <>纸上<em>会长这样</em>。</>,
    detail: '核对内容与参数，下一步看价格，最后带走打印件。',
    status: { tone: 'ok', label: `${STEP3}预览与参数` },
  }
}
