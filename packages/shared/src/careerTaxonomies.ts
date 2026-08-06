export const EDUCATION_LEVEL_OPTIONS = [
  '初中及以下',
  '高中',
  '职高',
  '中专',
  '技校/中技',
  '高职专科',
  '大专',
  '本科',
  '硕士',
  '博士',
  '境外学历',
  '其他',
] as const

/** GB/T 4754-2017 门类（A-T）；大类/中类/小类后续按层级字典接入。 */
export const EMPLOYMENT_INDUSTRY_SECTORS = [
  { code: 'A', label: '农、林、牧、渔业' },
  { code: 'B', label: '采矿业' },
  { code: 'C', label: '制造业' },
  { code: 'D', label: '电力、热力、燃气及水生产和供应业' },
  { code: 'E', label: '建筑业' },
  { code: 'F', label: '批发和零售业' },
  { code: 'G', label: '交通运输、仓储和邮政业' },
  { code: 'H', label: '住宿和餐饮业' },
  { code: 'I', label: '信息传输、软件和信息技术服务业' },
  { code: 'J', label: '金融业' },
  { code: 'K', label: '房地产业' },
  { code: 'L', label: '租赁和商务服务业' },
  { code: 'M', label: '科学研究和技术服务业' },
  { code: 'N', label: '水利、环境和公共设施管理业' },
  { code: 'O', label: '居民服务、修理和其他服务业' },
  { code: 'P', label: '教育' },
  { code: 'Q', label: '卫生和社会工作' },
  { code: 'R', label: '文化、体育和娱乐业' },
  { code: 'S', label: '公共管理、社会保障和社会组织' },
  { code: 'T', label: '国际组织' },
] as const

export const EMPLOYMENT_INDUSTRY_TAXONOMY = {
  source: 'GB/T 4754-2017',
  version: '2017',
  level: 'sector',
  items: EMPLOYMENT_INDUSTRY_SECTORS,
} as const

export const DEFAULT_EMPLOYMENT_INDUSTRY = '信息传输、软件和信息技术服务业'
