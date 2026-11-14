import type { GeneratedResume } from '../../src/ai/interfaces/ai-provider.interface'
import { alignOriginalList } from '../../src/ai/resume/resume-optimize-list-align'
import { ensureProjectOriginalLines } from '../../src/ai/resume/resume-optimize-project-align'

/**
 * 第八段夹具：第七段相对 b3569c179 退步的六处，加上括号补充不当角色、
 * 部分漏交不带编号，以及 Kk / U2r / U5r / U8r 四处原先改不红的缺口。
 * 断言按规格写。跑法与 resume-optimize-after-match 相同，由 verify:resume-optimize 调起。
 */

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

function expectList(label: string, lines: string[], model: string[], expected: string[], coveredElsewhere?: string[]) {
  const result = alignOriginalList(lines, model, 60, coveredElsewhere ? { coveredElsewhere } : undefined)
  if (result.list.length !== expected.length || expected.some((item, index) => result.list[index] !== item)) {
    fail(`${label} 应为 ${JSON.stringify(expected)}，实际 ${JSON.stringify(result.list)}`)
  }
}

function projectAt(
  lines: string[],
  project: { name: string; role?: string; description: string },
  modules: Array<{ before: string; after: string }> = [],
) {
  const resume = { projects: [{ ...project }] } as GeneratedResume
  ensureProjectOriginalLines(resume, [{ key: 'projects', overflow: false, lines }], modules)
  return resume.projects[0]!
}

