#!/usr/bin/env node
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import './verify-governance-crash.mjs'
import './verify-governance-git.mjs'
import './verify-governance-invocation.mjs'
import './verify-governance-reservation.mjs'
import './verify-governance-store.mjs'
import './verify-governance-wiring.mjs'
import {
  ERROR_CODES, canonicalJson, parseInvokeInput, parseReserveInput, sha256,
} from './governance-contract.mjs'

const RESERVE_KEYS = [
  'stateRoot', 'taskId', 'branch', 'baselineOid', 'cloneRoot', 'evidenceOut', 'archiveOut',
]
const INVOKE_KEYS = ['stateRoot', 'reservationId', 'contextFd']
const EXPECTED_ERROR_CODES = Object.freeze({
  GOVERNANCE_STATE: 'D2_PRIME_NO_GO_GOVERNANCE_STATE',
  INPUT: 'D2_PRIME_NO_GO_INPUT',
  GIT_IDENTITY: 'D2_PRIME_NO_GO_GIT_IDENTITY',
  ALREADY_RESERVED: 'D2_PRIME_NO_GO_ALREADY_RESERVED',
  ARCHIVE_EXISTS: 'D2_PRIME_NO_GO_ARCHIVE_EXISTS',
  MANIFEST: 'D2_PRIME_NO_GO_MANIFEST',
  WRITE: 'D2_PRIME_NO_GO_WRITE',
  ALREADY_INVOKED: 'D2_PRIME_NO_GO_ALREADY_INVOKED',
  LEDGER: 'D2_PRIME_NO_GO_LEDGER',
})
function reserveInput(baselineOid = 'a'.repeat(40)) {
  return {
    stateRoot: '/tmp/d2-governance', taskId: 'task-1', branch: 'codex/task-1', baselineOid,
    cloneRoot: '/tmp/d2-clone', evidenceOut: '/tmp/d2-evidence.json',
    archiveOut: '/tmp/d2-archive.json',
  }
}
function invokeInput() {
  return { stateRoot: '/tmp/d2-governance', reservationId: 'b'.repeat(32), contextFd: 3 }
}
function expectInput(action, canary = '') {
  assert.throws(action, (error) => {
    assert.equal(error.name, 'GovernanceError')
    assert.equal(error.code, ERROR_CODES.INPUT)
    assert.equal(error.message, ERROR_CODES.INPUT)
    assert.ok(!`${error.name}\n${error.code}\n${error.message}`.includes(canary || '\u0000'))
    return true
  })
}
function capturedInputCode(action) {
  try { action(); return null } catch (error) { return error instanceof Error ? error.code : null }
}
function nullPrototypeInput(input) { return Object.assign(Object.create(null), input) }
function inputWithGetter(input, key, getter) {
  const result = { ...input }
  Object.defineProperty(result, key, { configurable: true, enumerable: true, get: getter })
  return result
}
function proxyWithThrowingTrap(input, trap, canary) {
  return new Proxy(input, { [trap]() { throw new Error(canary) } })
}

let completed = 0
test('reserve input accepts only the exact contract and lowercase git OIDs', () => {
  for (const baselineOid of ['a'.repeat(40), 'b'.repeat(64)]) {
    const input = reserveInput(baselineOid)
    const before = structuredClone(input)
    const parsed = parseReserveInput(input)
    assert.deepEqual(parsed, input)
    assert.deepEqual(input, before)
    assert.notEqual(parsed, input)
    assert.ok(Object.isFrozen(parsed))
  }
  for (const key of RESERVE_KEYS) {
    const input = reserveInput(); delete input[key]
    expectInput(() => parseReserveInput(input))
  }
  expectInput(() => parseReserveInput({ ...reserveInput(), extra: true }))
  for (const baselineOid of ['a'.repeat(39), 'A'.repeat(40), 'g'.repeat(40)]) {
    expectInput(() => parseReserveInput(reserveInput(baselineOid)))
  }
  assert.deepEqual([
    capturedInputCode(() => parseReserveInput({ ...reserveInput(), taskId: '-task' })),
    capturedInputCode(() => parseReserveInput(nullPrototypeInput(reserveInput()))),
  ], [ERROR_CODES.INPUT, ERROR_CODES.INPUT])
  let getterReads = 0
  const changingGetter = inputWithGetter(reserveInput(), 'stateRoot', () => {
    getterReads += 1
    return getterReads === 1 ? '/tmp/d2-governance' : 'relative-path'
  })
  expectInput(() => parseReserveInput(changingGetter))
  assert.equal(getterReads, 0)
  const nonEnumerable = reserveInput()
  Object.defineProperty(nonEnumerable, 'taskId', { value: 'task-1', enumerable: false })
  expectInput(() => parseReserveInput(nonEnumerable))
  expectInput(() => parseReserveInput({ ...reserveInput(), [Symbol('extra')]: true }))
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    const canary = `RESERVE_${trap}_CANARY`
    expectInput(() => parseReserveInput(proxyWithThrowingTrap(reserveInput(), trap, canary)), canary)
  }
  completed += 1
})

