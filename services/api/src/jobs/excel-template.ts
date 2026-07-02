import { Workbook } from 'exceljs'
import {
  FAIR_REQUIRED_FIELDS,
  FAIR_STANDARD_FIELDS,
  JOB_REQUIRED_FIELDS,
  JOB_STANDARD_FIELDS,
  type FairStandardField,
  type JobStandardField,
} from './dto/excel-import.dto'
import { JOB_WORK_TYPE_VALUES } from './work-type'

export type PartnerExcelDataType = 'job' | 'fair'

export interface PartnerExcelTemplateField<T extends string = string> {
  key: T
  label: string
  required: boolean
  guide: string
  acceptedValues?: readonly string[]
}

export const JOB_TEMPLATE_FIELDS = [
  { key: 'externalId', label: '外部ID', required: true, guide: '客户来源系统内的唯一编号，后续重复导入会按此编号刷新展示字段。' },
  { key: 'title', label: '职位名称', required: true, guide: '公开岗位名称。' },
  { key: 'company', label: '公司名称', required: true, guide: '公开展示的招聘单位名称。' },
  { key: 'city', label: '工作城市', required: true, guide: '岗位工作城市。' },
  { key: 'sourceUrl', label: '来源链接', required: true, guide: '第三方或官方来源页面链接，必须以 http 或 https 开头。' },
  { key: 'salary', label: '薪资范围', required: false, guide: '来源平台已公开的薪资文本；未知可留空。' },
  { key: 'description', label: '职位描述', required: false, guide: '岗位职责、工作内容等公开描述。' },
  { key: 'requirements', label: '任职要求', required: false, guide: '任职资格、经验、技能等公开要求。' },
  { key: 'industry', label: '行业', required: false, guide: '行业名称，用于前台筛选和 AI 质量评估。' },
  {
    key: 'workType',
    label: '工作类型',
    required: false,
    guide: `枚举值：${JOB_WORK_TYPE_VALUES.join('、')}。`,
    acceptedValues: JOB_WORK_TYPE_VALUES,
  },
  { key: 'educationRequirement', label: '学历要求', required: false, guide: '来源平台提供的学历要求。' },
  { key: 'experienceRequirement', label: '经验要求', required: false, guide: '来源平台提供的工作经验要求。' },
  { key: 'skills', label: '技能标签', required: false, guide: '多个技能用逗号、顿号、分号或竖线分隔。' },
  { key: 'benefits', label: '福利', required: false, guide: '多个福利用逗号、顿号、分号或竖线分隔。' },
  { key: 'salaryMin', label: '最低薪资', required: false, guide: '数字，不带单位。' },
  { key: 'salaryMax', label: '最高薪资', required: false, guide: '数字，不带单位。' },
  { key: 'salaryUnit', label: '薪资单位', required: false, guide: '建议填写 monthly、yearly、daily、hourly 或来源平台公开单位。' },
  { key: 'validThrough', label: '有效期', required: false, guide: '岗位有效期，建议 ISO 日期或 YYYY-MM-DD。' },
] as const satisfies readonly PartnerExcelTemplateField<JobStandardField>[]

export const FAIR_TEMPLATE_FIELDS = [
  { key: 'externalId', label: '外部ID', required: true, guide: '客户来源系统内的招聘会唯一编号。' },
  { key: 'title', label: '活动名称', required: true, guide: '公开招聘会或宣讲会活动名称。' },
  { key: 'startAt', label: '开始时间', required: true, guide: 'ISO 时间或可解析日期时间，建议带时区。' },
  { key: 'endAt', label: '结束时间', required: true, guide: 'ISO 时间或可解析日期时间，建议带时区。' },
  { key: 'venue', label: '举办场馆', required: true, guide: '公开场馆名称。' },
  { key: 'city', label: '城市', required: true, guide: '举办城市。' },
  { key: 'sourceUrl', label: '来源链接', required: true, guide: '第三方或官方活动页面链接，必须以 http 或 https 开头。' },
  { key: 'checkinUrl', label: '签到链接', required: false, guide: '官方或第三方签到/预约二维码承载链接，必须以 http 或 https 开头。' },
  {
    key: 'theme',
    label: '主题',
    required: false,
    guide: '枚举值：general、campus、campus_corp、industry。',
    acceptedValues: ['general', 'campus', 'campus_corp', 'industry'],
  },
  { key: 'address', label: '详细地址', required: false, guide: '公开详细地址。' },
  { key: 'description', label: '活动介绍', required: false, guide: '公开活动简介、参会说明等。' },
  { key: 'companyCount', label: '参展企业数', required: false, guide: '来源方公开的预计/实际参展企业数，填非负整数。' },
  { key: 'jobCount', label: '岗位数', required: false, guide: '来源方公开的预计/实际岗位数，填非负整数。' },
] as const satisfies readonly PartnerExcelTemplateField<FairStandardField>[]

