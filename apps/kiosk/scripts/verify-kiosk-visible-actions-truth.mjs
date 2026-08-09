import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

const agencies = read('src/pages/offline-agencies/OfflineAgenciesPage.tsx')
const fairMap = read('src/pages/job-fairs/FairMapPage.tsx')
const resumeExport = read('src/pages/resume/ResumeExportPage.tsx')
const contractResult = read('src/pages/contract-review/ContractReviewResultPage.tsx')
const contractProcessing = read('src/pages/contract-review/ContractReviewProcessingPage.tsx')
const contractApi = read('src/services/api/contractReview.ts')
const resumeHub = read('src/pages/resume/ResumeServiceHubPage.tsx')

assert.match(agencies, /type="search"/)
assert.match(agencies, /const \[searchInput, setSearchInput\] = useState\(''\)/)
assert.match(agencies, /const \[keyword, setKeyword\] = useState\(''\)/)
assert.match(agencies, /keyword: keyword \|\| undefined/)
assert.match(agencies, /const nextKeyword = searchInput\.trim\(\)[\s\S]*setKeyword\(nextKeyword\)/)
assert.match(agencies, /setSearchInput\(''\)[\s\S]*setKeyword\(''\)[\s\S]*setPage\(1\)/)
assert.match(agencies, /\}, \[keyword, page, retryKey\]\)/)
assert.doesNotMatch(agencies, /城东区|城南区|城北区|高新区/)
assert.doesNotMatch(agencies, /距本机|覆盖区域|oa-stats|stats-band/)

assert.match(fairMap, /navigate\(`\/job-fairs\/\$\{fairId\}\/materials`\)/)
assert.match(fairMap, /查看可打印导览资料/)
assert.match(fairMap, /暂无场馆导览数据/)
assert.match(fairMap, /disabled=\{!hasInteractiveMap\}/)
assert.match(fairMap, /onRetry=\{\(\) => setRetryKey/)
assert.doesNotMatch(fairMap, /打印展位分布图/)
assert.doesNotMatch(fairMap, /window\.print|(?:fileUrl|printFileUrl)\s*:\s*(?:mapImageUrl|previewUrl)|navigate\(['"]\/print/)
assert.doesNotMatch(fairMap, /入口 \/ 签到|咨询服务台|打印服务点/)
assert.doesNotMatch(fairMap, /展位 \$\{zone\.zoneName\}01/)

assert.match(resumeExport, /resume-lightflow__shell(?! resume-lightflow__shell--narrow)/)
assert.match(resumeExport, /disabled title="尚无真实导出文件"/)
assert.match(resumeExport, /navigate\('\/resume\/source'\)/)
assert.doesNotMatch(resumeExport, /new Blob|URL\.createObjectURL|signedUrl|printFileUrl|fileId/)

assert.match(contractResult, /disabled[\s\S]{0,160}?报告打印暂未开放/)
assert.doesNotMatch(contractResult, /navigate\(['"]\/print\/upload/)
assert.match(contractResult, /deleteContractReview/)
assert.match(contractResult, /结束并删除/)
assert.match(contractResult, /立即删除失败/)
assert.doesNotMatch(contractResult, /合同原文已在本次会话结束时删除/)

assert.match(contractProcessing, /token: getToken\(\), accessToken/)
assert.doesNotMatch(contractProcessing, /stageProgress|cr-progress-ring__pct/)
assert.match(contractApi, /if \(_mockStep !== 2 \|\| _mockConfirmed\)/)
assert.match(contractApi, /_mockConfirmed = true/)
assert.doesNotMatch(contractApi, /call\(`\/contract-reviews\/\$\{id\}`,[\s\S]{0,100}?\.catch\(\(\) => undefined\)/)

assert.match(resumeHub, /VITE_ENABLE_CONTRACT_REVIEW === 'true'/)
assert.match(resumeHub, /签约与权益/)
assert.match(resumeHub, /AI签约风险提示/)
assert.match(resumeHub, /navigate\('\/contract-review'\)/)

console.log('PASS kiosk visible actions truth contract')
