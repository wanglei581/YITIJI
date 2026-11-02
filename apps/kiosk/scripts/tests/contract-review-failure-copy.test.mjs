/**
 * 签约风险提示：创建审查任务没成时，屏上对人说的话（走查 I-28）。
 *
 * 走查实录：后端排队不可用（503 CONTRACT_REVIEW_QUEUE_UNAVAILABLE），页面却写「请检查文件格式后重试」，
 * 让人去查自己的文件；换多少份文件都不会好。判据：服务这一头没接住（排队不可用、服务端出错、够不着服务）
 * 如实说是服务暂时用不了；只有服务明确回了「请求本身有问题」的 4xx 才说文件。
 * 转译真实源码来跑，不另抄一份句子。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(relative) {
  const absolute = join(kioskRoot, relative)
  const out = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolute,
  }).outputText
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(leftover, [], `${relative} 不该有运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const failure = await import(transpile('src/pages/contract-review/contractReviewFailure.ts'))

class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

test('排队不可用（503）说服务暂时用不了，不让人去查文件', () => {
  const err = new ApiError('CONTRACT_REVIEW_QUEUE_UNAVAILABLE', '合同审查任务暂无法排队，请稍后重试', 503)
  assert.equal(failure.isContractReviewServiceFailure(err), true)
  const text = failure.contractReviewCreateFailureText(err)
  assert.equal(text, failure.CONTRACT_SERVICE_DOWN_NOTICE)
  assert.match(text, /服务暂时用不了/)
  assert.match(text, /不是你的文件有问题/)
  assert.doesNotMatch(text, /检查文件格式/)
})

test('服务端出错（5xx）、够不着服务（网络错误、状态 0）一律算服务这一头的问题', () => {
  for (const err of [
    new ApiError('INTERNAL_ERROR', '服务器内部错误', 500),
    new ApiError('BAD_GATEWAY', '网关错误', 502),
    new ApiError('SERVICE_UNAVAILABLE', '服务暂不可用', 503),
    new ApiError('NETWORK_ERROR', '网络连接失败', 0),
    new ApiError('UNKNOWN', '请求失败（0）', 0),
    new TypeError('Failed to fetch'),
  ]) {
    assert.equal(failure.isContractReviewServiceFailure(err), true, `${err.code ?? err.name} 应判为服务问题`)
    assert.equal(failure.contractReviewCreateFailureText(err), failure.CONTRACT_SERVICE_DOWN_NOTICE)
  }
})

test('服务明确回了请求本身有问题的 4xx，才说检查文件', () => {
  for (const err of [
    new ApiError('VALIDATION_FAILED', '参数不对', 400),
    new ApiError('FILE_TYPE_UNSUPPORTED', '文件类型不支持', 415),
    new ApiError('FILE_TOO_LARGE', '文件过大', 413),
    new ApiError('CONTRACT_REVIEW_CONSENT_INVALID', '同意版本不对', 422),
  ]) {
    assert.equal(failure.isContractReviewServiceFailure(err), false, `${err.code} 不是服务问题`)
    assert.equal(failure.contractReviewCreateFailureText(err), failure.CONTRACT_FILE_PROBLEM_NOTICE)
  }
  assert.match(failure.CONTRACT_FILE_PROBLEM_NOTICE, /检查文件格式/)
})

test('认不出的错误不当成服务问题（不冤枉服务，也不放过文件）', () => {
  for (const err of [new Error('boom'), null, undefined, 'x', {}]) {
    assert.equal(failure.isContractReviewServiceFailure(err), false)
    assert.equal(failure.contractReviewCreateFailureText(err), failure.CONTRACT_FILE_PROBLEM_NOTICE)
  }
})

test('服务暂时用不了的说法带出路，并且不含现场叫人的话', () => {
  assert.match(failure.CONTRACT_SERVICE_DOWN_NOTICE, /稍后再试/)
  assert.match(failure.CONTRACT_SERVICE_DOWN_NOTICE, /打印扫描/)
  assert.doesNotMatch(failure.CONTRACT_SERVICE_DOWN_NOTICE, /工作人员|现场|前台|窗口/)
})

test('页面真的用这个判断，不再自己写死「检查文件格式」', () => {
  const page = readFileSync(join(kioskRoot, 'src/pages/contract-review/ContractReviewHomePage.tsx'), 'utf8')
  assert.match(page, /contractReviewCreateFailureText\(err\)/)
  assert.doesNotMatch(page, /请检查文件格式后重试/)
  assert.match(page, /isContractReviewServiceFailure\(err\)/)
})
