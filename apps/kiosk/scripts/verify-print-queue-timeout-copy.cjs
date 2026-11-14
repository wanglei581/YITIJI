'use strict'
/**
 * 执行一体机对照表：排队超时必须显示表里的句子，不用接口带回的 failureReasonForUser。
 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')

const apiRequire = createRequire(path.join(__dirname, '../../../services/api/package.json'))
apiRequire('@swc-node/register')
const { screenFailureReason, errorCodeToMessage } = apiRequire(path.join(__dirname, '../src/pages/print/printProgressModel.ts'))

const SCREEN = '这单等了太久没有打印，没有出纸，可以重新提交打印。'
const fromApi = '后端另写的一句，不该盖过对照表'

assert.equal(
  screenFailureReason({ errorCode: 'PRINT_QUEUE_TIMEOUT', failureReasonForUser: fromApi }),
  SCREEN,
)
assert.equal(screenFailureReason({ errorCode: 'PRINT_QUEUE_TIMEOUT', failureReasonForUser: '' }), SCREEN)
// 离线、缺纸、卡纸同样用对照表：接口若仍写着找人，失败页会整句换成下一步，看不出是哪一种故障。
for (const code of ['PRINTER_OFFLINE', 'PAPER_EMPTY', 'PRINTER_ERROR']) {
  const shown = screenFailureReason({ errorCode: code, failureReasonForUser: '请联系工作人员处理' })
  assert.equal(shown, errorCodeToMessage(code))
  assert.equal(String(shown).includes('工作人员'), false)
  assert.match(String(shown), /打印有问题？/)
}
assert.match(errorCodeToMessage('PRINTER_OFFLINE'), /^打印机离线，请稍后重试。/)
assert.match(errorCodeToMessage('PAPER_EMPTY'), /^打印机缺纸，当前无法打印。/)
assert.match(errorCodeToMessage('PRINTER_ERROR'), /^打印机可能卡纸或发生设备故障，当前暂时无法继续使用。/)
// 其它错误码仍先用接口文案。这三条改口之后，这条约定不能一起放宽。
assert.equal(
  screenFailureReason({ errorCode: 'PRINT_TIMEOUT', failureReasonForUser: '打印超时，请稍后重试' }),
  '打印超时，请稍后重试',
)
assert.equal(SCREEN.includes('工作人员'), false)
console.log('PASS 排队超时、离线、缺纸、卡纸屏上文案用对照表，不用接口带回的句子')
