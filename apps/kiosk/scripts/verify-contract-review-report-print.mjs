import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const result = read('src/pages/contract-review/ContractReviewResultPage.tsx')
const flow = read('src/pages/contract-review/contractReviewReportPrintFlow.ts')
const confirm = read('src/pages/print/PrintConfirmPage.tsx')
const api = read('src/services/api/contractReview.ts')
const env = read('.env.example')

assert.match(env, /VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT=false/)
assert.match(flow, /VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT\s*===\s*'true'/)
assert.match(flow, /createContractReviewReport\(taskId,\s*access\)/)
assert.match(flow, /clearContractReviewSession\(\)[\s\S]*clearPrintMaterialSession\(\)[\s\S]*return\s*\{/)
assert.match(flow, /params:\s*REPORT_PRINT_PARAMS/)
assert.match(flow, /source:\s*'document'/)
assert.match(result, /prepareContractReviewReportPrint\(session\.taskId/)
assert.match(result, /navigate\('\/print\/confirm',\s*\{\s*replace:\s*true,\s*state:\s*handoff/)
assert.doesNotMatch(result, /createContractReviewReport|REPORT_PRINT_PARAMS|clearPrintMaterialSession/)
const printNavigation = result.match(/navigate\('\/print\/confirm',[\s\S]*?\n\s*\}\)\n/)?.[0] ?? ''
assert.ok(printNavigation)
assert.doesNotMatch(printNavigation, /session\.|taskId|accessToken/)
const handoffReturn = flow.match(/return\s*\{[\s\S]*?\n\s*\}\n\}/)?.[0] ?? ''
assert.ok(handoffReturn)
assert.doesNotMatch(handoffReturn, /taskId|accessToken/)

assert.match(api, /DELETE[\s\S]*x-contract-review-report-abandon-token/)
assert.match(confirm, /await abandonContractReviewReport\(contractReport\.fileId, contractReport\.abandonToken\)/)
assert.match(confirm, /navigate\('\/resume-service',\s*\{\s*replace:\s*true\s*\}\)/)
assert.match(confirm, /\.\.\.\(isContractReport\s*\?\s*\{\}\s*:\s*location\.state\)/)
assert.match(confirm, /!isContractReport\s*&&\s*selfAssessmentSnapshot\?\.taskId/)
assert.match(confirm, /按以上设置打印风险提示报告/)
assert.match(confirm, /本次仅打印 AI 风险提示报告，不打印合同原件/)

console.log('PASS contract review report uses the existing print chain with abandon cleanup')
