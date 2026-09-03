import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { monitorPrintJob } from '../src/agent/task-runner'
import {
  buildPrintServiceCompletionEventScript,
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

  if (failures.length > 0) {
    throw new Error(`print monitor truth failures:\n- ${failures.join('\n- ')}`)
  }

  console.log('verify-print-monitor-truth: all assertions passed')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
