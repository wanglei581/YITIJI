import assert from 'node:assert/strict'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-status-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-status-action-secret-0123456789'

type TaskStatus = 'completed' | 'failed' | 'cancelled'

function errorCode(error: unknown): string | undefined {
  const exception = error as { getResponse?: () => unknown; response?: unknown }
  const response = (
    typeof exception.getResponse === 'function' ? exception.getResponse() : exception.response
  ) as { error?: { code?: string } } | undefined
  return response?.error?.code
}

async function expectCode(
  run: () => Promise<unknown>,
  expectedCode: string,
  expectedStatus: number,
  label: string
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.equal(errorCode(error), expectedCode, label)
    const status = (error as { getStatus?: () => number }).getStatus?.()
    assert.equal(status, expectedStatus, `${label}: HTTP status`)
    return true
  })
}

async function main(): Promise<void> {
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')

  let currentStatus: TaskStatus = 'completed'
  let transactionCalls = 0
  let credentialChecks = 0
  const prisma = {
    printTask: {
      findUnique: async () => ({
        id: 'task-terminal-status-contract',
        terminalId: 'terminal-owner',
        status: currentStatus,
      }),
    },
    $transaction: async () => {
      transactionCalls += 1
      throw new Error('terminal-state replays must be decided before opening a write transaction')
    },
  }
  const credentialSecurity = {
    validateTerminalToken: async () => {
      credentialChecks += 1
    },
  }
  const service = new TerminalAgentService(
    prisma as never,
    null as never,
    credentialSecurity as never,
    {} as never
  )

  const sameCompleted = await service.patchTaskStatus(
    'task-terminal-status-contract',
    { status: 'completed' },
    'Bearer fixture-token',
    'terminal-owner'
  )
  assert.deepEqual(
    sameCompleted,
    { acknowledged: true },
    'an exact completed replay stays idempotent'
  )
  assert.equal(
    transactionCalls,
    0,
    'an exact replay must not rewrite task, order, or status log rows'
  )

  await expectCode(
    () =>
      service.patchTaskStatus(
        'task-terminal-status-contract',
        { status: 'failed' },
        'Bearer fixture-token',
        'terminal-owner'
      ),
    'PRINT_TASK_TERMINAL_STATUS_CONFLICT',
    409,
    'completed must not be acknowledged as failed'
  )
  await expectCode(
    () =>
      service.patchTaskStatus(
        'task-terminal-status-contract',
        { status: 'printing' },
        'Bearer fixture-token',
        'terminal-owner'
      ),
    'INVALID_STATUS_TRANSITION',
    400,
    'a terminal task must not regress to printing'
  )

  currentStatus = 'failed'
  const sameFailed = await service.patchTaskStatus(
    'task-terminal-status-contract',
    { status: 'failed' },
    'Bearer fixture-token',
    'terminal-owner'
  )
  assert.deepEqual(sameFailed, { acknowledged: true }, 'an exact failed replay stays idempotent')
  await expectCode(
    () =>
      service.patchTaskStatus(
        'task-terminal-status-contract',
        { status: 'completed' },
        'Bearer fixture-token',
        'terminal-owner'
      ),
    'PRINT_TASK_TERMINAL_STATUS_CONFLICT',
    409,
    'failed must not be acknowledged as completed'
  )

  currentStatus = 'cancelled'
  await expectCode(
    () =>
      service.patchTaskStatus(
        'task-terminal-status-contract',
        { status: 'completed' },
        'Bearer fixture-token',
        'terminal-owner'
      ),
    'PRINT_TASK_TERMINAL_STATUS_CONFLICT',
    409,
    'cancelled must not be acknowledged as completed'
  )
  assert.equal(transactionCalls, 0, 'conflicting terminal reports must not reach any write sink')
  assert.equal(
    credentialChecks,
    6,
    'every replay must remain behind terminal credential validation'
  )

  let concurrentStatus: 'claimed' | 'completed' = 'completed'
  let concurrentWriteAttempts = 0
  let concurrentSideEffects = 0
  const racePrisma = {
    printTask: {
      findUnique: async () => ({
        id: 'task-terminal-status-race',
        terminalId: 'terminal-owner',
        status: 'printing',
      }),
    },
    $transaction: async (run: (tx: unknown) => Promise<void>) =>
      run({
        printTask: {
          updateMany: async () => {
            concurrentWriteAttempts += 1
            return { count: 0 }
          },
          findUnique: async () => ({
            id: 'task-terminal-status-race',
            terminalId: 'terminal-owner',
            status: concurrentStatus,
          }),
        },
        printTaskStatusLog: {
          create: async () => {
            concurrentSideEffects += 1
          },
        },
        order: {
          updateMany: async () => {
            concurrentSideEffects += 1
          },
        },
      }),
  }
  const raceService = new TerminalAgentService(
    racePrisma as never,
    null as never,
    credentialSecurity as never,
    {} as never
  )

  await expectCode(
    () =>
      raceService.patchTaskStatus(
        'task-terminal-status-race',
        { status: 'failed' },
        'Bearer fixture-token',
        'terminal-owner'
      ),
    'PRINT_TASK_TERMINAL_STATUS_CONFLICT',
    409,
    'a lost CAS must not acknowledge a different terminal state'
  )
  const concurrentSameStatus = await raceService.patchTaskStatus(
    'task-terminal-status-race',
    { status: 'completed' },
    'Bearer fixture-token',
    'terminal-owner'
  )
  assert.deepEqual(
    concurrentSameStatus,
    { acknowledged: true },
    'a lost CAS may acknowledge the exact state committed by the concurrent writer'
  )

  concurrentStatus = 'claimed'
  await expectCode(
    () =>
      raceService.patchTaskStatus(
        'task-terminal-status-race',
        { status: 'completed' },
        'Bearer fixture-token',
        'terminal-owner'
      ),
    'PRINT_TASK_STATUS_CHANGED',
    409,
    'an unexpected active-state race must require a fresh report'
  )
  assert.equal(concurrentWriteAttempts, 3, 'each race case must use the guarded CAS exactly once')
  assert.equal(
    concurrentSideEffects,
    0,
    'lost CAS attempts must not write status logs or order mirrors'
  )

  console.log('verify-terminal-status-idempotency: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
