// 出纸页（稿 15-print-fulfill）的轮询参数与真实任务状态话术。纯常量与纯函数：不发请求、不轮询、不判定成败。
// 轮询、超时判定与跳转仍在 PrintProgressPage 里，门禁按页面文件与本文件一起取证。
//
// pending / claimed / printing 各说各的：只有 printing 才说「正在出纸」，没拿到状态就说「正在确认」，不编进度。

import type { BackendJobStatus } from '../../services/print/printJobsApi'

export const POLL_INTERVAL_MS = 3000
export const POLL_FAIL_LIMIT = 5
export const REAL_POLL_TIMEOUT_MS = 10 * 60 * 1000
export const STATUS_READ_ERROR_TEXT = '暂时无法读取状态'

export function realStatusPresentation(status: BackendJobStatus | null) {
  switch (status) {
    case 'pending':
      return {
        headerTitle: '等待终端领取',
        headerSubtitle: '任务已进入队列，终端尚未领取，请留在机器旁',
        stageTitle: '等待终端领取',
        stageSubtitle: '任务正在队列中等待，尚未发送到打印机',
        queueLabel: '等待终端领取',
        queueDesc: '任务正在队列中，终端尚未领取',
        activeHint: '等待终端领取…',
        askPhase: '等待终端领取',
        badge: '排队等待中',
      }
    case 'claimed':
      return {
        headerTitle: '终端已领取任务',
        headerSubtitle: '终端正在准备打印，请留在机器旁',
        stageTitle: '终端已领取任务',
        stageSubtitle: '终端已领取任务，正在准备打印',
        queueLabel: '终端已领取',
        queueDesc: '终端已领取任务，正在准备打印',
        activeHint: '终端准备中…',
        askPhase: '终端准备打印',
        badge: '终端准备中',
      }
    case 'printing':
      return {
        headerTitle: '正在打印',
        headerSubtitle: '打印机正在出纸，请留在机器旁及时取件',
        stageTitle: '正在打印',
        stageSubtitle: '打印机正在出纸，请在出纸口等候',
        queueLabel: '终端已领取',
        queueDesc: '终端已领取任务并进入打印阶段',
        activeHint: '打印机正在出纸…',
        askPhase: '正在出纸',
        badge: '打印进行中',
      }
    default:
      return {
        headerTitle: '正在确认任务状态',
        headerSubtitle: '任务已提交，正在读取终端状态，请留在机器旁',
        stageTitle: '正在确认任务状态',
        stageSubtitle: '尚未收到终端处理状态',
        queueLabel: '等待状态更新',
        queueDesc: '正在确认这台机器有没有领到任务',
        activeHint: '正在读取状态…',
        askPhase: '正在确认状态',
        badge: '状态确认中',
      }
  }
}
