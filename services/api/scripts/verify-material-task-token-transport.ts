import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  MaterialsController,
  assertMaterialTaskTokenNotInQuery,
  extractMaterialTaskToken,
} from '../src/materials/materials.controller'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }
function read(root: string, file: string): string { return readFileSync(path.join(root, file), 'utf8') }

function responseCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { error?: { code?: string } } | undefined)?.error?.code
}

async function expectControllerQueryRejected(run: () => Promise<unknown>, secret: string, label: string): Promise<void> {
  try {
    await run()
    fail(`${label} 未拒绝 query accessToken`)
  } catch (error) {
    const status = (error as { getStatus?: () => number }).getStatus?.()
    if (status !== 400 || responseCode(error) !== 'MATERIAL_TOKEN_QUERY_FORBIDDEN') {
      fail(`${label} 错误合同不正确`)
    }
    if (JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()).includes(secret)) {
      fail(`${label} 错误体回显 token`)
    }
    pass(`${label} query accessToken 被 controller 明确拒绝`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Materials 匿名任务 token header-only 合同 ===')
  const secret = 'material-secret-must-not-appear-in-url-or-error'

  try {
    assertMaterialTaskTokenNotInQuery({ accessToken: secret })
    fail('query accessToken 未被拒绝')
  } catch (error) {
    const status = (error as { getStatus?: () => number }).getStatus?.()
    if (status !== 400 || responseCode(error) !== 'MATERIAL_TOKEN_QUERY_FORBIDDEN') {
      fail(`query accessToken 错误合同不正确：status=${String(status)} code=${String(responseCode(error))}`)
    }
    if (JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()).includes(secret)) {
      fail('拒绝响应回显了 query token')
    }
    pass('GET/decision query accessToken 明确 400，且错误体不回显 token')
  }

  const headerToken = extractMaterialTaskToken({ headers: { 'x-material-task-token': `  ${secret}  ` } })
  if (headerToken === secret) pass('x-material-task-token 字符串 header 正常解析')
  else fail('字符串 header 未正常解析')
  const arrayToken = extractMaterialTaskToken({ headers: { 'x-material-task-token': [` ${secret} `] } })
  if (arrayToken === secret) pass('x-material-task-token 数组 header 正常解析')
  else fail('数组 header 未正常解析')

  let capturedRequester: unknown
  const materials = {
    getTask: async (_id: string, requester: unknown) => {
      capturedRequester = requester
      return {}
    },
    decidePiiFindings: async (_id: string, _dto: unknown, requester: unknown) => {
      capturedRequester = requester
      return {}
    },
  }
  const controller = new MaterialsController(materials as never, {} as never, {} as never, {} as never)
  const queryReq = { headers: {}, query: { accessToken: secret } } as never
  await expectControllerQueryRejected(() => controller.getTask('task-1', queryReq), secret, 'GET task')
  await expectControllerQueryRejected(
    () => controller.decidePiiFindings('task-1', { decisions: [] }, queryReq),
    secret,
    'POST PII decisions',
  )
  const headerReq = { headers: { 'x-material-task-token': secret }, query: {} } as never
  await controller.getTask('task-1', headerReq)
  if (JSON.stringify(capturedRequester) === JSON.stringify({ kind: 'anonymous', accessToken: secret })) {
    pass('GET task 将 header token 传入匿名 requester')
  } else {
    fail('GET task 未使用 header token')
  }
  await controller.decidePiiFindings('task-1', { decisions: [] }, headerReq)
  if (JSON.stringify(capturedRequester) === JSON.stringify({ kind: 'anonymous', accessToken: secret })) {
    pass('POST PII decisions 将 header token 传入匿名 requester')
  } else {
    fail('POST PII decisions 未使用 header token')
  }

  const controllerSource = read(apiRoot, 'src/materials/materials.controller.ts')
  if (!controllerSource.includes("@Query('accessToken')") && !controllerSource.includes('queryToken')) {
    pass('Controller 已删除 query 参数声明与 fallback')
  } else {
    fail('Controller 仍声明或回退 query accessToken')
  }

  const kioskClient = read(repoRoot, 'apps/kiosk/src/services/api/materials.ts')
  if (
    kioskClient.includes("headers['x-material-task-token'] = access.accessToken") &&
    !/[?&]accessToken=/.test(kioskClient) &&
    !/searchParams\.(?:set|append)\(['"]accessToken['"]/.test(kioskClient)
  ) {
    pass('Kiosk 官方客户端只通过 header 传匿名材料 token')
  } else {
    fail('Kiosk 官方客户端仍可能把材料 token 写入 URL')
  }

  if (!/console\.(?:log|info|warn|error).*accessToken/.test(controllerSource)) {
    pass('Controller 不记录或拼接 accessToken 日志')
  } else {
    fail('Controller 可能记录 accessToken')
  }

  console.log('\nALL PASS')
}

void main()
