import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

console.log('\n=== Kiosk print progress UI verification ===')

const api = read('src/services/print/printJobsApi.ts')
const page = read('src/pages/print/PrintProgressPage.tsx')

assert(
  api.includes("'cancelled'") && api.includes('BackendJobStatus'),
  'print job status API type includes cancelled',
)

assert(
  page.includes("result.status === 'cancelled'") &&
    page.includes('任务已被工作人员取消') &&
    page.includes('navigateFail'),
  'PrintProgressPage explicitly handles cancelled and exits the polling flow',
)

assert(
  page.includes('lastStatus') &&
    page.includes('lastStatusAt') &&
    page.includes('任务编号') &&
    page.includes('后端状态') &&
    page.includes('最近更新'),
  'PrintProgressPage shows task id, backend status, and last update time during real polling',
)

assert(
  !/status\s*===\s*'cancelled'[\s\S]{0,120}backendStatusToStep/.test(page),
  'cancelled is not mapped back to a queueing/printing progress step',
)

console.log('\nALL PASS')
