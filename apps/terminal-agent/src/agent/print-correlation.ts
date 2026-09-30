/**
 * 打印临时文件名、传给打印的 correlationId、队列匹配键共用同一个 stem。
 * attempt 为 0 且任务号已是安全字符时，stem 就是任务号，文件名仍是 task_<任务号>.<ext>。
 * attempt 大于 0 时 stem 带 _a<attempt>，新一轮监控只认本轮作业，不会选中上一轮残留。
 *
 * 另一条开机清理按下面这条正则删除本进程账号留在 Windows 打印队列里的作业
 * （任务失败终态、以及每次派发前）。本文件不重复做删除。新名字必须仍能被它匹配，下划线允许。
 *
 * 混合版本不做协商：attempt>0 的重提在老 Agent 上仍按 attempt 0 判重，不会再次出纸。
 * 发布顺序是先服务端、再 Agent 0.4.13。R.2 已写明 Agent 须配新服务端。
 */

/** 开机清理用来识别本进程打印临时文件的正则。新文件名必须整段匹配。 */
export const BOOT_QUEUE_CLEANUP_TASK_FILE_RE =
  /^task_[A-Za-z0-9_-]{1,128}(\.[A-Za-z0-9]+)$/

const SAFE_STEM = /^[A-Za-z0-9_-]{1,128}$/

function sanitizeTaskId(taskId: string): string {
  const safe = taskId.replace(/[^A-Za-z0-9_-]/g, '')
  return safe.length > 0 ? safe : 'task'
}

/** 队列文档名和 correlationId 用的 stem。长度上限 128，给开机清理的 task_ 前缀留位置。 */
export function printSpoolStem(taskId: string, attempt: number): string {
  const round = Number.isInteger(attempt) && attempt > 0 ? attempt : 0
  if (round === 0 && SAFE_STEM.test(taskId)) return taskId
  const safe = sanitizeTaskId(taskId)
  if (round === 0) return safe.slice(0, 128)
  const suffix = `_a${round}`
  const room = Math.max(1, 128 - suffix.length)
  return `${safe.slice(0, room)}${suffix}`
}

export function printTempFileName(taskId: string, attempt: number, ext: string): string {
  return `task_${printSpoolStem(taskId, attempt)}${ext}`
}

/**
 * attempt 0 保持宽松包含，兼容已在队列里的 task_<任务号>.pdf 和 print_<任务号>_<uuid>.pdf。
 * attempt>0 要求 stem 后面是 `.`（PDF）或 `_`（图片转 PDF），避免 _a1 选中 _a10，
 * 也避免选中上一轮 task_<任务号>.pdf。
 */
export function documentNameMatchesSpool(documentName: string, stem: string): boolean {
  if (!stem) return false
  if (/_a[0-9]+$/.test(stem)) {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`${escaped}(?:\\.|_)`).test(documentName)
  }
  return documentName.includes(stem)
}
