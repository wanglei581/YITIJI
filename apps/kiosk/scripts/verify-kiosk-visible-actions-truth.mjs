import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

const agencies = read('src/pages/offline-agencies/OfflineAgenciesPage.tsx')
const fairMap = read('src/pages/job-fairs/FairMapPage.tsx')
const fairCompanies = read('src/pages/job-fairs/FairCompaniesPage.tsx')
const fairMaterials = read('src/pages/job-fairs/FairMaterialsPage.tsx')
const routes = read('src/routes/index.tsx')
const mapBlock = read('src/pages/job-fairs/components/MapBlock.tsx')
const fairDetailTabs = read('src/pages/job-fairs/components/JobFairDetailTabs.tsx')
const sourceMeta = read('src/pages/jobs/components/W4Presentation.tsx')
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
assert.match(agencies, /\}, \[keyword, district, page, retryKey\]\)/)
assert.doesNotMatch(agencies, /城东区|城南区|城北区|高新区/)
assert.doesNotMatch(agencies, /距本机|覆盖区域|oa-stats|stats-band/)
assert.doesNotMatch(agencies, /全部区域/)
assert.match(agencies, /agencyStatusBadge\(agency\.status\)/)
assert.match(agencies, /district: district \|\| undefined/)
assert.doesNotMatch(agencies, /<span className="oa-st open">/)
assert.doesNotMatch(agencies, /正常收录|已核验/)
assert.match(agencies, /QxPageFrame/)
assert.match(agencies, /service: service \|\| undefined/)

assert.match(fairMap, /navigate\(`\/job-fairs\/\$\{fairId\}\/materials`\)/)
assert.match(fairMap, /查看可打印导览资料/)
assert.match(fairMap, /暂无场馆导览数据/)
assert.match(fairMap, /disabled=\{!hasInteractiveMap\}/)
assert.match(fairMap, /onRetry=\{\(\) => setRetryKey/)
assert.doesNotMatch(fairMap, /打印展位分布图/)
assert.doesNotMatch(fairMap, /window\.print|(?:fileUrl|printFileUrl)\s*:\s*(?:mapImageUrl|previewUrl)|navigate\(['"]\/print/)
assert.doesNotMatch(fairMap, /入口 \/ 签到|咨询服务台|打印服务点/)
assert.doesNotMatch(fairMap, /展位 \$\{zone\.zoneName\}01/)

assert.equal(existsSync(join(root, 'src/pages/resume/ResumeExportPage.tsx')), false, 'AI-07 ResumeExportPage is deleted')
assert.match(routes, /path: 'resume\/export'[\s\S]*?<Navigate to="\/resume\/optimize" replace \/>/)
assert.doesNotMatch(mapBlock, /openstreetmap/)
assert.doesNotMatch(fairDetailTabs, /openstreetmap/)
assert.match(mapBlock, /暂无地图，请以场馆地址为准/)
assert.doesNotMatch(fairCompanies, /syncTime \?\? fair\.startTime/)
assert.doesNotMatch(fairMap, /syncTime \?\? fair\.startTime/)
assert.doesNotMatch(fairMaterials, /syncTime \?\? fair\.startTime/)
assert.match(sourceMeta, /同步时间未知/)

assert.match(contractResult, /keepContractReviewReport/)
assert.match(contractResult, /保存到我的文档/)
assert.doesNotMatch(contractResult, /打印风险提示报告|报告打印暂未开放|REPORT_PRINT_ENABLED/)
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
assert.match(resumeHub, /badge: '签约与权益/)
assert.match(resumeHub, /AI签约风险提示/)
// 2026-09-23 服务中心迁入 QxServiceHub：页面只声明入口表，跳转由共享宿主按 `card.to` 执行。
// 断言随结构改写，不变量不变：开关打开时这张卡真的指向 /contract-review，且只在开关打开时出现。
assert.match(resumeHub, /key: 'contract-review'[\s\S]*?to: '\/contract-review'/)
assert.match(resumeHub, /contractReviewEnabled \? \[\.\.\.CAPABILITIES, CONTRACT_REVIEW_CARD\] : CAPABILITIES/)
assert.match(
  read('src/components/qingxu/service-hub/QxServiceHub.tsx'),
  /if \(!blocked\) navigate\(card\.to/,
)

console.log('PASS kiosk visible actions truth contract')
