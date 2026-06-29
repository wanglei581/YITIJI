import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function read(path) {
  const full = join(root, path)
  if (!existsSync(full)) fail(`Missing required file: ${path}`)
  return readFileSync(full, 'utf8')
}

function assertContains(path, pattern, message) {
  const content = read(path)
  const ok = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
  if (!ok) fail(`${message} (${path})`)
  pass(message)
}

function assertNotContains(path, patterns, message) {
  const content = read(path)
  for (const pattern of patterns) {
    const hit = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
    if (hit) fail(`${message} (${path})`)
  }
  pass(message)
}

console.log('\n=== Kiosk job material library UI verification ===')

assertContains('package.json', '"verify:job-material-library-ui"', 'Kiosk package exposes job material UI verifier')
assertContains('src/services/api/index.ts', './jobMaterials', 'Kiosk API exports jobMaterials service')
assertContains('src/services/api/jobMaterials.ts', 'generateJobMaterial', 'Kiosk service can generate job material')
assertContains('src/pages/home/HomePage.tsx', "title: '简历素材库'", 'Homepage keeps existing resume material tile')
assertContains('src/pages/home/HomePage.tsx', "title: '求职材料'", 'Homepage keeps existing job material tile')
assertContains('src/pages/home/HomePage.tsx', "to: '/resume/templates", 'Homepage routes existing tiles to /resume/templates')
assertNotContains(
  'src/pages/home/HomePage.tsx',
  [/title:\s*'简历素材库'[^}]*disabled:\s*true/s, /title:\s*'求职材料'[^}]*disabled:\s*true/s],
  'Homepage job material tiles are no longer disabled',
)
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', '求职材料库', 'Template page is positioned as job material library')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', "if (tab === 'materials') return '求职信'", 'Job materials tile defaults to a material template filter')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'generateJobMaterial', 'Template page calls real generation API')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', "navigate('/print/confirm'", 'Template page can enter print confirm with generated file')
assertContains('src/pages/profile/me/MyDocumentsPage.tsx', 'PrinterIcon', 'MyDocuments exposes print action')
assertContains('src/pages/profile/me/MyDocumentsPage.tsx', "navigate('/print/confirm'", 'MyDocuments reuses print confirm route')
assertNotContains(
  'src/pages/resume/ResumeTemplateLibraryPage.tsx',
  ['MATERIALS:', '打印(待接入)', /disabled\s*title="模板真实渲染链路接入后开放打印"/],
  'Template page no longer exposes local placeholder or disabled print CTA',
)
assertNotContains(
  'src/pages/resume/ResumeTemplateLibraryPage.tsx',
  ['一键投递', '立即投递', '平台投递', '发送给企业'],
  'Template page avoids forbidden recruiting flow wording',
)

console.log('\nALL PASS')
