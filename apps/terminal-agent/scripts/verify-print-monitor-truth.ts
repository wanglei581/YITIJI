import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { monitorPrintJob } from '../src/agent/task-runner'
import {
  createCompletionEvidenceChannel,
  type InferredCompletionReason,
} from '../src/agent/print-job-monitor'
import {
  buildPrintServiceCompletionEventScript,
  buildPrintServiceCompletionLogStateScript,
  buildWin32PrinterProbeScript,
  configuredPrinterNameMatches,
  mapWin32PrinterPreflight,
  mapWin32PrinterQuery,
  parsePrintCompletionLogState,
  parsePrintJobStatus,
  type PrintCompletionLogState,
  type PrintJobMonitorStatus,
} from '../src/agent/wmi'
import { ESCAPE_WQL_LITERAL_FUNCTION, escapeWqlLiteral } from '../src/agent/wql-literal'
import { printWithPdfToPrinter } from '../src/printer/print-with-pdf-to-printer'
import { buildImageTempPdfFileName } from '../src/printer/image-to-pdf'

interface Scenario {
  name: string
  statuses?: PrintJobMonitorStatus[]
  /** Raw JobStatus strings, parsed by parsePrintJobStatus before the monitor sees them. */
  raws?: string[]
  expectedFailed: boolean
  expectedErrorCode: string
  completionEvent?: boolean
  /** 1-based index of the completion-event query that returns true. Earlier queries return false. */
  completionTrueOnQuery?: number
  initialNow?: number
  dispatchedAtMs?: number
  /** Defaults to disabled so existing scenarios keep their previous disposition. */
  logState?: PrintCompletionLogState
  logStateRejects?: boolean
  /** When true, the fresh channel is already proven for Configured Printer. */
  proveChannel?: boolean
  timeoutMs?: number
  expectedInferred?: InferredCompletionReason
  expectedWarn?: RegExp
  unexpectedWarn?: RegExp[]
  expectedStatusQueries?: number
  expectedLogStateQueries?: number
  expectedRawStatus?: string
  /** After the run, whether this queue's channel is proven. Another queue must stay unproven. */
  expectChannelProven?: boolean
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

function verifyCompletionLogStateContract(): void {
  assert.equal(parsePrintCompletionLogState('enabled'), 'enabled')
  assert.equal(parsePrintCompletionLogState(' Enabled \r\n'), 'enabled')
  assert.equal(parsePrintCompletionLogState('disabled'), 'disabled')
  assert.equal(parsePrintCompletionLogState(null), 'unknown')
  assert.equal(parsePrintCompletionLogState(''), 'unknown')
  assert.equal(parsePrintCompletionLogState('enabled\nextra'), 'unknown')
  assert.equal(parsePrintCompletionLogState('True'), 'unknown')

  const script = buildPrintServiceCompletionLogStateScript()
  assert.match(script, /Microsoft-Windows-PrintService\/Operational/, 'log-state probe names the Operational log')
  assert.match(script, /IsEnabled/, 'log-state probe reads IsEnabled')
  assert.match(script, /catch/, 'log-state probe catches read failures')
  assert.doesNotMatch(script, /wevtutil/, 'log-state probe must not change logging')
  assert.doesNotMatch(script, /SaveChanges/, 'log-state probe must not save log changes')
  assert.doesNotMatch(script, /Set-/, 'log-state probe must not call a Set- cmdlet')
  assert.doesNotMatch(script, /Clear-/, 'log-state probe must not clear the log')
  assert.doesNotMatch(script, /Limit-EventLog/, 'log-state probe must not resize the log')
}

async function runScenario(scenario: Scenario): Promise<void> {
  let now = scenario.initialNow ?? 0
  let cursor = 0
  let statusQueries = 0
  let completionQueries = 0
  let logStateQueries = 0
  const fallback = scenario.statuses?.at(-1) ?? 'unknown'
  const evidenceChannel = createCompletionEvidenceChannel()
  if (scenario.proveChannel) evidenceChannel.markProven('Configured Printer')
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
  }
  if (scenario.logStateRejects) process.on('unhandledRejection', onUnhandled)

