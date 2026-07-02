import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`PASS ${message}`)
}

function read(path) {
  const full = join(root, path)
  if (!existsSync(full)) fail(`missing ${path}`)
  return readFileSync(full, 'utf8')
}

function mustContain(path, tokens, message) {
  const text = read(path)
  const missing = tokens.filter((token) => !text.includes(token))
  if (missing.length) fail(`${message}; missing=${missing.join(', ')}`)
  pass(message)
}

function mustNotContain(path, tokens, message) {
  const text = read(path)
  const hit = tokens.find((token) => text.includes(token))
  if (hit) fail(`${message}; hit=${hit}`)
  pass(message)
}

console.log('\n=== Partner Excel 模板下载 UI 门禁 ===')

mustContain('package.json', ['"verify:excel-template-download-ui"'], 'Partner package 注册 Excel 模板下载 UI 门禁')
mustContain('src/services/api/partnerContent.ts', [
  'downloadExcelTemplate(dataType',
  'export const downloadExcelTemplate',
], 'Partner API 服务暴露模板下载方法')
mustContain('src/services/api/partnerHttpAdapter.ts', [
  '/partner/excel/template',
  'dataType',
  'blob()',
  'Content-Disposition',
  'URL.createObjectURL',
  'download',
], 'HTTP adapter 使用真实后端模板下载接口并触发文件下载')
mustContain('src/services/api/partnerMockAdapter.ts', [
  'downloadExcelTemplate',
  'downloadBlankTemplate',
  '外部ID*',
  '来源链接*',
], 'mock adapter 只生成空白固定模板，不生成假业务数据')
mustContain('src/routes/sources/ExcelImportModal.tsx', [
  'DownloadIcon',
  'downloadExcelTemplate',
  'downloadingTemplate',
  'handleDownloadTemplate',
  '下载岗位模板',
  '下载招聘会模板',
  '学历要求',
  '经验要求',
  '技能标签',
  '有效期',
  '签到链接',
], 'Excel 导入弹窗提供模板下载按钮并覆盖 AI-ready/签到字段')
mustNotContain('src/routes/sources/ExcelImportModal.tsx', [
  '候选人',
  '简历',
  '面试',
  'Offer',
  '一键投递',
  '立即投递',
  '平台投递',
], 'Excel 导入弹窗不引入候选人、简历或平台投递闭环文案')

console.log('ALL PASS')
