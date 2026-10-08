/** 稿 21 的岗位类别与专业。类别只负责导航，写进 targetJob 的是具体职位名。
 * 这两张表只存在于设计稿，shared 里没有对应常量。 */
export interface JobCategory {
  key: string
  name: string
  jobs: readonly string[]
}

export const JOB_CATEGORIES: readonly JobCategory[] = [
  { key: 'tech', name: '技术研发', jobs: ['前端开发', '后端开发', '移动端开发', '测试工程师', '运维工程师', '网络工程师', '数据分析', '算法工程师', '嵌入式/硬件', '技术支持', 'IT 实施'] },
  { key: 'product', name: '产品', jobs: ['产品经理', '产品助理', '项目经理', '需求分析', '用户研究', '数据产品', '产品运营'] },
  { key: 'ops', name: '运营', jobs: ['内容运营', '新媒体运营', '用户运营', '活动运营', '电商运营', '社群运营', '直播运营', '店铺运营'] },
  { key: 'sales', name: '销售', jobs: ['销售代表', '销售助理', '大客户销售', '电话销售', '渠道销售', '门店销售', '房产经纪', '保险顾问', '汽车销售', '销售主管'] },
  { key: 'market', name: '市场公关', jobs: ['市场专员', '品牌策划', '市场推广', '商务拓展', '公关专员', '会展策划', '广告投放', '文案策划'] },
  { key: 'hr', name: '行政人事', jobs: ['人事专员', '招聘专员', '薪酬绩效', '员工关系', '培训专员', '行政专员', '前台文员', '后勤管理', '人事助理'] },
  { key: 'fin', name: '财务会计', jobs: ['会计', '出纳', '财务助理', '成本会计', '审计专员', '税务专员', '统计员', '银行柜员', '财务主管'] },
  { key: 'cs', name: '客户服务', jobs: ['客服专员', '在线客服', '电话客服', '售后服务', '呼叫中心', '投诉处理', '客户维护', '客服主管'] },
  { key: 'design', name: '设计创意', jobs: ['平面设计', 'UI 设计', '室内设计', '装潢设计', '服装设计', '美工', '插画/原画', '工业设计', '家具设计'] },
  { key: 'mfg', name: '生产制造', jobs: ['普工/操作工', '装配工', '质检员', '生产管理', '设备维修', '工艺工程师', '电工', '焊工', '注塑/冲压', '车间主管'] },
  { key: 'logi', name: '物流仓储', jobs: ['快递员', '配送员', '仓库管理员', '理货分拣', '叉车司机', '货车司机', '物流专员', '跟单员', '单证员'] },
  { key: 'retail', name: '零售餐饮', jobs: ['店员/导购', '收银员', '店长', '储备店长', '服务员', '厨师', '后厨帮工', '面点烘焙', '咖啡调饮', '餐饮领班'] },
  { key: 'care', name: '医护照护', jobs: ['护士', '护理员', '养老照护', '育婴/月嫂', '康复理疗', '药店店员', '医助/医技', '母婴护理', '家政保洁'] },
  { key: 'build', name: '建筑工程', jobs: ['施工员', '安全员', '资料员', '造价预算', '监理员', '测量员', '水电安装', '木工/瓦工', '装修工', '项目工程师'] },
  { key: 'edu', name: '教育培训', jobs: ['学科教师', '幼儿教师', '助教', '培训讲师', '课程顾问', '教务管理', '托管老师', '教研专员'] },
  { key: 'media', name: '传媒内容', jobs: ['编辑/文案', '记者', '摄影摄像', '视频剪辑', '主播', '直播助理', '平面排版', '印刷制版', '新媒体编辑'] },
  { key: 'law', name: '法律政务', jobs: ['法务专员', '律师助理', '合规专员', '社区工作者', '网格员', '政务窗口', '公共服务岗', '档案管理', '调解员'] },
  { key: 'agri', name: '农业食品', jobs: ['种植技术员', '养殖技术员', '农机操作', '农产品销售', '食品加工', '食品质检', '屠宰分割', '园林绿化', '仓储保管'] },
  { key: 'craft', name: '服务技工', jobs: ['汽车维修', '家电维修', '手机维修', '美容美发', '美甲化妆', '保安', '保洁', '客运司机', '网约车司机', '缝纫工'] },
]

export const JOB_OTHER = 'other'
export const TARGET_JOB_MAX = 80
export const TARGET_MAJOR_MAX = 40

export const MAJOR_OPTIONS = [
  '计算机与电子', '机械与自动化', '土木与建筑', '经济与管理', '会计与金融', '语言与传媒',
  '教育学', '医药护理', '农林与食品', '艺术与设计', '法学与公共管理', '旅游与酒店',
] as const

/** 稿上的常见门类只是编辑排序，不是推荐，也不预选。 */
export const COMMON_SECTOR_LABELS = [
  '制造业', '信息传输、软件和信息技术服务业', '批发和零售业', '教育', '卫生和社会工作', '建筑业',
] as const

const LEGACY_JOB_CAT: Record<string, string> = {
  市场销售: 'sales',
  餐饮零售: 'retail',
  医护照料: 'care',
  汽修与技工: 'craft',
}

export function categoryOfJob(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const named = JOB_CATEGORIES.find((item) => item.name === trimmed)
  if (named) return named.key
  const titled = JOB_CATEGORIES.find((item) => item.jobs.includes(trimmed))
  if (titled) return titled.key
  return LEGACY_JOB_CAT[trimmed] ?? JOB_OTHER
}
