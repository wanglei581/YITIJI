/**
 * 打印完成判据：解析 wevtutil 输出、启动自检状态机、安装脚本必须启用日志并在失败时停住。
 * Windows 上再只读核对一次本机日志。测试不去启用日志。
 * 非 Windows 跳过本机核对，并写明跳过。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRINT_SERVICE_OPERATIONAL_LOG,
  parsePrintServiceLogEnabled,
  printCompletionHeartbeatField,
  resetPrintCompletionEvidenceForTests,
  resolvePrintCompletionEvidence,
  type PrintCompletionProbe,
  type PrintServiceLogCommandResult,
} from '../src/agent/print-service-log'

const ROOT = join(__dirname, '..')

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0 && endIndex > startIndex, '安装脚本缺少打印完成日志标记')
  return source.slice(startIndex, endIndex)
}

function enabledOutput(enabled: boolean): PrintServiceLogCommandResult {
  return { ok: true, output: `name: ${PRINT_SERVICE_OPERATIONAL_LOG}\nenabled: ${enabled}\n` }
}

function verifyLogic(): void {
  assert.equal(parsePrintServiceLogEnabled('enabled: true'), true)
  assert.equal(parsePrintServiceLogEnabled('  enabled: false\n'), false)
  assert.equal(parsePrintServiceLogEnabled('ENABLED: TRUE'), true)
  assert.equal(parsePrintServiceLogEnabled('logging is true'), null)

  resetPrintCompletionEvidenceForTests()
  assert.deepEqual(printCompletionHeartbeatField(), {})

  const calls: string[] = []
  const logs: string[] = []
  const errors: string[] = []
  const probe = (platform: NodeJS.Platform, query: PrintCompletionProbe['query'], enable: PrintCompletionProbe['enable']): PrintCompletionProbe => ({
    platform,
    query: () => {
      calls.push('query')
      return query()
    },
    enable: () => {
      calls.push('enable')
      return enable()
    },
    log: (message) => logs.push(message),
    err: (message) => errors.push(message),
  })

  resetPrintCompletionEvidenceForTests()
  calls.length = 0
  assert.equal(
    resolvePrintCompletionEvidence(probe('win32', () => enabledOutput(true), () => enabledOutput(true))),
    'available',
  )
  assert.deepEqual(calls, ['query'])
  assert.equal(printCompletionHeartbeatField().printCompletionEvidence, 'available')

  resetPrintCompletionEvidenceForTests()
  calls.length = 0
  logs.length = 0
  errors.length = 0
  let queries = 0
  assert.equal(
    resolvePrintCompletionEvidence(probe(
      'win32',
      () => {
        queries += 1
        return enabledOutput(queries > 1)
      },
      () => ({ ok: true, output: '' }),
    )),
    'available',
  )
  assert.deepEqual(calls, ['query', 'enable', 'query'])

  resetPrintCompletionEvidenceForTests()
  calls.length = 0
  errors.length = 0
  assert.equal(
    resolvePrintCompletionEvidence(probe(
      'win32',
      () => enabledOutput(false),
      () => ({ ok: false, output: '', error: '拒绝访问' }),
    )),
    'unavailable',
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /打印完成判据不可用/)
  assert.match(errors[0] ?? '', /拒绝访问/)
  assert.equal(printCompletionHeartbeatField().printCompletionEvidence, 'unavailable')

  resetPrintCompletionEvidenceForTests()
  calls.length = 0
  logs.length = 0
  assert.equal(
    resolvePrintCompletionEvidence(probe('darwin', () => enabledOutput(true), () => enabledOutput(true))),
    'unavailable',
  )
  assert.deepEqual(calls, [])
  assert.match(logs[0] ?? '', /不是 Windows/)
  console.log('PASS 打印完成判据状态机')
}

function verifyScripts(): void {
  const production = sliceBetween(
    read('scripts/install-production-agent.ps1'),
    '# print-service-operational-log-begin',
    '# print-service-operational-log-end',
  )
  const provision = sliceBetween(
    read('installer/provision/provision-installed-agent.ps1'),
    '# print-service-operational-log-begin',
    '# print-service-operational-log-end',
  )
  assert.equal(production, provision, '安装脚本和安装包预配脚本启用日志的函数必须一致')
  for (const body of [production, provision]) {
    assert.match(body, /wevtutil\.exe sl \$logName \/e:true/)
    assert.match(body, /\$enableExit = \$LASTEXITCODE/)
    assert.match(body, /\$listExit = \$LASTEXITCODE/)
    assert.ok(body.indexOf('$enableExit = $LASTEXITCODE') < body.indexOf('| Out-String'))
    assert.ok(body.indexOf('$listExit = $LASTEXITCODE') < body.indexOf('| Out-String'))
    assert.match(body, /Microsoft-Windows-PrintService\/Operational/)
    assert.match(body, /Fail /)
    assert.doesNotMatch(body, /SilentlyContinue/)
  }
  assert.match(read('scripts/install-production-agent.ps1'), /Enable-PrintServiceOperationalLog/)
  assert.match(read('installer/provision/provision-installed-agent.ps1'), /Enable-PrintServiceOperationalLog/)
  const agentIndex = read('src/index.ts')
  const heartbeat = read('src/agent/heartbeat.ts')
  assert.ok(agentIndex.indexOf('checkPrintCompletionEvidenceAtStartup()') < agentIndex.indexOf('sendHeartbeat(heartbeatOptions)'))
  assert.match(heartbeat, /printCompletionHeartbeatField\(\)/)
  console.log('PASS 安装脚本启用打印完成日志，失败会停下；心跳在自检之后才带字段')
}

function verifyLiveRead(): void {
  if (process.platform !== 'win32') {
    console.log('print-completion: 跳过本机 wevtutil 只读核对（不是 Windows）')
    const production = read('scripts/install-production-agent.ps1')
    assert.match(production, /wevtutil\.exe/)
    assert.match(production, /Microsoft-Windows-PrintService\/Operational/)
    return
  }
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const result = spawnSync('wevtutil', ['gl', PRINT_SERVICE_OPERATIONAL_LOG], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.error) {
    throw new Error(`Windows 上找不到 wevtutil，无法核对打印完成事件日志：${result.error.message}`)
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0) {
    throw new Error(`wevtutil gl 退出码 ${result.status ?? 'null'}：${output}`)
  }
  const enabled = parsePrintServiceLogEnabled(output)
  if (enabled == null) throw new Error(`wevtutil gl 输出里没有 enabled 行：${output}`)
  console.log(`print-completion: 本机日志 enabled=${enabled}（只读，测试不去启用）`)
}

export function verifyPrintCompletionEvidence(options?: { liveProbe?: boolean }): void {
  verifyLogic()
  verifyScripts()
  const live = options?.liveProbe ?? process.platform === 'win32'
  if (!live) {
    verifyLiveRead()
    return
  }
  if (process.platform !== 'win32') {
    throw new Error('本机核对只应在 Windows 上打开')
  }
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const result = spawnSync('wevtutil', ['gl', PRINT_SERVICE_OPERATIONAL_LOG], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.error) {
    throw new Error(`Windows 上找不到 wevtutil，无法核对打印完成事件日志：${result.error.message}`)
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0) throw new Error(`wevtutil gl 退出码 ${result.status ?? 'null'}：${output}`)
  const enabled = parsePrintServiceLogEnabled(output)
  if (enabled == null) throw new Error(`wevtutil gl 输出里没有 enabled 行：${output}`)
  console.log(`print-completion: 本机日志 enabled=${enabled}（只读，测试不去启用）`)
}

if (require.main === module) {
  try {
    verifyPrintCompletionEvidence()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
