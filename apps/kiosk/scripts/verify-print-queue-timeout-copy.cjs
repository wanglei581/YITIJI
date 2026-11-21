'use strict'
/**
 * 执行一体机对照表：排队超时必须显示表里的句子，不用接口带回的 failureReasonForUser。
 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')

const apiRequire = createRequire(path.join(__dirname, '../../../services/api/package.json'))
apiRequire('@swc-node/register')
const { screenFailureReason, errorCodeToMessage, presentScreenFailure } = apiRequire(path.join(__dirname, '../src/pages/print/printProgressModel.ts'))

const SCREEN = '这单等了太久没有打印，没有出纸，可以重新提交打印。'
const fromApi = '后端另写的一句，不该盖过对照表'

assert.equal(
  screenFailureReason({ errorCode: 'PRINT_QUEUE_TIMEOUT', failureReasonForUser: fromApi }),
  SCREEN,
)
assert.equal(screenFailureReason({ errorCode: 'PRINT_QUEUE_TIMEOUT', failureReasonForUser: '' }), SCREEN)
// 离线、缺纸、卡纸用对照表，再接「这台机器暂时打不了」的下一步。
// 接口若仍写着找人，也不许整句换成「打印有问题」，否则看不出是哪一种故障。
for (const code of ['PRINTER_OFFLINE', 'PAPER_EMPTY', 'PRINTER_ERROR']) {
  const base = screenFailureReason({ errorCode: code, failureReasonForUser: '请联系工作人员处理' })
  assert.equal(base, errorCodeToMessage(code))
  assert.equal(String(base).includes('工作人员'), false)
  assert.equal(String(base).includes('打印有问题'), false)
  const shown = presentScreenFailure({ errorCode: code, failureReasonForUser: '请联系工作人员处理' })
  assert.match(String(shown), new RegExp('^' + String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(String(shown), /这台机器暂时打不了/)
  assert.match(String(shown), /请稍后再来/)
  assert.equal(String(shown).includes('工作人员'), false)
  assert.equal(String(shown).includes('打印有问题'), false)
}
const otherKept = presentScreenFailure({ errorCode: 'PRINT_TIMEOUT', failureReasonForUser: '打印超时，请稍后重试' })
assert.equal(otherKept, '打印超时，请稍后重试')
const otherFallback = presentScreenFailure({ errorCode: 'PRINT_TIMEOUT', failureReasonForUser: '打印超时，请联系工作人员' })
assert.match(String(otherFallback), /打印有问题？/)
assert.equal(String(otherFallback).includes('工作人员'), false)
// S15c2：离线失败屏第 3 步已写「请稍后再来」，对照表基句不再写「请稍后重试」。服务端那句不改，这三态不用接口句。
assert.match(errorCodeToMessage('PRINTER_OFFLINE'), /^打印机离线，当前无法打印。/)
assert.match(errorCodeToMessage('PAPER_EMPTY'), /^打印机缺纸，当前无法打印。/)
assert.match(errorCodeToMessage('PRINTER_ERROR'), /^打印机可能卡纸或发生设备故障，当前暂时无法继续使用。/)
// 其它错误码仍先用接口文案。这三条改口之后，这条约定不能一起放宽。
assert.equal(
  screenFailureReason({ errorCode: 'PRINT_TIMEOUT', failureReasonForUser: '打印超时，请稍后重试' }),
  '打印超时，请稍后重试',
)
assert.equal(SCREEN.includes('工作人员'), false)
console.log('PASS 排队超时、离线、缺纸、卡纸屏上文案用对照表，不用接口带回的句子')
