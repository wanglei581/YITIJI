import assert from 'node:assert/strict'
import { monitorPrintJob } from '../src/agent/task-runner'
import { parsePrintJobStatus, type PrintJobMonitorStatus } from '../src/agent/wmi'
import { printWithPdfToPrinter } from '../src/printer/print-with-pdf-to-printer'

interface Scenario {
  name: string
  statuses: PrintJobMonitorStatus[]
  expectedFailed: boolean
  expectedErrorCode: string
}

async function runScenario(scenario: Scenario): Promise<void> {
  let now = 0
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
  })

  assert.equal(result.failed, scenario.expectedFailed, `${scenario.name}: terminal disposition`)
  assert.equal(result.errorCode, scenario.expectedErrorCode, `${scenario.name}: errorCode`)
}

async function main(): Promise<void> {
  const failures: string[] = []

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
      name: 'spooler query remains unknown until timeout',
      statuses: ['unknown'],
      expectedFailed: true,
      expectedErrorCode: 'PRINT_JOB_UNCONFIRMED',
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
