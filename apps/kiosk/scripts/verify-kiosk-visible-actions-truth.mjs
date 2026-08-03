import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

const agencies = read('src/pages/offline-agencies/OfflineAgenciesPage.tsx')
const fairMap = read('src/pages/job-fairs/FairMapPage.tsx')
const resumeExport = read('src/pages/resume/ResumeExportPage.tsx')

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

console.log('PASS kiosk visible actions truth contract')