export function getPartnerExcelTemplateFields(dataType: PartnerExcelDataType): readonly PartnerExcelTemplateField[] {
  return dataType === 'job' ? JOB_TEMPLATE_FIELDS : FAIR_TEMPLATE_FIELDS
}

export function getPartnerExcelTemplateFileName(dataType: PartnerExcelDataType): string {
  return dataType === 'job' ? '岗位数据导入模板.xlsx' : '招聘会数据导入模板.xlsx'
}

export async function buildPartnerExcelTemplateBuffer(dataType: PartnerExcelDataType): Promise<Buffer> {
  const workbook = new Workbook()
  workbook.creator = 'AI求职打印服务终端'
  workbook.created = new Date()

  const fields = getPartnerExcelTemplateFields(dataType)
  const requiredFields = dataType === 'job' ? JOB_REQUIRED_FIELDS : FAIR_REQUIRED_FIELDS
  const standardFields = dataType === 'job' ? JOB_STANDARD_FIELDS : FAIR_STANDARD_FIELDS
  const requiredFieldSet = new Set<string>(requiredFields)
  const sheetName = dataType === 'job' ? '岗位数据' : '招聘会数据'
  const dataSheet = workbook.addWorksheet(sheetName)

  dataSheet.views = [{ state: 'frozen', ySplit: 1 }]
  dataSheet.addRow(fields.map((field) => `${field.label}${field.required ? '*' : ''}`))
  dataSheet.columns = fields.map((field) => ({
    key: field.key,
    width: Math.max(14, Math.min(28, field.label.length * 3 + 8)),
  }))

  const header = dataSheet.getRow(1)
  header.height = 24
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
      left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
      bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
      right: { style: 'thin', color: { argb: 'FFD9E2EC' } },
    }
  })

  fields.forEach((field, index) => {
    if (!field.acceptedValues) return
    for (let row = 2; row <= 1001; row += 1) {
      dataSheet.getCell(row, index + 1).dataValidation = {
        type: 'list',
        allowBlank: !field.required,
        formulae: [`"${field.acceptedValues.join(',')}"`],
        showErrorMessage: true,
        errorTitle: '字段值不在可选范围内',
        error: `请填写：${field.acceptedValues.join('、')}`,
      }
    }
  })

  const guide = workbook.addWorksheet('填写说明')
  guide.columns = [
    { key: 'field', width: 22 },
    { key: 'required', width: 10 },
    { key: 'standardKey', width: 24 },
    { key: 'guide', width: 72 },
    { key: 'values', width: 42 },
  ]
  guide.addRow(['字段', '是否必填', '系统字段', '填写说明', '可选值'])
  guide.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF335C67' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  for (const field of fields) {
    guide.addRow([
      field.label,
      requiredFieldSet.has(field.key) ? '是' : '否',
      field.key,
      field.guide,
      field.acceptedValues?.join(' / ') ?? '',
    ])
  }
  guide.addRow([])
  guide.addRow(['合规要求', '必读', '', '此模板只用于公开岗位/招聘会信息；禁止导入求职者个人信息、简历、报名、投递、面试、Offer 等数据。', ''])
  guide.addRow(['来源要求', '必读', '', '来源链接和签到链接必须指向第三方或官方来源；前台仅提供去来源平台的跳转/扫码入口。', ''])
  guide.addRow(['字段范围', '必读', '', `当前 ${dataType === 'job' ? '岗位' : '招聘会'} 模板字段必须与系统白名单一致：${standardFields.join(', ')}`, ''])
  guide.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