export function verifyOptimizeR1h(): void {
  console.log('\n=== R1 第八段：丢项、吞技能、编号碎片、名称角色、改写两遍、栏名当角色 ===')

  expectList('R-1 和 只交一部分', ['熟练使用Excel、Word和PPT'], ['熟练使用Excel', 'Word'], ['熟练使用Excel', 'Word和PPT'])
  expectList(
    'R-1 以及 模型交齐也不丢',
    ['熟悉Word、Excel以及PPT', 'SQL'],
    ['熟悉Word', 'Excel', 'PPT', 'SQL'],
    ['熟悉Word', 'Excel', 'PPT', 'SQL'],
  )
  expectList('R-1 与', ['熟悉React与Vue'], ['熟悉React'], ['熟悉React与Vue'])
  expectList(
    'R-1 证书和',
    ['英语四级、计算机二级和三级'],
    ['英语四级', '计算机二级'],
    ['英语四级', '计算机二级和三级'],
  )
  pass('含和、以及、与的一段，配不齐就整段补回，配齐也不丢模型交过的小项')

  expectList('R-2 Photoshop', ['Photoshop', 'Illustrator'], ['Photoshop', 'Illustrator'], ['Photoshop', 'Illustrator'], ['Adobe Photoshop 认证'])
  for (const [skill, cert] of [
    ['MS Office', '全国计算机等级考试二级 MS Office'],
    ['Python', '计算机二级 Python'],
    ['Java', 'Oracle Java 认证'],
    ['Excel', 'Excel 高级应用证书'],
    ['AutoCAD', 'AutoCAD 工程师认证'],
    ['Oracle', 'Oracle OCP'],
    ['Linux', 'Red Hat Linux 认证'],
  ] as const) {
    expectList(`R-2 ${skill}`, [skill, 'SQL'], [skill, 'SQL'], [skill, 'SQL'], [cert])
  }
  pass('证书按空格拆出的词不再盖住同名技能')

  expectList(
    'R-3 分号编号',
    ['1. 初级会计职称; 2. 全国计算机等级考试二级'],
    ['初级会计职称', '全国计算机等级考试二级'],
    ['初级会计职称', '全国计算机等级考试二级'],
  )
  expectList(
    'R-3 斜杠编号',
    ['1. 初级会计职称 / 2. 全国计算机等级考试二级'],
    ['初级会计职称', '全国计算机等级考试二级'],
    ['初级会计职称', '全国计算机等级考试二级'],
  )
  pass('证书按条拆开，不留「2.」半截')

  const r4 = projectAt(
    ['2023.01 - 2023.06 CRM 客户管理系统 负责人', '负责业务架构设计'],
    { name: 'CRM', role: '', description: '负责业务架构设计' },
  )
  if (r4.name !== 'CRM 客户管理系统' || r4.role !== '负责人') fail(`R-4 名称和角色没分开：${JSON.stringify(r4)}`)
  const rewrite = '主导订单与支付核心模块研发'
  const missed = '负责系统日常监控与维护'
  const r5 = projectAt(
    ['2023.05 - 2023.11 智慧电商平台 后端开发', '负责订单模块核心开发', '负责支付模块核心开发', missed],
    { name: '智慧电商平台', role: '后端开发', description: rewrite },
    [{ before: '负责订单模块核心开发\n负责支付模块核心开发', after: rewrite }],
  )
  const r5lines = (r5.description ?? '').split('\n')
  if (r5lines.filter((line) => line === rewrite).length !== 1 || !r5lines.includes(missed)) {
    fail(`R-5 改写印了两遍或漏交句没回来：${JSON.stringify(r5lines)}`)
  }
  const r6a = projectAt(
    ['项目名称：智慧园区管理系统 | 时间：2023.05-2023.11 | 角色：后端开发', '负责设备接入模块开发'],
    { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' },
  )
  if (r6a.role !== '后端开发' || r6a.name !== '智慧园区管理系统') fail(`R-6 栏名被当成角色：${JSON.stringify(r6a)}`)
  const r6b = projectAt(
    ['智慧园区管理系统 | 2023.05 - 2023.11（实习）', '负责设备接入模块开发'],
    { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' },
  )
  if ((r6b.role ?? '') !== '' || r6b.name !== '智慧园区管理系统') fail(`R-6 实习括号被当成角色：${JSON.stringify(r6b)}`)
  pass('短英文名仍拆出末尾角色；跨行改写只留一遍；竖线栏名和实习括号不当角色')

  for (const [label, title, name, mark] of [
    ['毕业设计', '2022.09 - 2023.05 校园二手交易平台（毕业设计）', '校园二手交易平台', '毕业设计'],
    ['课程设计', '2021.03 - 2021.06 图书管理系统（课程设计）', '图书管理系统', '课程设计'],
    ['V2.0', '2023.03 - 2023.09 门店巡检小程序（V2.0）', '门店巡检小程序', 'V2.0'],
    ['PC端', '2023.01 - 2023.06 库存查询工具（PC端）', '库存查询工具', 'PC端'],
    ['一期', '2023.03 - 2023.09 智慧零售商城（一期）', '智慧零售商城', '一期'],
  ] as const) {
    const item = projectAt(
      [title, '· 负责商品发布与订单模块开发'],
      { name, role: '', description: '负责商品发布与订单模块开发' },
    )
    if ((item.role ?? '') !== '' || !item.name.includes(mark)) fail(`${label} 括号补充被当成角色：${JSON.stringify(item)}`)
  }
  pass('括号补充留在名称里，不当角色')

  expectList('编号部分漏交', ['1. A，2. B'], ['A'], ['A', 'B'])
  expectList('编号右括号', ['1）Excel，2）Word'], ['Excel'], ['Excel', 'Word'])
  expectList('编号半角右括号', ['1) Excel，2) Word'], ['Excel'], ['Excel', 'Word'])
  expectList('编号整行补回', ['1. A，2. B'], [], ['A，2. B'])
  pass('部分漏交的补回不带上一项的编号；整行补回仍是原稿那一行')

  const sentence = '核心接口查询响应耗时降低50%'
  const rewritten = '核心接口查询响应耗时降低了50%'
  const kk = projectAt(
    ['2023.05 - 2023.11 报表分析平台 后端开发', sentence],
    { name: '报表分析平台', role: '后端开发', description: `甲乙丙丁戊己庚辛壬癸巡检归档。${rewritten}` },
  )
  if (!kk.description?.includes(rewritten) || kk.description.includes(sentence)) {
    fail(`Kk 按句比对没配上或原句回来：${kk.description}`)
  }
  pass('整行一字容差配不上时，按句比对仍认改写')

  expectList('U2r 标题同行漏一项', ['技能：Excel、Word、PPT'], ['Word', 'PPT'], ['Excel', 'Word', 'PPT'])
  pass('同行「技能：」去掉之后，漏交的那项不带栏名')

  expectList(
    'U5r 多槽丢二编二',
    ['熟练使用Excel数据透视表、Word邮件合并功能'],
    ['Excel', 'Word'],
    ['熟练使用Excel数据透视表、Word邮件合并功能'],
  )
  pass('多槽行里，短名套进长技能也不当成改写，原稿整行留下')

  const u8 = projectAt(
    ['2023.05 - 2023.11 智慧园区管理系统 后端开发', '负责设备接入模块开发'],
    { name: '智慧园区管理系统', role: '后端开发工程师', description: '负责设备接入模块开发' },
  )
  if (u8.role !== '后端开发工程师' || u8.name !== '智慧园区管理系统') {
    fail(`U8r 模型角色被标题角色盖住：${JSON.stringify(u8)}`)
  }
  pass('模型角色和标题角色不一样时，留下模型写的角色')
}

if (process.argv[1]?.endsWith('resume-optimize-after-match-r1h.ts')) {
  try {
    verifyOptimizeR1h()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