  let result: Awaited<ReturnType<typeof monitorPrintJob>>
  try {
    result = await monitorPrintJob(
      'Configured Printer',
      'task-monitor-test',
      scenario.timeoutMs ?? 10,
      1,
      {
        platform: 'win32',
        now: () => now,
        sleep: async (ms) => {
          now += Math.max(ms, 1)
        },
        queryStatus: async () => {
          statusQueries += 1
          if (scenario.raws) {
            const raw = scenario.raws[cursor++] ?? scenario.raws.at(-1) ?? 'not_found'
            return parsePrintJobStatus(raw)
          }
          return {
            status: scenario.statuses?.[cursor++] ?? fallback,
            rawStatus: fallback === 'printing' ? 'Printing' : undefined,
          }
        },
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
          completionQueries += 1
          if (scenario.completionTrueOnQuery !== undefined) {
            return completionQueries === scenario.completionTrueOnQuery
          }
          return scenario.completionEvent ?? false
        },
        queryCompletionLogState: async () => {
          logStateQueries += 1
          if (scenario.logStateRejects) throw new Error('completion log state unreadable')
          return scenario.logState ?? 'disabled'
        },
        evidenceChannel,
      },
    )
    if (scenario.logStateRejects) {
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(unhandled.length, 0, `${scenario.name}: unhandled rejection`)
    }
  } finally {
    if (scenario.logStateRejects) process.off('unhandledRejection', onUnhandled)
  }

  assert.equal(result.failed, scenario.expectedFailed, `${scenario.name}: terminal disposition`)
  assert.equal(result.errorCode, scenario.expectedErrorCode, `${scenario.name}: errorCode`)
  assert.equal(result.inferred, scenario.expectedInferred, `${scenario.name}: inferred`)
  if (scenario.expectedWarn) {
    assert.match(result.warn ?? '', scenario.expectedWarn, `${scenario.name}: warn`)
  }
  for (const pattern of scenario.unexpectedWarn ?? []) {
    assert.doesNotMatch(result.warn ?? '', pattern, `${scenario.name}: unexpected warn ${pattern}`)
  }
  if (scenario.expectedStatusQueries !== undefined) {
    assert.equal(statusQueries, scenario.expectedStatusQueries, `${scenario.name}: status queries`)
  }
  if (scenario.expectedLogStateQueries !== undefined) {
    assert.equal(logStateQueries, scenario.expectedLogStateQueries, `${scenario.name}: log-state queries`)
  }
  if (scenario.expectedRawStatus !== undefined) {
    assert.equal(result.rawStatus, scenario.expectedRawStatus, `${scenario.name}: rawStatus`)
  }
  if (scenario.expectChannelProven !== undefined) {
    assert.equal(
      evidenceChannel.isProven('Configured Printer'),
      scenario.expectChannelProven,
      `${scenario.name}: this queue proven`,
    )
    assert.equal(evidenceChannel.isProven('Other Printer'), false, `${scenario.name}: other queue unproven`)
  }
}

