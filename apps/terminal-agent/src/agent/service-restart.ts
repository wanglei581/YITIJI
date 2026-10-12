/** 固定计划任务由 SCM 正常停止/启动；不拼接命令行。 */
import { execFile } from 'node:child_process'

export async function requestServiceRestart(options: {
  taskName?: string
  platform?: NodeJS.Platform
} = {}): Promise<boolean> {
  if ((options.platform ?? process.platform) !== 'win32') return false
  return new Promise((resolve) => {
    execFile('schtasks.exe', ['/run', '/tn', options.taskName ?? 'AIJobPrintAgentRestart'],
      { timeout: 15_000, windowsHide: true }, (error) => resolve(error === null))
  })
}
