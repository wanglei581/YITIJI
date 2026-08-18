/**
 * Offline QR encoder for an arrival / pickup code.
 *
 * Accepts the live 10-character Crockford alphabet codes and the 8-digit
 * numeric codes issued after the pickup-code scheme change. Both payloads
 * still fit QR Model 2 version 1-H (21x21, 30% ECC), so the miniapp does
 * not need a network QR image endpoint or an npm build step.
 * The implementation follows ISO/IEC 18004 placement and Reed-Solomon rules.
 *
 * QR encoding core adapted from Project Nayuki's QR Code generator library.
 * Copyright (c) Project Nayuki. SPDX-License-Identifier: MIT.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const LEGACY_PICKUP_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/
const CURRENT_PICKUP_CODE_RE = /^[0-9]{8}$/
const PICKUP_CODE_RE = /^(?:[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}|[0-9]{8})$/
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'
const SIZE = 21
const DATA_CODEWORDS = 9
const ECC_CODEWORDS = 17
const MASK = 0
const HIGH_ECC_FORMAT_BITS = 2

function normalizePickupCode(raw) {
  return String(raw || '').replace(/[\s-]/g, '').toUpperCase()
}

function appendBits(target, value, length) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((value >>> bit) & 1)
}

function encodeDataCodewords(code) {
  const bits = []
  appendBits(bits, 0x2, 4) // Alphanumeric mode.
  appendBits(bits, code.length, 9)

  for (let index = 0; index < code.length; index += 2) {
    const first = ALPHANUMERIC.indexOf(code[index])
    if (index + 1 < code.length) {
      const second = ALPHANUMERIC.indexOf(code[index + 1])
      appendBits(bits, first * 45 + second, 11)
    } else {
      appendBits(bits, first, 6)
    }
  }

  const capacity = DATA_CODEWORDS * 8
  appendBits(bits, 0, Math.min(4, capacity - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords = []
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[index + bit]
    codewords.push(value)
  }
  for (let pad = 0xec; codewords.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) {
    codewords.push(pad)
  }
  return codewords
}

function reedSolomonMultiply(left, right) {
  let result = 0
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d)
    result ^= ((right >>> bit) & 1) * left
  }
  return result
}

function reedSolomonDivisor(degree) {
  const result = Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let index = 0; index < degree; index += 1) {
    for (let cursor = 0; cursor < result.length; cursor += 1) {
      result[cursor] = reedSolomonMultiply(result[cursor], root)
      if (cursor + 1 < result.length) result[cursor] ^= result[cursor + 1]
    }
    root = reedSolomonMultiply(root, 2)
  }
  return result
}

function appendErrorCorrection(data) {
  const divisor = reedSolomonDivisor(ECC_CODEWORDS)
  const remainder = Array(ECC_CODEWORDS).fill(0)
  for (const byte of data) {
    const factor = byte ^ remainder.shift()
    remainder.push(0)
    divisor.forEach((coefficient, index) => {
      remainder[index] ^= reedSolomonMultiply(coefficient, factor)
    })
  }
  return data.concat(remainder)
}

function createEmptyMatrix() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(false))
}

function drawFunctionPatterns(modules, isFunction) {
  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    modules[y][x] = Boolean(dark)
    isFunction[y][x] = true
  }

  for (let index = 0; index < SIZE; index += 1) {
    setFunction(6, index, index % 2 === 0)
    setFunction(index, 6, index % 2 === 0)
  }

  const drawFinder = (centerX, centerY) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        setFunction(centerX + dx, centerY + dy, distance !== 2 && distance !== 4)
      }
    }
  }
  drawFinder(3, 3)
  drawFinder(SIZE - 4, 3)
  drawFinder(3, SIZE - 4)
}

function formatBit(value, bit) {
  return ((value >>> bit) & 1) !== 0
}

function drawFormatBits(modules, isFunction) {
  const setFunction = (x, y, dark) => {
    modules[y][x] = Boolean(dark)
    isFunction[y][x] = true
  }
  const data = (HIGH_ECC_FORMAT_BITS << 3) | MASK
  let remainder = data
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  }
  const bits = ((data << 10) | remainder) ^ 0x5412

  for (let index = 0; index <= 5; index += 1) setFunction(8, index, formatBit(bits, index))
  setFunction(8, 7, formatBit(bits, 6))
  setFunction(8, 8, formatBit(bits, 7))
  setFunction(7, 8, formatBit(bits, 8))
  for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, formatBit(bits, index))
  for (let index = 0; index < 8; index += 1) setFunction(SIZE - 1 - index, 8, formatBit(bits, index))
  for (let index = 8; index < 15; index += 1) setFunction(8, SIZE - 15 + index, formatBit(bits, index))
  setFunction(8, SIZE - 8, true)
}

function drawCodewords(modules, isFunction, codewords) {
  let bitIndex = 0
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset
        const upward = ((right + 1) & 2) === 0
        const y = upward ? SIZE - 1 - vertical : vertical
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          const byte = codewords[bitIndex >>> 3]
          modules[y][x] = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0
          bitIndex += 1
        }
      }
    }
  }
  if (bitIndex !== codewords.length * 8) throw new Error('PICKUP_QR_DATA_PLACEMENT_FAILED')
}

function applyMask(modules, isFunction) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x]
    }
  }
}

function createPickupQrMatrix(rawCode) {
  const code = normalizePickupCode(rawCode)
  if (!PICKUP_CODE_RE.test(code)) throw new Error('PICKUP_CODE_INVALID')

  const modules = createEmptyMatrix()
  const isFunction = createEmptyMatrix()
  drawFunctionPatterns(modules, isFunction)
  drawFormatBits(modules, isFunction)
  drawCodewords(modules, isFunction, appendErrorCorrection(encodeDataCodewords(code)))
  applyMask(modules, isFunction)
  drawFormatBits(modules, isFunction)
  return modules
}

module.exports = {
  PICKUP_CODE_RE,
  createPickupQrMatrix,
  normalizePickupCode,
}