async function main(): Promise<void> {
  const failures: string[] = []

  verifyPrintServiceCompletionScriptContract()
  verifyCompletionLogStateContract()

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
      queryCompletionLogState: async () => 'disabled',
      evidenceChannel: createCompletionEvidenceChannel(),
    })
    assert.equal(nonWindows.failed, true, 'monitor unavailable must not confirm completed')
    assert.equal(nonWindows.errorCode, 'PRINT_JOB_UNCONFIRMED')
    assert.equal(nonWindows.inferred, undefined)
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
      expectedInferred: 'completion_log_disabled',
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
    // F-18 (2026-10-10 real device): paper came out and the order was recorded as
    // PRINTER_ERROR. Reading of the code (raw status not retrieved yet): the poll landed
    // on Windows removing the finished job.
    {
      name: 'job seen printing, then being removed, then gone is completion — not a device error',
      statuses: ['printing', 'removing', 'not_found'],
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_disabled',
    },
    {
      name: 'job only ever seen retained, then removed, then gone is unconfirmed (Retained may mean waiting for paper)',
      statuses: ['retained', 'removing', 'not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'retained job removed with a matching PrintService 307 confirms completion',
      statuses: ['retained', 'removing', 'not_found'],
      expectedFailed: false,
      expectedErrorCode: '',
      completionEvent: true,
    },
    {
      name: 'job seen printing, then retained, then removed, then gone follows the observed-then-removed rule',
      statuses: ['printing', 'retained', 'removing', 'not_found'],
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_disabled',
    },
    {
      name: 'job being removed with a matching PrintService 307 confirms completion',
      statuses: ['removing'],
      expectedFailed: false,
      expectedErrorCode: '',
      completionEvent: true,
    },
    {
      name: 'job only ever seen while being removed is unconfirmed, neither completed nor a device error',
      statuses: ['removing', 'not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'job stuck in removal until timeout is unconfirmed, not a device error',
      statuses: ['printing', 'removing'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'paper-out signal is not washed out by a later removal',
      statuses: ['printing', 'paper_empty', 'removing', 'not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
    },
    {
      name: 'paper-out then removal with a 307 event is still not completion',
      statuses: ['paper_empty', 'removing', 'not_found'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      completionEvent: true,
    },
    {
      name: 'a device error after removal started is still a device error',
      statuses: ['printing', 'removing', 'error'],
      expectedFailed: true,
      expectedErrorCode: 'PRINTER_ERROR',
    },
    {
      name: 'enabled and proven: printing then gone with no 307 is unconfirmed after the grace polls',
      raws: ['Printing', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      expectedStatusQueries: 5,
      expectedLogStateQueries: 1,
      expectedWarn: /no completion event/,
    },
    {
      name: 'enabled and proven: Printing then Deleting then gone with no 307 is unconfirmed and keeps Deleting',
      raws: ['Printing', 'Deleting', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      expectedRawStatus: 'Deleting',
      expectedWarn: /no completion event/,
    },
    {
      name: 'enabled and proven: a 307 that arrives on the third query still completes without inference',
      raws: ['Printing', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      completionTrueOnQuery: 3,
      expectedFailed: false,
      expectedErrorCode: '',
    },
    {
      name: 'enabled and proven: a not_found between printing samples is a missed read, then Printed completes',
      raws: ['Printing', 'not_found', 'Printing', 'Printed'],
      logState: 'enabled',
      proveChannel: true,
      expectedFailed: false,
      expectedErrorCode: '',
      expectedStatusQueries: 4,
    },
    {
      name: 'enabled and proven: grace restarts when the job is seen again after a missed read',
      raws: ['Printing', 'not_found', 'Printing', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      expectedStatusQueries: 7,
      expectedWarn: /no completion event/,
    },
    {
      name: 'enabled and proven: retained then gone with no 307 is unconfirmed',
      raws: ['Printing, Retained', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      expectedStatusQueries: 5,
      expectedWarn: /no completion event/,
    },
    {
      name: 'enabled and proven: the window ends during the grace period',
      raws: ['Printing', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      timeoutMs: 3,
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      expectedWarn: /monitoring window ended[\s\S]*no completion event/,
      unexpectedWarn: [/remained active/, /Retained/],
    },
    {
      name: 'enabled but this queue has never matched a 307: disappearance is an unverified inference',
      raws: ['Printing', 'not_found'],
      logState: 'enabled',
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_unverified',
    },
    {
      name: 'log disabled even if a 307 was read before: disappearance is a disabled-log inference',
      raws: ['Printing', 'not_found'],
      logState: 'disabled',
      proveChannel: true,
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_disabled',
    },
    {
      name: 'unreadable log configuration even if a 307 was read before: disappearance is an unknown-log inference',
      raws: ['Printing', 'not_found'],
      logState: 'unknown',
      proveChannel: true,
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_unknown',
    },
    {
      name: 'log disabled: Printing then not_found completes as a disabled-log inference',
      raws: ['Printing', 'not_found'],
      logState: 'disabled',
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_disabled',
    },
    {
      name: 'log disabled: Printing then Deleting then not_found matches the no-Deleting inference',
      raws: ['Printing', 'Deleting', 'not_found'],
      logState: 'disabled',
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_disabled',
    },
    {
      name: 'a matching 307 marks this queue proven and leaves another queue unproven',
      raws: ['Printing', 'not_found'],
      logState: 'enabled',
      completionEvent: true,
      expectedFailed: false,
      expectedErrorCode: '',
      expectChannelProven: true,
    },
    {
      name: 'no 307 leaves a fresh channel unproven',
      raws: ['Printing', 'not_found'],
      logState: 'disabled',
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_disabled',
      expectChannelProven: false,
    },
    {
      name: 'a rejecting log-state query does not fail the monitor and is treated as unknown',
      raws: ['Printing', 'not_found'],
      logStateRejects: true,
      expectedFailed: false,
      expectedErrorCode: '',
      expectedInferred: 'completion_log_unknown',
      expectedLogStateQueries: 1,
    },
    {
      name: 'paper-empty still wins over the grace rule when the log is enabled and proven',
      raws: ['Printing', 'PaperOut', 'not_found'],
      logState: 'enabled',
      proveChannel: true,
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
      expectedWarn: /paper-empty/,
      expectedStatusQueries: 3,
    },
  ]

  for (const scenario of scenarios) {
    try {
      await runScenario(scenario)
    } catch (error) {
      failures.push(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Queue removal is not a device fault and not completion on its own (F-18).
  const removalStates: Array<[string, PrintJobMonitorStatus]> = [
    ['Deleting', 'removing'],
    ['Deleted', 'removing'],
    ['Cancelled', 'error'],
    ['Canceled', 'error'],
    ['Printed, Cancelled', 'error'],
    ['Deleting, Cancelled', 'error'],
    ['Printed, Retained, Deleted', 'removing'],
    ['Printing, Deleting', 'removing'],
    ['Retained, Deleted', 'removing'],
    ['Deleting, Printed', 'completed'],
    ['Printed, Deleted', 'completed'],
    ['Error, Deleting', 'error'],
    ['Deleting, Jammed', 'error'],
    ['Deleting, UserIntervention', 'error'],
    ['Deleting, PaperOut', 'paper_empty'],
    ['Printed, Deleting, PaperOut', 'paper_empty'],
  ]
  for (const [rawStatus, expected] of removalStates) {
    try {
      const parsed = parsePrintJobStatus(rawStatus)
      assert.equal(parsed.status, expected, `${rawStatus}: queue removal classification`)
      assert.equal(parsed.rawStatus, rawStatus, `${rawStatus}: raw status is kept for the task record`)
    } catch (error) {
      failures.push(`${rawStatus}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Raw status strings through the real parser into the real monitor: the two halves
  // must agree on combined flags, and a failure must come from the sample that carried it.
  const rawSequences: Array<{ name: string; raws: string[]; failed: boolean; code: string; raw?: string; warn?: RegExp; inferred?: InferredCompletionReason }> = [
    { name: 'F-18 as read from the code', raws: ['Printing', 'Printing', 'Deleting', 'not_found'], failed: false, code: '', inferred: 'completion_log_disabled' },
    { name: 'finished job caught mid clean-up with the spooler flag', raws: ['Printing', 'Deleting, Printed'], failed: false, code: '' },
    { name: 'jam reported while the job is being removed', raws: ['Printing', 'Deleting', 'Deleting, Jammed'], failed: true, code: 'PRINTER_ERROR', raw: 'Deleting, Jammed' },
    { name: 'device error reported after removal started', raws: ['Printing', 'Deleting', 'Error'], failed: true, code: 'PRINTER_ERROR', raw: 'Error' },
    { name: 'user intervention reported after removal started', raws: ['Deleting', 'UserIntervention, Deleting'], failed: true, code: 'PRINTER_ERROR', raw: 'UserIntervention, Deleting' },
    { name: 'two paper-out samples after removal started', raws: ['Printing', 'Deleting', 'Deleting, PaperOut', 'PaperOut'], failed: true, code: 'PAPER_EMPTY', raw: 'PaperOut' },
    { name: 'paper-out, then removed, then gone', raws: ['Printing', 'PaperOut', 'Deleting', 'not_found'], failed: true, code: 'PRINT_JOB_UNCONFIRMED' },
    { name: 'retained only, then deleted, then gone', raws: ['Printing, Retained', 'Deleted', 'not_found'], failed: true, code: 'PRINT_JOB_UNCONFIRMED', raw: 'Deleted' },
    { name: 'first sample already in removal, then gone', raws: ['Deleting', 'not_found'], failed: true, code: 'PRINT_JOB_UNCONFIRMED', raw: 'Deleting', warn: /only ever seen while Windows was removing it/ },
    { name: 'still in removal at the timeout', raws: ['Printing', 'Deleting'], failed: true, code: 'PRINT_JOB_UNCONFIRMED', raw: 'Deleting', warn: /still being removed/ },
    { name: 'left removal and kept printing until the timeout is not reported as stuck in removal', raws: ['Deleting', 'Printing'], failed: true, code: 'PRINT_JOB_UNCONFIRMED', warn: /remained active/ },
  ]
  for (const sequence of rawSequences) {
    try {
      let now = 0
      let cursor = 0
      const last = sequence.raws.at(-1) ?? 'not_found'
      const result = await monitorPrintJob('Configured Printer', 'task-monitor-test', 10, 1, {
        platform: 'win32',
        now: () => now,
        sleep: async (ms) => { now += Math.max(ms, 1) },
        queryStatus: async () => parsePrintJobStatus(sequence.raws[cursor++] ?? last),
        queryCompletionEvent: async () => false,
        queryCompletionLogState: async () => 'disabled',
        evidenceChannel: createCompletionEvidenceChannel(),
      })
      assert.equal(result.failed, sequence.failed, `${sequence.name}: terminal disposition`)
      assert.equal(result.errorCode, sequence.code, `${sequence.name}: errorCode`)
      assert.equal(result.inferred, sequence.inferred, `${sequence.name}: inferred`)
      if (sequence.raw !== undefined) assert.equal(result.rawStatus, sequence.raw, `${sequence.name}: the failure carries the sample that caused it`)
      if (sequence.warn) assert.match(result.warn ?? '', sequence.warn, `${sequence.name}: diagnostic`)
    } catch (error) {
      failures.push(`${sequence.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const explicitFailures = [
    'Jammed',
    'Error',
    'UserIntervention',
    'Printing, Error',
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
  // 查询抛错和确认不存在各占一行：前者心跳 unknown，后者 error。
  const probeFailureRows: Array<[string, string, string]> = [
    ['query_failed', 'unknown', 'unknown'],
    ['not_found', 'error', 'not_found'],
  ]
  const printerQueryCases: Array<[string | null, string, string]> = [
    [null, 'unknown', 'unknown'],
    ['', 'unknown', 'unknown'],
    ...probeFailureRows,
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
      const trickyName = "\\\\srv\\Pan'tum"
      assert.equal(configuredPrinterNameMatches(trickyName, trickyName), true)
      assert.equal(configuredPrinterNameMatches(trickyName, "\\\\srv\\Pantum"), false)
      assert.equal(configuredPrinterNameMatches("' OR $_.Name -eq 'other", 'other'), false)
      const probe = buildWin32PrinterProbeScript()
      assert.equal(probe.includes(trickyName), false)
      assert.match(probe, /-Filter \$filter/)
      assert.doesNotMatch(probe, /\$name\s*\+/)
      assert.match(probe, /\.Name -eq \$name/)
      assert.ok(probe.includes(ESCAPE_WQL_LITERAL_FUNCTION))
      assert.equal(escapeWqlLiteral(trickyName), "\\\\\\\\srv\\\\Pan\\'tum")
      assert.equal(escapeWqlLiteral("a\\b'c"), "a\\\\b\\'c")
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
  ['query_failed', 'unknown', 'unknown'],
  ['not_found', 'error', 'not_found'],
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
    [
      'query failure reported as missing',
      "if (output === 'query_failed') return 'unknown' // probe-query-failed",
      "if (output === 'query_failed') return 'error' // probe-query-failed",
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
