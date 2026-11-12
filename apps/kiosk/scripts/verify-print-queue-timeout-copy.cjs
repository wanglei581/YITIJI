'use strict'
/**
 * 执行一体机对照表：排队超时必须显示表里的句子，不用接口带回的 failureReasonForUser。
 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')

const apiRequire = createRequire(path.join(__dirname, '../../../services/api/package.json'))
apiRequire('@swc-node/register')
const { screenFailureReason } = apiRequire(path.join(__dirname, '../src/pages/print/printProgressModel.ts'))

const SCREEN = '这单等了太久没有打印，没有出纸，可以重新提交打印。'
const fromApi = '后端另写的一句，不该盖过对照表'

assert.equal(
  screenFailureReason({ errorCode: 'PRINT_QUEUE_TIMEOUT', failureReasonForUser: fromApi }),
  SCREEN,
)
assert.equal(screenFailureReason({ errorCode: 'PRINT_QUEUE_TIMEOUT', failureReasonForUser: '' }), SCREEN)
assert.equal(
  screenFailureReason({ errorCode: 'PAPER_EMPTY', failureReasonForUser: '打印机缺纸，请补纸。' }),
  '打印机缺纸，请补纸。',
)
assert.equal(SCREEN.includes('工作人员'), false)
console.log('PASS 排队超时屏上文案用对照表，不用接口带回的句子')
