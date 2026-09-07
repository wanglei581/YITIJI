import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import PDFDocument from 'pdfkit'
import {
  CJK_FONT_MISSING_USER_MESSAGE,
  cjkFontCandidates,
  probeCjkFont,
  registerCjkFont,
} from '../src/common/pdf/cjk-font'
import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'

const ROOT = join(__dirname, '..')
const SERVICES = [
  'src/ai/resume/resume-pdf.service.ts',
  'src/advisor/advisor-pdf.service.ts',
  'src/contract-review/contract-review-report-pdf.service.ts',
  'src/ai/resume/fair-visit-plan-pdf.service.ts',
  'src/ai/resume/self-assessment-pdf.service.ts',
  'src/ai/resume/job-fit-pdf.service.ts',
  'src/mock-interview/interview-report-pdf.service.ts',
  'src/ai/resume/career-plan-pdf.service.ts',
  'src/job-materials/job-material-pdf.service.ts',
  'src/jobs/fair-company-print.service.ts',
] as const

let passCount = 0

function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function assertIncludes(source: string, expected: string, message: string): void {
  if (!source.includes(expected)) fail(message)
  pass(message)
}

console.log('\n=== CJK font unification verification ===')

const commonSource = read('src/common/pdf/cjk-font.ts')
for (const requiredPath of [
  'msyh.ttc',
  'msyh.ttf',
  'simhei.ttf',
  'simsun.ttc',
  'PingFang.ttc',
  'Hiragino Sans GB.ttc',
  'STHeiti Light.ttc',
  'Songti.ttc',
  'NotoSansCJK-Regular.ttc',
  'wqy-microhei.ttc',
]) {
  assertIncludes(commonSource, requiredPath, `公共模块保留候选路径 ${requiredPath}`)
}
assertIncludes(commonSource, "process.env['RESUME_PDF_FONT_PATH']", 'RESUME_PDF_FONT_PATH 是统一主配置')
assertIncludes(commonSource, "process.env['RESUME_PDF_FONT_FAMILY']", 'RESUME_PDF_FONT_FAMILY 是统一主字体族配置')
assertIncludes(commonSource, "process.env['JOB_MATERIAL_PDF_FONT_PATH']", '兼容 JOB_MATERIAL_PDF_FONT_PATH 回退')
assertIncludes(commonSource, 'let cachedFont', '字体解析使用进程内缓存')

for (const relativePath of SERVICES) {
  const source = read(relativePath)
  if (!source.includes("common/pdf/cjk-font")) fail(`${relativePath} 未接入公共字体模块`)
  if (/function\s+fontCandidates|interface\s+FontCandidate/.test(source)) {
    fail(`${relativePath} 仍保留漂移的字体候选实现`)
  }
  assertIncludes(source, 'CJK_FONT_MISSING_USER_MESSAGE', `${relativePath} 使用统一缺字体文案`)
  pass(`${relativePath} 只调用公共字体模块`)
}

const previous = {
  resumePath: process.env['RESUME_PDF_FONT_PATH'],
  resumeFamily: process.env['RESUME_PDF_FONT_FAMILY'],
  legacyPath: process.env['JOB_MATERIAL_PDF_FONT_PATH'],
  legacyFamily: process.env['JOB_MATERIAL_PDF_FONT_FAMILY'],
}
try {
  process.env['RESUME_PDF_FONT_PATH'] = '/verify/resume-font.ttc'
  process.env['RESUME_PDF_FONT_FAMILY'] = 'Resume Font'
  process.env['JOB_MATERIAL_PDF_FONT_PATH'] = '/verify/legacy-font.ttc'
  process.env['JOB_MATERIAL_PDF_FONT_FAMILY'] = 'Legacy Font'
  const candidates = cjkFontCandidates()
  if (candidates[0]?.path !== '/verify/resume-font.ttc' || candidates[0]?.family !== 'Resume Font') {
    fail('RESUME_PDF_FONT_PATH / _FAMILY 未排在候选首位')
  }
  if (candidates[1]?.path !== '/verify/legacy-font.ttc' || candidates[1]?.family !== 'Legacy Font') {
    fail('JOB_MATERIAL_PDF_FONT_PATH 兼容项未排在系统候选之前')
  }
  pass('字体环境变量优先级正确')
} finally {
  for (const [key, value] of Object.entries({
    RESUME_PDF_FONT_PATH: previous.resumePath,
    RESUME_PDF_FONT_FAMILY: previous.resumeFamily,
    JOB_MATERIAL_PDF_FONT_PATH: previous.legacyPath,
    JOB_MATERIAL_PDF_FONT_FAMILY: previous.legacyFamily,
  })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const probe = probeCjkFont()
if (!probe.ok || !probe.path || !existsSync(probe.path)) {
  fail(`当前验证环境没有可由 PDFKit 注册的中文字体；tried=${probe.tried.join(',')}`)
}
const doc = new PDFDocument({ autoFirstPage: false })
if (!registerCjkFont(doc)) fail('registerCjkFont 未能注册 probe 命中的字体')
doc.end()
pass(`运行时字体探测和注册成功：${probe.path}`)

const missingProbe = { ok: false, path: null, family: null, tried: ['/verify/missing-font.ttc'] }
try {
  assertProductionRuntimeGates({ NODE_ENV: 'production' }, missingProbe)
  fail('生产缺字体未拒绝启动')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes('PRODUCTION_CJK_FONT_MISSING')) throw error
  pass('生产缺字体返回 PRODUCTION_CJK_FONT_MISSING')
}

const healthSource = read('src/common/health.controller.ts')
assertIncludes(healthSource, "@Get('cjk-font')", '管理员字体探测路由已注册')
assertIncludes(healthSource, '@UseGuards(JwtAuthGuard, RolesGuard)', '字体探测路由要求内部 JWT')
assertIncludes(healthSource, "@Roles('admin')", '字体探测路由仅管理员可读')

if (CJK_FONT_MISSING_USER_MESSAGE !== '服务器缺少中文字体，已通知运维；你可以先打印原件或扫码保存') {
  fail('统一缺字体用户文案发生漂移')
}
pass('统一缺字体用户文案符合任务包')

console.log(`\n=== ALL PASS (${passCount}) ===`)
