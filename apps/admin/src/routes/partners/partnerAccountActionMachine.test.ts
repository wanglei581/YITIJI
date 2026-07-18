import assert from 'node:assert/strict'
import test from 'node:test'
import {
  initialPartnerAccountActionState,
  reducePartnerAccountAction,
  type PartnerAccountActionState,
} from './partnerAccountActionMachine.ts'

function openDelete(): PartnerAccountActionState {
  return reducePartnerAccountAction(initialPartnerAccountActionState, {
    type: 'OPEN',
    action: 'delete_account',
    targetAccountId: 'partner-1',
  })
}

function withDeleteTicket(): PartnerAccountActionState {
  const confirmed = reducePartnerAccountAction(openDelete(), { type: 'CONFIRM' })
  const challenge = reducePartnerAccountAction(confirmed, { type: 'CHOOSE_METHOD', method: 'sms' })
  const verifying = reducePartnerAccountAction(challenge, {
    type: 'CHALLENGE_CREATED',
    challengeId: 'challenge-1',
  })
  return reducePartnerAccountAction(verifying, {
    type: 'CREDENTIAL_VERIFIED',
    actionTicket: 'ticket-delete',
  })
}

function withRebindTicket(): PartnerAccountActionState {
  let state = reducePartnerAccountAction(initialPartnerAccountActionState, {
    type: 'OPEN',
    action: 'rebind_phone',
    targetAccountId: 'partner-1',
  })
  state = reducePartnerAccountAction(state, { type: 'CONFIRM' })
  state = reducePartnerAccountAction(state, { type: 'CHOOSE_METHOD', method: 'password' })
  state = reducePartnerAccountAction(state, { type: 'CHALLENGE_CREATED', challengeId: 'challenge-2' })
  state = reducePartnerAccountAction(state, { type: 'CREDENTIAL_VERIFIED', actionTicket: 'ticket-rebind' })
  return reducePartnerAccountAction(state, {
    type: 'PHONE_REBIND_STARTED',
    rebindTicket: 'rebind-ticket',
  })
}

test('does not jump from confirmation directly to a destructive commit', () => {
  const state = openDelete()
  assert.equal(reducePartnerAccountAction(state, { type: 'COMMIT_DELETE' }), state)
})

test('busy state ignores duplicate and navigation events until request completion', () => {
  const ready = withDeleteTicket()
  const busy = reducePartnerAccountAction(ready, { type: 'REQUEST_STARTED' })
  assert.equal(reducePartnerAccountAction(busy, { type: 'COMMIT_DELETE' }), busy)
  assert.equal(reducePartnerAccountAction(busy, { type: 'CLOSE' }), busy)
  assert.equal(reducePartnerAccountAction(busy, { type: 'REQUEST_FINISHED' }).busy, false)
})

test('switching action clears challenge, tickets, method and transient errors', () => {
  const state = { ...withDeleteTicket(), errorCode: 'ACCOUNT_CREDENTIAL_INVALID' }
  const switched = reducePartnerAccountAction(state, { type: 'SWITCH_ACTION', action: 'rebind_phone' })
  assert.deepEqual(
    {
      step: switched.step,
      action: switched.action,
      method: switched.verifyMethod,
      challenge: switched.challengeId,
      actionTicket: switched.actionTicket,
      rebindTicket: switched.rebindTicket,
      error: switched.errorCode,
    },
    {
      step: 'confirm_rebind',
      action: 'rebind_phone',
      method: undefined,
      challenge: undefined,
      actionTicket: undefined,
      rebindTicket: undefined,
      error: undefined,
    },
  )
})

test('switching verification method invalidates the current challenge and tickets', () => {
  const state = withDeleteTicket()
  const switched = reducePartnerAccountAction(state, { type: 'CHOOSE_METHOD', method: 'password' })
  assert.equal(switched.step, 'password_verify')
  assert.equal(switched.challengeId, undefined)
  assert.equal(switched.actionTicket, undefined)
})

test('admin reauthentication is inserted only after the server requests it', () => {
  let state = reducePartnerAccountAction(openDelete(), { type: 'CONFIRM' })
  state = reducePartnerAccountAction(state, { type: 'CHOOSE_METHOD', method: 'sms' })
  const reauth = reducePartnerAccountAction(state, { type: 'ADMIN_REAUTH_REQUIRED' })
  assert.equal(reauth.step, 'admin_reauth')
  assert.equal(reauth.verifyMethod, 'sms')
  assert.equal(reducePartnerAccountAction(reauth, { type: 'ADMIN_REAUTHENTICATED' }).step, 'sms_verify')
})

test('credential invalid stays on the credential step and lock restarts the flow', () => {
  let state = reducePartnerAccountAction(openDelete(), { type: 'CONFIRM' })
  state = reducePartnerAccountAction(state, { type: 'CHOOSE_METHOD', method: 'sms' })
  state = reducePartnerAccountAction(state, { type: 'CHALLENGE_CREATED', challengeId: 'challenge-3' })
  const invalid = reducePartnerAccountAction(state, { type: 'ERROR', code: 'ACCOUNT_CREDENTIAL_INVALID' })
  assert.equal(invalid.step, 'sms_verify')
  assert.equal(invalid.challengeId, 'challenge-3')
  const locked = reducePartnerAccountAction(invalid, { type: 'ERROR', code: 'ACCOUNT_CREDENTIAL_LOCKED' })
  assert.equal(locked.step, 'confirm')
  assert.equal(locked.challengeId, undefined)
})

