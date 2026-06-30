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

console.log('\n=== Admin job materials UI verification ===')

assertContains('package.json', '"verify:admin-job-materials-ui"', 'Admin package exposes job materials verifier')
assertContains('src/routes/index.tsx', "path: 'job-materials'", 'Admin router exposes one /job-materials route')
assertContains('src/layouts/AdminLayoutWrapper.tsx', "key: 'job-materials'", 'Admin nav exposes one job-materials item')
assertContains('src/services/api/jobMaterials.ts', 'getJobMaterialAdminSummary', 'Admin service reads job materials summary')
assertContains('src/routes/job-materials/index.tsx', '求职材料库', 'Admin page title is job material library')
assertContains('src/routes/job-materials/index.tsx', '只读', 'Admin page makes readonly phase explicit')
assertContains('src/routes/job-materials/index.tsx', 'generatedFileCount', 'Admin page renders generated file count')
assertNotContains(
  'src/routes/job-materials/index.tsx',
  ['type="file"', '上传模板', '编辑模板', '一键投递', '立即投递', '平台投递'],
  'Admin page is readonly and avoids forbidden recruiting flow wording',
)

console.log('\nALL PASS')
