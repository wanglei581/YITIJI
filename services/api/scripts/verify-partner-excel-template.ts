/**
 * Partner Excel 模板下载门禁。
 *
 * 覆盖：
 *   1. 模板下载路由必须走 Partner JWT + RolesGuard，不能公开下载。
 *   2. 模板必须返回真实 xlsx 文件，且文件名/Content-Type 正确。
 *   3. 岗位/招聘会模板字段必须覆盖后端 Excel 白名单字段，并标注必填字段。
 *   4. 模板不得包含候选人、简历、投递、面试、Offer 等敏感导入列。
 *   5. 模板数据页不能预置假岗位/假招聘会样例数据。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:partner-excel-template
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Workbook } from 'exceljs'
import {
  buildPartnerExcelTemplateBuffer,
  getPartnerExcelTemplateFields,
  getPartnerExcelTemplateFileName,
} from '../src/jobs/excel-template'
import {
  FAIR_REQUIRED_FIELDS,
  FAIR_STANDARD_FIELDS,
  JOB_REQUIRED_FIELDS,
  JOB_STANDARD_FIELDS,
  isSensitiveColumn,
} from '../src/jobs/dto/excel-import.dto'

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function read(rel: string): string {
  const abs = join(process.cwd(), rel)
  if (!existsSync(abs)) {
    fail(`文件缺失: ${rel}`)
    return ''
  }
  return readFileSync(abs, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

async function verifyTemplate(dataType: 'job' | 'fair'): Promise<void> {
  const fields = getPartnerExcelTemplateFields(dataType)
  const standardFields = dataType === 'job' ? JOB_STANDARD_FIELDS : FAIR_STANDARD_FIELDS
  const requiredFields = dataType === 'job' ? JOB_REQUIRED_FIELDS : FAIR_REQUIRED_FIELDS

  if (sameArray(fields.map((field) => field.key), standardFields)) {
    pass(`${dataType} 模板字段完整覆盖 Excel 白名单`)
  } else {
    fail(`${dataType} 模板字段与白名单不一致: ${fields.map((field) => field.key).join(',')}`)
  }

  const requiredInTemplate = fields.filter((field) => field.required).map((field) => field.key)
  if (sameArray(requiredInTemplate, requiredFields)) {
    pass(`${dataType} 模板必填字段与后端校验一致`)
  } else {
    fail(`${dataType} 模板必填字段与后端校验不一致: ${requiredInTemplate.join(',')}`)
  }

  const sensitiveLabels = fields.filter((field) => isSensitiveColumn(field.label))
  if (sensitiveLabels.length === 0) {
    pass(`${dataType} 模板字段不含敏感列名`)
  } else {
    fail(`${dataType} 模板字段命中敏感列: ${sensitiveLabels.map((field) => field.label).join(',')}`)
  }

  const fileName = getPartnerExcelTemplateFileName(dataType)
  if (fileName.endsWith('.xlsx') && fileName.includes(dataType === 'job' ? '岗位' : '招聘会')) {
    pass(`${dataType} 模板文件名明确且为 xlsx`)
  } else {
    fail(`${dataType} 模板文件名不符合预期: ${fileName}`)
  }

  const buffer = await buildPartnerExcelTemplateBuffer(dataType)
  if (buffer.byteLength > 2000 && buffer.subarray(0, 2).toString('utf8') === 'PK') {
    pass(`${dataType} 模板输出为有效 xlsx zip 包`)
  } else {
    fail(`${dataType} 模板输出不是有效 xlsx 文件`)
  }

  const workbook = new Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.getWorksheet(dataType === 'job' ? '岗位数据' : '招聘会数据')
  const guide = workbook.getWorksheet('填写说明')
  if (sheet && guide) {
    pass(`${dataType} 模板包含数据页和填写说明页`)
  } else {
    fail(`${dataType} 模板缺少数据页或填写说明页`)
    return
  }

  const headers = fields.map((field, index) => sheet.getRow(1).getCell(index + 1).text)
  const missingHeaders = fields.filter((field) => {
    const expected = `${field.label}${field.required ? '*' : ''}`
    return !headers.includes(expected)
  })
  if (missingHeaders.length === 0) {
    pass(`${dataType} 模板表头按必填标记输出`)
  } else {
    fail(`${dataType} 模板表头缺失: ${missingHeaders.map((field) => field.label).join(',')}`)
  }

  const populatedDataCells: string[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell((cell) => {
      const value = cell.text.trim()
      if (value) populatedDataCells.push(value)
    })
  })
  if (populatedDataCells.length === 0) {
    pass(`${dataType} 模板数据页不预置假业务样例`)
  } else {
    fail(`${dataType} 模板数据页存在预置数据: ${populatedDataCells.slice(0, 3).join(',')}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Partner Excel 模板下载门禁 ===')

  const controller = read('src/jobs/jobs.controller.ts')
  const template = read('src/jobs/excel-template.ts')
  const packageJson = read('package.json')
  const ci = read('../../.github/workflows/ci.yml')

  mustContain(packageJson, ['"verify:partner-excel-template"'], 'API package 注册模板下载门禁')
  mustContain(ci, ['verify:partner-excel-template'], 'CI 纳入模板下载门禁')
  mustContain(
    controller,
    [
      "@Get('partner/excel/template')",
      '@UseGuards(JwtAuthGuard, RolesGuard)',
      "@Roles('partner')",
      'downloadExcelTemplate',
      'Content-Disposition',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'INVALID_DATA_TYPE',
    ],
    '模板下载路由受 Partner 鉴权并返回 xlsx 附件',
  )
  mustContain(
    template,
    [
      'JOB_TEMPLATE_FIELDS',
      'FAIR_TEMPLATE_FIELDS',
      'buildPartnerExcelTemplateBuffer',
      'getPartnerExcelTemplateFields',
      '填写说明',
      '禁止导入求职者个人信息',
      '去来源平台',
    ],
    '模板生成器包含固定字段、说明页和合规提示',
  )

  await verifyTemplate('job')
  await verifyTemplate('fair')

  if (failed > 0) {
    console.error(`\nFAILURES: ${failed}`)
    process.exit(1)
  }
  console.log('ALL PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
