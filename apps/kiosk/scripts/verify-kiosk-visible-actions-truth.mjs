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
// 2026-09-20 青序流光迁移：旧四 Tab 壳 components/JobFairDetailTabs.tsx 退休，
// 详情页正文（含场馆图）改由 components/FairDetailSections.tsx 承载。
const fairDetailSections = read('src/pages/job-fairs/components/FairDetailSections.tsx')
const sourceMeta = read('src/pages/jobs/components/W4Presentation.tsx')
const contractResult = read('src/pages/contract-review/ContractReviewResultPage.tsx')
const contractProcessing = read('src/pages/contract-review/ContractReviewProcessingPage.tsx')
const contractApi = read('src/services/api/contractReview.ts')
// 五个服务台共用的青序流光实现（/resume-service 等五条的活面）。
const resumeHub = read('src/pages/service-hubs/QxServiceHubPage.tsx')

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
// 重试入口 2026-09-20 从 KioskStatePanel 的 onRetry 槽改成青序流光 ctabar 里的
// 「重新加载」按钮；能力没变（用户能自己重试），断言跟到新写法。
assert.match(fairMap, /重新加载/)
assert.match(fairMap, /setRetryKey\(\(value\) => value \+ 1\)/)
assert.doesNotMatch(fairMap, /打印展位分布图/)
assert.doesNotMatch(fairMap, /window\.print|(?:fileUrl|printFileUrl)\s*:\s*(?:mapImageUrl|previewUrl)|navigate\(['"]\/print/)
assert.doesNotMatch(fairMap, /入口 \/ 签到|咨询服务台|打印服务点/)
assert.doesNotMatch(fairMap, /展位 \$\{zone\.zoneName\}01/)

assert.equal(existsSync(join(root, 'src/pages/resume/ResumeExportPage.tsx')), false, 'AI-07 ResumeExportPage is deleted')
assert.match(routes, /path: 'resume\/export'[\s\S]*?<Navigate to="\/resume\/optimize" replace \/>/)
assert.doesNotMatch(mapBlock, /openstreetmap/)
assert.doesNotMatch(fairDetailSections, /openstreetmap/)
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

// 2026-09-20：/resume-service 迁入青序流光（稿 16），旧壳 ResumeServiceHubPage 已从
// 路由摘掉，五个服务台共用 QxServiceHubPage。合同审查入口随之搬进新页——
// 它是稿没画、代码长出来的能力，**迁移时最容易整条丢掉**，所以锚点必须跟到活面。
// 四条判据一字未改：默认关闭的开关、分组标题、入口名、落点路由。
assert.match(resumeHub, /VITE_ENABLE_CONTRACT_REVIEW === 'true'/)
assert.match(resumeHub, /签约与权益/)
assert.match(resumeHub, /AI签约风险提示/)
assert.match(resumeHub, /route: '\/contract-review'/)
// 默认关闭的边界：开关之外不得有第二条通往 /contract-review 的入口，
// 也不得把它塞进无条件渲染的能力网格。
assert.match(
  resumeHub,
  /const showContractReview = hub === 'resume' && contractReviewEnabled/,
  'QxServiceHubPage: 合同审查入口必须同时受 hub 与默认关闭开关约束',
)
assert.match(
  resumeHub,
  /\{showContractReview \? \(/,
  'QxServiceHubPage: 合同审查分区必须由 showContractReview 条件渲染',
)

console.log('PASS kiosk visible actions truth contract')
