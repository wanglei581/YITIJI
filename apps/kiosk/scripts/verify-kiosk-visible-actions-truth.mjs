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
// 无真实产物时保存/打印必须不可用 —— 这条真值没变，兑现方式变了。
// #620（fix(kiosk): make disabled reasons reachable on the touch terminal）指出
// 原来的「原生 disabled + title」在 27 寸竖屏触摸屏上等于没给原因：没有 hover，
// title 永不显示；原生 disabled 还让按钮掉出 tab 序、读屏跳过。
// 现契约 = aria-disabled + onClick 短路 + 常显原因段落 + aria-describedby 关联。
// 断言按这四件事逐条钉，比原来那一条串更严，且拒绝退回原生 disabled。
const resumeExportBlocked = /<Button[^>]*aria-disabled="true"[^>]*aria-describedby="resume-export-blocked-why"[\s\S]*?onClick=\{\(event\) => event\.preventDefault\(\)\}/g
assert.equal(
  (resumeExport.match(resumeExportBlocked) ?? []).length,
  2,
  '保存 / 打印两个按钮都必须是 aria-disabled + 原因关联 + 点击短路',
)
assert.match(resumeExport, /id="resume-export-blocked-why"/)
assert.match(resumeExport, /这两项要等真实导出文件生成后才能用/)
// 触屏上不可解释的禁用方式不得回潮：本页不许再出现原生 disabled / title 提示。
// 剥掉 JSX 注释再判——页面里那段注释正是在记录「原本是原生 disabled + title」的历史。
const resumeExportCode = resumeExport.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
assert.doesNotMatch(resumeExportCode, /<Button[^>]*\sdisabled(\s|>|=\{)/)
assert.doesNotMatch(resumeExportCode, /title="尚无真实导出文件"/)
assert.match(resumeExport, /navigate\('\/resume\/source'\)/)
assert.doesNotMatch(resumeExport, /new Blob|URL\.createObjectURL|signedUrl|printFileUrl|fileId/)

assert.match(contractResult, /disabled=\{!REPORT_PRINT_ENABLED \|\| deleting \|\| generatingReport\}/)
assert.match(contractResult, /REPORT_PRINT_ENABLED \? '打印风险提示报告' : '报告打印暂未开放'/)
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