test('challenge and action ticket expiry restart the selected operation', () => {
  const challengeExpired = reducePartnerAccountAction(withDeleteTicket(), {
    type: 'EXPIRED',
    resource: 'challenge',
  })
  assert.equal(challengeExpired.step, 'confirm')
  assert.equal(challengeExpired.actionTicket, undefined)

  const actionExpired = reducePartnerAccountAction(withDeleteTicket(), {
    type: 'EXPIRED',
    resource: 'action_ticket',
  })
  assert.equal(actionExpired.step, 'confirm')
})

test('rebind ticket expiry and PHONE_TAKEN require old-factor authorization again', () => {
  const state = withRebindTicket()
  const expired = reducePartnerAccountAction(state, { type: 'EXPIRED', resource: 'rebind_ticket' })
  assert.equal(expired.step, 'confirm_rebind')
  assert.equal(expired.actionTicket, undefined)
  assert.equal(expired.rebindTicket, undefined)

  const taken = reducePartnerAccountAction(state, { type: 'ERROR', code: 'PHONE_TAKEN' })
  assert.equal(taken.step, 'confirm_rebind')
  assert.equal(taken.needsRefresh, true)
})

test('commit conflict preserves a valid delete ticket for manual retry', () => {
  const committing = reducePartnerAccountAction(withDeleteTicket(), { type: 'COMMIT_DELETE' })
  const conflict = reducePartnerAccountAction(committing, { type: 'ERROR', code: 'ACCOUNT_COMMIT_CONFLICT' })
  assert.equal(conflict.step, 'delete_ready')
  assert.equal(conflict.actionTicket, 'ticket-delete')
})

test('stale, unavailable, not found and last-account errors refresh and restart', () => {
  for (const code of [
    'ACCOUNT_ACTION_TICKET_STALE',
    'ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE',
    'ACCOUNT_NOT_FOUND',
    'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
  ] as const) {
    const restarted = reducePartnerAccountAction(withDeleteTicket(), { type: 'ERROR', code })
    assert.equal(restarted.step, 'confirm')
    assert.equal(restarted.needsRefresh, true)
    assert.equal(restarted.actionTicket, undefined)
  }
})

test('unknown final write result clears bearer tickets and requires convergence refresh', () => {
  const committing = reducePartnerAccountAction(withDeleteTicket(), { type: 'COMMIT_DELETE' })
  const uncertain = reducePartnerAccountAction(committing, { type: 'FINAL_RESULT_UNCERTAIN' })
  assert.equal(uncertain.step, 'result_uncertain')
  assert.equal(uncertain.resultUncertain, true)
  assert.equal(uncertain.needsRefresh, true)
  assert.equal(uncertain.actionTicket, undefined)
  assert.equal(reducePartnerAccountAction(uncertain, { type: 'COMMIT_DELETE' }), uncertain)
})

test('rebind progresses only through new phone verification before commit', () => {
  let state = withRebindTicket()
  assert.equal(state.step, 'new_phone_sms_verify')
  state = reducePartnerAccountAction(state, { type: 'COMMIT_REBIND' })
  assert.equal(state.step, 'rebind_committing')
  assert.equal(reducePartnerAccountAction(state, { type: 'SUCCESS' }).step, 'success')
})

test('close and success reset all in-memory bearer state', () => {
  const closed = reducePartnerAccountAction(withRebindTicket(), { type: 'CLOSE' })
  assert.deepEqual(closed, initialPartnerAccountActionState)

  const success = reducePartnerAccountAction(withDeleteTicket(), { type: 'SUCCESS' })
  assert.equal(success.step, 'success')
  assert.equal(success.challengeId, undefined)
  assert.equal(success.actionTicket, undefined)
  assert.equal(success.rebindTicket, undefined)
})

test('method, step-up and unknown errors follow distinct recovery policies', () => {
  const ready = withDeleteTicket()
  const methodUnavailable = reducePartnerAccountAction(ready, {
    type: 'ERROR',
    code: 'ACCOUNT_ACTION_METHOD_UNAVAILABLE',
  })
  assert.equal(methodUnavailable.step, 'choose_method')
  assert.equal(methodUnavailable.actionTicket, undefined)

  const stepUp = reducePartnerAccountAction(ready, {
    type: 'ERROR',
    code: 'ACCOUNT_ACTION_STEP_UP_REQUIRED',
  })
  assert.equal(stepUp.step, 'confirm')

  const unknown = reducePartnerAccountAction(ready, { type: 'ERROR', code: 'UNEXPECTED_FAILURE' })
  assert.equal(unknown.step, 'delete_ready')
  assert.equal(unknown.errorCode, 'UNEXPECTED_FAILURE')
})

test('invalid navigation events preserve the exact current state object', () => {
  const closed = initialPartnerAccountActionState
  assert.equal(reducePartnerAccountAction(closed, { type: 'CONFIRM' }), closed)
  assert.equal(reducePartnerAccountAction(closed, { type: 'CHOOSE_METHOD', method: 'sms' }), closed)
  assert.equal(reducePartnerAccountAction(closed, { type: 'SWITCH_ACTION', action: 'delete_account' }), closed)
})
