/**
 * 到机报价的三组整数分。单价 × 内容页数 × 份数，黑白和彩色分开加总。
 */
import assert from 'node:assert/strict'
import { quoteArrivalPrintCents } from '../../src/print-jobs/pickup-arrival-price'

export function assertArrivalQuoteAmounts(): void {
  const blackWhite = quoteArrivalPrintCents({
    unitBw: 123,
    unitColor: 367,
    billablePages: 3,
    printParamsJson: JSON.stringify({ copies: 2, colorMode: 'black_white' }),
    itemsJson: '[]',
    orderItems: [],
  })
  assert.equal(blackWhite.ok, true)
  if (blackWhite.ok) assert.equal(blackWhite.amountCents, 738)

  const color = quoteArrivalPrintCents({
    unitBw: 123,
    unitColor: 367,
    billablePages: 5,
    printParamsJson: JSON.stringify({ copies: 3, colorMode: 'color' }),
    itemsJson: '[]',
    orderItems: [],
  })
  assert.equal(color.ok, true)
  if (color.ok) assert.equal(color.amountCents, 5505)

  const mixed = quoteArrivalPrintCents({
    unitBw: 123,
    unitColor: 367,
    billablePages: null,
    printParamsJson: '{}',
    itemsJson: '[]',
    orderItems: [
      { billablePages: 3, copies: 2, colorMode: 'black_white' },
      { billablePages: 5, copies: 1, colorMode: 'color' },
    ],
  })
  assert.equal(mixed.ok, true)
  if (mixed.ok) assert.equal(mixed.amountCents, 2573)
}
