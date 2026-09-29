import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { monitorPrintJob } from '../src/agent/task-runner'
import {
  buildPrintServiceCompletionEventScript,
  mapWin32PrinterPreflight,
  mapWin32PrinterQuery,
  parsePrintJobStatus,
  type PrintJobMonitorStatus,
} from '../src/agent/wmi'
import { printWithPdfToPrinter } from '../src/printer/print-with-pdf-to-printer'
import { buildImageTempPdfFileName } from '../src/printer/image-to-pdf'

interface Scenario {
  name: string
  statuses: PrintJobMonitorStatus[]
  expectedFailed: boolean
  expectedErrorCode: string
  completionEvent?: boolean
  initialNow?: number
  dispatchedAtMs?: number
}

function verifyPrintServiceCompletionScriptContract(): void {
  const script = buildPrintServiceCompletionEventScript()
  assert.match(
    script,
    /LogName='Microsoft-Windows-PrintService\/Operational'; Id=307; StartTime=\$since/,
    'completion evidence must be a PrintService 307 emitted after dispatch',
  )
  assert.match(
    script,
    /\$raw -like "\*\$tId\*"/,
    'completion correlation must inspect locale-independent Event XML for the taskId',
  )
  assert.match(script, /Param5/, 'generic-document fallback must read the target queue')
  assert.match(script, /Param2/, 'generic-document fallback must read the document name')
  assert.match(script, /打印文档/, 'generic-document fallback must allow only the field-verified Pantum name')
  assert.match(
    script,
    /S-1-5-18/,
    'generic-document fallback must require the LocalSystem service identity',
  )
  assert.doesNotMatch(
    script,
    /\.Message/,
    'localized formatted message text must not gate completion',
  )

  if (process.platform !== 'win32') return

  const taskId = 'ptask_kiosk_0123456789abcdef'
  const runFixture = (xml: string): string => {
    const escapedXml = xml.replace(/'/g, "''")
    const fixtureScript =
      `function Get-WinEvent { [CmdletBinding()] param([hashtable]$FilterHashtable); ` +
      `if ($FilterHashtable.LogName -ne 'Microsoft-Windows-PrintService/Operational' -or ` +
      `$FilterHashtable.Id -ne 307 -or $null -eq $FilterHashtable.StartTime) { return }; ` +
      `$fixture = [pscustomobject]@{ Xml = '${escapedXml}' }; ` +
      `$fixture | Add-Member -MemberType ScriptMethod -Name ToXml -Value { $this.Xml }; ` +
      `$fixture }; ` +
      script
    const result = spawnSync(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-Command', fixtureScript],
      {
        input: JSON.stringify({
          taskId,
          printerName: 'Configured Printer',
          dispatchedAtMs: Date.now(),
        }),
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, `PowerShell completion fixture failed: ${result.stderr}`)
    return result.stdout.trim().toLowerCase()
  }

  assert.equal(
    runFixture(
      `<Event><System><Security UserID="S-1-5-18" /></System>` +
        `<EventData><Data Name="Param2">print_${taskId}_fixture.pdf</Data>` +
        `<Data Name="Param5">Pantum USB001</Data></EventData></Event>`,
    ),
    'true',
    'a matching taskId must confirm even when Event 307 contains only a driver/port alias',
  )
  assert.equal(
    runFixture(
      '<Event><EventData><Data Name="Param2">print_other_task_fixture.pdf</Data></EventData></Event>',
    ),
    'false',
    'an unrelated Event 307 must not confirm the task',
  )

  const genericPantumEvent =
    `<Event><System><Security UserID="S-1-5-18" /></System><UserData>` +
    `<DocumentPrinted><Param1>2</Param1><Param2>打印文档</Param2><Param3>SYSTEM</Param3>` +
    `<Param4>\\DESKTOP-FIXTURE</Param4><Param5>Configured Printer</Param5>` +
    `<Param6>USB001</Param6><Param7>129994520</Param7><Param8>1</Param8>` +
    `</DocumentPrinted></UserData></Event>`
  assert.equal(
    runFixture(genericPantumEvent),
    'true',
    'Pantum generic document names must confirm when queue, LocalSystem identity, and dispatch time match',
  )
  assert.equal(
    runFixture(genericPantumEvent.replace('Configured Printer', 'Other Printer')),
    'false',
    'a generic document event from another queue must not confirm the task',
  )
  assert.equal(
    runFixture(genericPantumEvent.replace('S-1-5-18', 'S-1-5-21-1234')),
    'false',
    'a generic document event from a non-Agent user must not confirm the task',
  )
  assert.equal(
    runFixture(genericPantumEvent.replace('打印文档', 'unrelated-system-job.pdf')),
    'false',
    'an unrelated LocalSystem document on the same queue must not confirm the task',
  )
}

async function runScenario(scenario: Scenario): Promise<void> {
  let now = scenario.initialNow ?? 0
  let cursor = 0
  const fallback = scenario.statuses.at(-1) ?? 'unknown'

  const result = await monitorPrintJob('Configured Printer', 'task-monitor-test', 10, 1, {
    platform: 'win32',
    now: () => now,
    sleep: async (ms) => {
      now += Math.max(ms, 1)
    },
    queryStatus: async () => ({
      status: scenario.statuses[cursor++] ?? fallback,
      rawStatus: fallback === 'printing' ? 'Printing' : undefined,
    }),
    dispatchedAtMs: scenario.dispatchedAtMs,
    queryCompletionEvent: async (printerName, taskId, dispatchedAtMs) => {
      assert.equal(printerName, 'Configured Printer', `${scenario.name}: completion printer`)
      assert.equal(taskId, 'task-monitor-test', `${scenario.name}: completion taskId`)
      if (scenario.dispatchedAtMs !== undefined) {
        assert.equal(
          dispatchedAtMs,
          scenario.dispatchedAtMs,
          `${scenario.name}: completion dispatch lower bound`,
        )
      }
      return scenario.completionEvent ?? false
    },
  })

  assert.equal(result.failed, scenario.expectedFailed, `${scenario.name}: terminal disposition`)
  assert.equal(result.errorCode, scenario.expectedErrorCode, `${scenario.name}: errorCode`)
}

async function main(): Promise<void> {
  const failures: string[] = []

  verifyPrintServiceCompletionScriptContract()

  const imageTaskId = 'ptask_kiosk_0123456789abcdef'
  const fixedUuid = '11111111-2222-4333-8444-555555555555'
  assert.equal(
    buildImageTempPdfFileName(imageTaskId, fixedUuid),
    `print_${imageTaskId}_${fixedUuid}.pdf`,
    'converted image PDF must preserve the exact taskId for spooler correlation',
  )
  assert.equal(
    buildImageTempPdfFileName('task/with|unsafe:*chars', fixedUuid),
    `print_taskwithunsafechars_${fixedUuid}.pdf`,
    'converted image PDF correlation id must be safe for a Windows filename',
  )
  assert.equal(
    buildImageTempPdfFileName(undefined, fixedUuid),
    `print_${fixedUuid}.pdf`,
    'CLI image printing without a task context must keep the legacy random filename',
  )

  const commandTimeout = await printWithPdfToPrinter(
    '/fault-injection/task-timeout.pdf',
    'Configured Printer',
    undefined,
    {
      dispatch: () => new Promise<void>(() => undefined),
      timeoutMs: 1,
    }
  )
  assert.equal(commandTimeout.success, false, 'print command timeout must fail')
  assert.equal(commandTimeout.errorCode, 'PRINT_TIMEOUT')

  // 下发给 SumatraPDF 的参数：彩色与黑白都必须显式给出，不能落到驱动默认值（驱动默认灰度时彩色单会出黑白纸）。
  const dispatched: Array<Record<string, unknown>> = []
  const capture = async (_file: string, options?: object): Promise<void> => { dispatched.push({ ...(options ?? {}) }) }
  await printWithPdfToPrinter('/params/color.pdf', 'Configured Printer', { colorMode: 'color', duplex: 'duplex_long_edge', copies: 2 }, { dispatch: capture })
  await printWithPdfToPrinter('/params/mono.pdf', 'Configured Printer', { colorMode: 'black_white', duplex: 'duplex_short_edge' }, { dispatch: capture })
  await printWithPdfToPrinter('/params/simplex.pdf', 'Configured Printer', { duplex: 'simplex' }, { dispatch: capture })
  assert.equal(dispatched[0]?.monochrome, false, 'color jobs must force color (pdf-to-printer turns monochrome=false into "color")')
  assert.equal(dispatched[0]?.side, 'duplexlong', 'long-edge duplex must be sent explicitly')
  assert.equal(dispatched[0]?.copies, 2)
  assert.equal(dispatched[1]?.monochrome, true, 'black-and-white jobs must force monochrome')
  assert.equal(dispatched[1]?.side, 'duplexshort', 'short-edge duplex must be sent explicitly')
  assert.equal(dispatched[2]?.side, 'simplex', 'simplex must be sent explicitly, not left to the driver default')
  assert.equal('monochrome' in (dispatched[2] ?? {}), false, 'no colour choice in the params means no colour setting is invented')

  try {
    const nonWindows = await monitorPrintJob('Configured Printer', 'task-non-windows', 10, 1, {
      platform: 'darwin',
    })
    assert.equal(nonWindows.failed, true, 'monitor unavailable must not confirm completed')
    assert.equal(nonWindows.errorCode, 'PRINT_JOB_UNCONFIRMED')
  } catch (error) {
    failures.push(`monitor unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  const scenarios: Scenario[] = [
    {
      name: 'job never matched in spooler',
      statuses: ['not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'fast job left queue before first poll but has matching PrintService 307',
      statuses: ['not_found'],
      expectedFailed: false,
      expectedErrorCode: '',
      completionEvent: true,
    },
    {
      name: 'spooler query remains unknown until timeout',
      statuses: ['unknown'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'spooler query unavailable but matching PrintService 307 confirms completion',
      statuses: ['unknown'],
      expectedFailed: false,
      expectedErrorCode: '',
      completionEvent: true,
    },
    {
      name: 'job remains printing until timeout',
      statuses: ['printing'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'job remains retained until timeout',
      statuses: ['retained'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'retained job with matching PrintService 307 confirms completion',
      statuses: ['retained'],
      expectedFailed: false,
      expectedErrorCode: '',
      completionEvent: true,
    },
    {
      name: 'slow command does not consume retained-job monitoring window',
      statuses: ['retained'],
      expectedFailed: false,
      expectedErrorCode: '',
      completionEvent: true,
      initialNow: 100,
      dispatchedAtMs: 1,
    },
    {
      name: 'observed job then queue removal confirms completion',
      statuses: ['printing', 'not_found'],
      expectedFailed: false,
      expectedErrorCode: '',
    },
    {
      name: 'explicit completed status confirms completion',
      statuses: ['completed'],
      expectedFailed: false,
      expectedErrorCode: '',
    },
    {
      name: 'two consecutive paper-out samples confirm failure',
      statuses: ['paper_empty', 'paper_empty'],
      expectedFailed: true,
      expectedErrorCode: 'PAPER_EMPTY',
    },
    {
      name: 'one paper-out sample then disappearance is not completion evidence',
      statuses: ['paper_empty', 'not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'observed active job then paper-out then disappearance is not completion evidence',
      statuses: ['printing', 'paper_empty', 'not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'paper-out signal is not overridden by a later completion event on unknown status',
      statuses: ['paper_empty', 'unknown'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      completionEvent: true,
    },
    {
      name: 'explicit spooler error confirms failure',
      statuses: ['error'],
      expectedFailed: true,
      expectedErrorCode: 'PRINTER_ERROR',
    },
  ]

  for (const scenario of scenarios) {
    try {
      await runScenario(scenario)
    } catch (error) {
      failures.push(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const explicitFailures = [
    'Deleting',
    'Deleted',
    'Cancelled',
    'Canceled',
    'Jammed',
    'Error',
    'UserIntervention',
    'Retained, Deleted',
    'Printed, PaperOut',
  ]
  for (const rawStatus of explicitFailures) {
    const parsed = parsePrintJobStatus(rawStatus)
    const expected = rawStatus.includes('PaperOut') ? 'paper_empty' : 'error'
    try {
      assert.equal(parsed.status, expected, `${rawStatus}: explicit failure must take priority`)
    } catch (error) {
      failures.push(`${rawStatus}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const rawStatus of ['Complete', 'Completed', 'Printed']) {
    try {
      assert.equal(
        parsePrintJobStatus(rawStatus).status,
        'completed',
        `${rawStatus}: explicit completion`
      )
    } catch (error) {
      failures.push(`${rawStatus}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // AGT-05: heartbeat mapping — missing printer is error (aligned with
  // getPrinterPreflight distinguishing not_found from an empty/failed query).
  // DetectedErrorState=0 is CIM Unknown and the Pantum driver never populates it
  // (checklist [N2]: 0 both idle and powered off), so readiness falls back to
  // PrinterStatus once WorkOffline / PrinterStatus=7 have ruled out offline.
  // 第三列是预检。查询失败仍是 unknown；解析成功但心跳 unknown 时预检不拦打印（ok）。
  // 后两列是 PrinterState,ExtendedPrinterStatus。仅暂停视为就绪；离线/缺纸/故障位优先。
  const printerQueryCases: Array<[string | null, string, string]> = [
    [null, 'unknown', 'unknown'],
    ['', 'unknown', 'unknown'],
    ['not_found', 'error', 'not_found'],
    ['3,0,False', 'ready', 'ok'],
    ['4,0,False', 'ready', 'ok'],
    ['5,0,False', 'ready', 'ok'],
    ['3,0,True', 'offline', 'offline'],
    ['7,0,False', 'offline', 'offline'],
    ['6,0,False', 'unknown', 'ok'],
    ['2,0,False', 'unknown', 'ok'],
    ['3,4,True', 'offline', 'offline'],
    ['3,2,False', 'ready', 'ok'],
    ['3,3,False', 'low_paper', 'ok'],
    ['3,5,False', 'low_paper', 'ok'],
    ['3,4,False', 'paper_empty', 'paper_empty'],
    ['3,6,False', 'error', 'error'],
    ['3,7,False', 'error', 'error'],
    ['3,8,False', 'error', 'error'],
    ['7,2,False', 'offline', 'offline'],
    ['3,9,False', 'offline', 'offline'],
    ['3,2,True', 'offline', 'offline'],
    ['idle,nope,False', 'unknown', 'unknown'],
    ['1,0,False', 'unknown', 'ok'],
    ['1,0,False,1,8', 'ready', 'ok'],
    ['6,0,False,1,8', 'ready', 'ok'],
    ['2,0,False,1,8', 'ready', 'ok'],
    ['1,0,False,0,3', 'unknown', 'ok'],
    ['1,0,False,,8', 'ready', 'ok'],
    ['3,0,True,1,8', 'offline', 'offline'],
    ['7,0,False,1,8', 'offline', 'offline'],
    ['3,9,False,1,8', 'offline', 'offline'],
    ['3,4,False,1,8', 'paper_empty', 'paper_empty'],
    ['3,8,False,1,8', 'error', 'error'],
    ['1,3,False,1,8', 'low_paper', 'ok'],
    ['1,0,False,129,8', 'offline', 'offline'],
    ['1,0,False,17,8', 'paper_empty', 'paper_empty'],
    ['1,0,False,9,8', 'error', 'error'],
    ['1,0,False,3,8', 'error', 'error'],
    ['3,0,False,0,3', 'ready', 'ok'],
    ['4,0,False,1,8', 'ready', 'ok'],
    ['1,0,False,131073,8', 'ready', 'ok'],
    ['3,2,False,128,0', 'offline', 'offline'],
    ['3,2,False,16,0', 'paper_empty', 'paper_empty'],
    ['3,2,False,8,0', 'error', 'error'],
    ['3,2,False,262144,0', 'error', 'error'],
    ['3,2,False,4194304,0', 'error', 'error'],
    ['3,2,False,0,7', 'offline', 'offline'],
    ['3,2,False', 'ready', 'ok'],
    ['6,0,False', 'unknown', 'ok'],
  ]
  for (const [input, expectedHeartbeat, expectedPreflight] of printerQueryCases) {
    try {
      assert.equal(
        mapWin32PrinterQuery(input),
        expectedHeartbeat,
        `mapWin32PrinterQuery(${JSON.stringify(input)})`,
      )
      assert.equal(
        mapWin32PrinterPreflight(input),
        expectedPreflight,
        `mapWin32PrinterPreflight(${JSON.stringify(input)})`,
      )
    } catch (error) {
      failures.push(`printer query ${JSON.stringify(input)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // DetectedErrorState=4 → 'paper_empty' only helps if the server and kiosk spell the value the
  // same way: the server blocks new orders on it and labels the alert, the kiosk shows 「打印机缺纸」.
  // Read their sources so a rename on either side turns this gate red instead of silently
  // degrading paper-out back to an unknown status.
  {
    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const serverAvailability = fs.readFileSync(path.join(repoRoot, 'services/api/src/terminals/printer-availability.ts'), 'utf8')
    const serverAlerts = fs.readFileSync(path.join(repoRoot, 'services/api/src/admin-ops/derived-alerts.ts'), 'utf8')
    const kioskStatus = fs.readFileSync(path.join(repoRoot, 'apps/kiosk/src/hooks/useTerminalDeviceStatus.ts'), 'utf8')
    try {
      assert.match(serverAvailability, /UNAVAILABLE_PRINTER_STATUSES = new Set\(\[[^\]]*'paper_empty'/, 'server must refuse new orders on paper_empty')
      assert.match(serverAlerts, /paper_empty: '打印机缺纸'/, 'server alert must label paper_empty')
      assert.match(kioskStatus, /case 'paper_empty':/, 'kiosk must map paper_empty to its own view')
    } catch (error) {
      failures.push(`paper_empty contract: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`print monitor truth failures:\n- ${failures.join('\n- ')}`)
  }

  verifyPrinterStatusMutations()
  console.log('verify-print-monitor-truth: all assertions passed')
}

const statusMapPath = path.join(__dirname, '../src/agent/printer-status-map.ts')
const PAUSE_READY_ANCHOR = 'if (pauseSignal && !leftoverFault) return \'ready\''
const DETECTED_ERROR_CLEAR_ANCHOR = `    const masked = faultFromExtended(line)
    if (masked) return masked
    return 'ready'`
const NO_EXTENSION_READY_ANCHOR = `    if (masked) return masked
    return 'ready'`
const NO_EXTENSION_UNKNOWN_ANCHOR = `  return 'unknown'
}

export function mapWin32PrinterQuery`

const statusMapChild = `
const { mapWin32PrinterQuery, mapWin32PrinterPreflight } = require('./src/agent/printer-status-map')
const cases = [
  ['1,0,False,131073,8', 'ready', 'ok'],
  ['3,2,False,128,0', 'offline', 'offline'],
  ['3,2,False,16,0', 'paper_empty', 'paper_empty'],
  ['3,2,False', 'ready', 'ok'],
  ['6,0,False', 'unknown', 'ok'],
]
for (const [input, heartbeat, preflight] of cases) {
  if (mapWin32PrinterQuery(input) !== heartbeat) process.exit(1)
  if (mapWin32PrinterPreflight(input) !== preflight) process.exit(1)
}
process.exit(0)
`

function verifyPrinterStatusMutations(): void {
  const original = fs.readFileSync(statusMapPath, 'utf8')
  const baseline = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', statusMapChild], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  })
  if (baseline.status !== 0) {
    throw new Error(`status map baseline failed:\n${baseline.stdout ?? ''}\n${baseline.stderr ?? ''}`)
  }
  const mutations: Array<[string, string, string]> = [
    [
      'paused toner low',
      PAUSE_READY_ANCHOR,
      "if (pauseSignal && !leftoverFault && (state === null || (state & TONER_LOW_BIT) === 0)) return 'ready'",
    ],
    [
      'detected error clear masks faults',
      DETECTED_ERROR_CLEAR_ANCHOR,
      "    return 'ready'",
    ],
    [
      'no extension detected clear',
      NO_EXTENSION_READY_ANCHOR,
      `    if (masked) return masked
    if (!extraFieldsPresent(line)) return 'unknown'
    return 'ready'`,
    ],
    [
      'no extension stays unknown',
      NO_EXTENSION_UNKNOWN_ANCHOR,
      `  return 'ready'
}

export function mapWin32PrinterQuery`,
    ],
  ]
  for (const [label, from, to] of mutations) {
    if (!original.includes(from)) throw new Error(`${label}: anchor missing`)
    fs.writeFileSync(statusMapPath, original.replace(from, to))
    try {
      const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', statusMapChild], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
      })
      if (result.status === 0) throw new Error(`${label}: reversed mapping must fail`)
    } finally {
      fs.writeFileSync(statusMapPath, original)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
