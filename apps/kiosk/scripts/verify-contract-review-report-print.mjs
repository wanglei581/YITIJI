import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const result = read('src/pages/contract-review/ContractReviewResultPage.tsx')
const flow = read('src/pages/contract-review/contractReviewReportPrintFlow.ts')
const api = read('src/services/api/contractReview.ts')
const printJobs = readFileSync(join(root, '..', '..', 'services/api/src/print-jobs/print-jobs.service.ts'), 'utf8')

assert.match(flow, /CONTRACT_REVIEW_REPORT_PRINT_FORBIDDEN/)
assert.doesNotMatch(flow, /import\.meta\.env\.VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT/)
assert.doesNotMatch(result, /VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT|REPORT_PRINT_ENABLED|prepareContractReviewReportPrint/)
assert.doesNotMatch(result, /navigate\('\/print\/confirm'/)
assert.match(result, /keepContractReviewReport/)
assert.match(result, /保存到我的文档/)
assert.match(result, /确认保存 90 天/)
assert.match(api, /\/contract-reviews\/\$\{id\}\/report\/keep/)
assert.match(printJobs, /PRINT_CONTRACT_REPORT_FORBIDDEN/)
assert.match(printJobs, /purpose === 'contract_review_report'/)

console.log('PASS contract review report is keepable and print-forbidden')
