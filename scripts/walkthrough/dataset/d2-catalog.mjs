// 数据集 v2 · D2 四个网点。机构名与 PERSONAS.md §1 一致。
// 机构 A 已绑定 WALK-001，规格里 WALK-001 是服务大厅，所以 A 改名为市南公共就业服务中心。
// 机构 B 是高校就业中心，改名为黄岛那一家。零工之家、社区服务站新建。

export const ORGS = [
  {
    key: 'shinan',
    name: '示例·市南区公共就业服务中心',
    previousName: '测试·青岛市崂山区零工之家',
    orgIdHint: 'org_6349b0d68f814658a2fa',
    outlet: '服务大厅',
    typeLabel: '公共就业服务机构',
    domain: 'shinan.example.com',
    username: 'walk_v2_shinan',
    accountName: '陈屿',
    phone: '13800000021',
    sparePhones: ['13800000041'],
    contact: '周宁',
    contactPhone: '13800000031',
    terminalCode: 'WALK-001',
  },
  {
    key: 'laoshan',
    name: '示例·崂山区零工之家',
    previousName: null,
    outlet: '零工之家',
    typeLabel: '公共就业服务机构',
    domain: 'laoshan.example.com',
    username: 'walk_v2_laoshan',
    accountName: '郑晓',
    phone: '13800000022',
    sparePhones: ['13800000042'],
    contact: '郑晓',
    contactPhone: '13800000032',
    terminalCode: 'WALK-002',
  },
  {
    key: 'huangdao',
    name: '示例·某高校就业指导中心（黄岛）',
    previousName: '测试·青岛理工大学就业指导中心（走查）',
    outlet: '高校就业中心',
    typeLabel: '高校就业中心',
    domain: 'huangdao.example.com',
    username: 'walk_v2_huangdao',
    accountName: '韩雪松',
    phone: '13800000023',
    sparePhones: ['13800000043'],
    contact: '韩雪松',
    contactPhone: '13800000033',
    terminalCode: 'WALK-003',
  },
  {
    key: 'chengyang',
    name: '示例·城阳区某社区服务站',
    previousName: null,
    outlet: '社区服务站',
    typeLabel: '公共就业服务机构',
    domain: 'chengyang.example.com',
    username: 'walk_v2_chengyang',
    accountName: '孙雅琴',
    phone: '13800000024',
    sparePhones: ['13800000044'],
    contact: '孙雅琴',
    contactPhone: '13800000034',
    terminalCode: 'WALK-004',
  },
]

export const TERMINALS = [
  {
    code: 'WALK-001',
    orgKey: 'shinan',
    name: '市南公共就业服务大厅 1 号机',
    location: '青岛市市南区示例公共就业服务大厅一楼',
    existing: true,
  },
  {
    code: 'WALK-002',
    orgKey: 'laoshan',
    name: '崂山零工之家 1 号机',
    location: '青岛市崂山区示例零工之家一楼咨询台旁',
    port: 4352,
    origin: 'http://127.0.0.1:4392',
  },
  {
    code: 'WALK-003',
    orgKey: 'huangdao',
    name: '黄岛高校就业中心 1 号机',
    location: '青岛市黄岛区示例高校就业指导中心一楼大厅',
    port: 4353,
    origin: 'http://127.0.0.1:4393',
  },
  {
    code: 'WALK-004',
    orgKey: 'chengyang',
    name: '城阳社区服务站 1 号机',
    location: '青岛市城阳区示例社区服务站二楼',
    port: 4354,
    origin: 'http://127.0.0.1:4394',
  },
]

export function orgByKey(key) {
  const org = ORGS.find((item) => item.key === key)
  if (!org) throw new Error(`未知机构 ${key}`)
  return org
}

export function orgKeyFromName(name) {
  const text = String(name ?? '').replace(/\s+/g, '')
  const exact = ORGS.find((org) => text.includes(org.name) || org.name.includes(text))
  if (exact) return exact.key
  if (/市南|服务大厅/.test(text)) return 'shinan'
  if (/崂山|零工/.test(text)) return 'laoshan'
  if (/黄岛|高校|就业指导|理工大学/.test(text)) return 'huangdao'
  if (/城阳|社区/.test(text)) return 'chengyang'
  return null
}