test('invoke input accepts only an exact reservation and context fd 3', () => {
  const input = invokeInput()
  const before = structuredClone(input)
  const parsed = parseInvokeInput(input)
  assert.deepEqual(parsed, input)
  assert.deepEqual(input, before)
  assert.notEqual(parsed, input)
  assert.ok(Object.isFrozen(parsed))
  for (const key of INVOKE_KEYS) {
    const candidate = invokeInput(); delete candidate[key]
    expectInput(() => parseInvokeInput(candidate))
  }
  expectInput(() => parseInvokeInput({ ...invokeInput(), extra: true }))
  for (const reservationId of ['a'.repeat(31), 'A'.repeat(32), 'g'.repeat(32)]) {
    expectInput(() => parseInvokeInput({ ...invokeInput(), reservationId }))
  }
  for (const contextFd of [2, 4, 3.1, '3']) {
    expectInput(() => parseInvokeInput({ ...invokeInput(), contextFd }))
  }
  expectInput(() => parseInvokeInput(nullPrototypeInput(invokeInput())))
  let getterReads = 0
  const changingGetter = inputWithGetter(invokeInput(), 'stateRoot', () => {
    getterReads += 1
    return getterReads === 1 ? '/tmp/d2-governance' : 'relative-path'
  })
  expectInput(() => parseInvokeInput(changingGetter))
  assert.equal(getterReads, 0)
  expectInput(() => parseInvokeInput({ ...invokeInput(), [Symbol('extra')]: true }))
  const descriptorCanary = 'INVOKE_DESCRIPTOR_CANARY'
  expectInput(
    () => parseInvokeInput(proxyWithThrowingTrap(invokeInput(), 'getOwnPropertyDescriptor', descriptorCanary)),
    descriptorCanary,
  )
  completed += 1
})

test('canonical JSON recursively sorts keys and rejects unsupported values', () => {
  assert.equal(
    canonicalJson({ z: [3, { y: true, x: null }], a: { d: 'four', c: 2 } }),
    '{"a":{"c":2,"d":"four"},"z":[3,{"x":null,"y":true}]}',
  )
  for (const value of [undefined, Symbol('unsupported'), 1n, () => {}, new Date(0), NaN, Infinity]) {
    expectInput(() => canonicalJson(value))
  }
  expectInput(() => canonicalJson({ present: true, missing: undefined }))
  let objectGetterReads = 0
  const accessorObject = {}
  Object.defineProperty(accessorObject, 'value', {
    enumerable: true,
    get() { objectGetterReads += 1; throw new Error('OBJECT_ACCESSOR_CANARY') },
  })
  expectInput(() => canonicalJson(accessorObject), 'OBJECT_ACCESSOR_CANARY')
  assert.equal(objectGetterReads, 0)
  let objectSetterWrites = 0
  const setterObject = {}
  Object.defineProperty(setterObject, 'value', {
    enumerable: true,
    set() { objectSetterWrites += 1 },
  })
  expectInput(() => canonicalJson(setterObject))
  assert.equal(objectSetterWrites, 0)
  expectInput(() => canonicalJson(nullPrototypeInput({ value: 1 })))
  expectInput(() => canonicalJson({ value: 1, [Symbol('extra')]: 2 }))
  const hiddenObject = {}
  Object.defineProperty(hiddenObject, 'value', { value: 1, enumerable: false })
  expectInput(() => canonicalJson(hiddenObject))
  let arrayGetterReads = 0
  const accessorArray = []
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get() { arrayGetterReads += 1; throw new Error('ARRAY_ACCESSOR_CANARY') },
  })
  expectInput(() => canonicalJson(accessorArray), 'ARRAY_ACCESSOR_CANARY')
  assert.equal(arrayGetterReads, 0)
  const cycle = {}; cycle.self = cycle
  expectInput(() => canonicalJson(cycle))
  expectInput(() => canonicalJson(new Array(1)))
  const extendedArray = [1]; extendedArray.extra = 2
  expectInput(() => canonicalJson(extendedArray))
  const symbolArray = [1]; symbolArray[Symbol('extra')] = 2
  expectInput(() => canonicalJson(symbolArray))
  const hiddenElementArray = [1]
  Object.defineProperty(hiddenElementArray, '0', { value: 1, enumerable: false })
  expectInput(() => canonicalJson(hiddenElementArray))
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    const canary = `CANONICAL_${trap}_CANARY`
    expectInput(() => canonicalJson(proxyWithThrowingTrap({ value: 1 }, trap, canary)), canary)
  }
  let deepValue = 'leaf'
  for (let depth = 0; depth < 128; depth += 1) deepValue = { value: deepValue }
  expectInput(() => canonicalJson(deepValue))
  expectInput(() => canonicalJson(Array.from({ length: 10_001 }, () => null)))
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256('你好'), '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e')
  for (const value of [undefined, 123, null, new String('abc')]) expectInput(() => sha256(value))
  assert.deepEqual(ERROR_CODES, EXPECTED_ERROR_CODES)
  assert.ok(Object.isFrozen(ERROR_CODES))
  completed += 1
})

after(() => {
  assert.equal(completed, 3)
  console.log('D2_PRIME_GOVERNANCE_CONTRACT_ALL_PASS')
})
