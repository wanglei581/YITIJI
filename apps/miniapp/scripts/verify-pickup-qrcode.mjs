#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PICKUP_CODE_RE, createPickupQrMatrix, normalizePickupCode } = require('../utils/pickup-qrcode.js')

const samples = [
  ['23456789AB', 'ea6229113c5b5729f46d786b79bdbed0d95b302168214dd14bb5f19e1a82abba'],
  ['ABCDEFGHJK', '020c59ea87bafc7941c75b099fdc1abeee82008cf2d30fc1f5d2aa09b673dd27'],
  ['MNPQRSTUVW', 'e8f79a88b0eac6487e5d77a16aac5802d9ffee9f91a56299beb1df0bf0151245'],
  ['ZY9X8W7V6U', 'c8437537013b7826e22359264fcacbb827ca3d77acfe7a625fc4b458ac9c277c'],
]

function matrixFingerprint(matrix) {
  return matrix.map((row) => row.map((cell) => cell ? '1' : '0').join('')).join('\n')
}

assert.equal(normalizePickupCode('ab-cd ef-ghjk'), 'ABCDEFGHJK')
assert.equal(normalizePickupCode('  zy9x-8w7v6u '), 'ZY9X8W7V6U')
assert.throws(() => createPickupQrMatrix('0123456789'), /PICKUP_CODE_INVALID/)
assert.throws(() => createPickupQrMatrix('TOO-SHORT'), /PICKUP_CODE_INVALID/)

const fingerprints = new Set()
for (const [code, expectedFingerprint] of samples) {
  assert.match(code, PICKUP_CODE_RE)
  const matrix = createPickupQrMatrix(code)
  assert.equal(matrix.length, 21, `${code}: QR version must stay at 1`)
  assert.ok(matrix.every((row) => row.length === 21), `${code}: matrix must be square`)
  assert.ok(matrix.flat().every((cell) => typeof cell === 'boolean'), `${code}: modules must be boolean`)
  const fingerprint = matrixFingerprint(matrix)
  fingerprints.add(fingerprint)
  const digest = createHash('sha256').update(fingerprint).digest('hex')
  assert.equal(digest, expectedFingerprint, `${code}: QR matrix must match the frozen reference`)
}
assert.equal(fingerprints.size, samples.length, 'different pickup codes must not render the same QR')

console.log(`PICKUP_QR_MATRIX_PASS samples=${samples.length} version=1 ecc=H`)
