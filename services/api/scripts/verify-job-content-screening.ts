/**
 * 岗位正文歧视性表述筛查门禁。
 *
 * 法规依据：《关于规范网络平台招聘类信息发布的通知》（人社部、中央网信办、
 * 工信部、公安部、金融监管总局，2026-01）：招聘信息不得含有民族、种族、性别、
 * 宗教信仰等歧视性内容；不得在户籍、地域、身份等方面设置限制人力资源流动的条件。
 *
 * 这道门禁盯的是**筛查本身不能变质**，两个方向都要守：
 *   - 别漏：典型歧视表述必须命中，且要能穿透全角/空格变体；
 *   - 别误伤：合规表述（「不限户籍」「男女不限」）绝不能命中 ——
 *     误判会挡掉正常岗位，而这条链路上误判的代价由求职者承担；
 *   - 别越权：**命中不得导致自动拒绝**。这是本模块与 content-trust 发布闸门
 *     的根本区别，也是最容易被后来者"顺手加强"掉的一条。
 *
 * 断言：
 *   1. 六类典型歧视 / 限制流动表述全部命中，且分类正确
 *   2. 合规表述零命中（否定前缀、"不限"系列、正常岗位描述）
 *   3. 归一化生效：全角 / 空格 / 大小写变体仍能命中
 *   4. 命中信息可指回字段与法条（field / label 非空）
 *   5. 静态：模块内不存在 throw / assert —— 只标记不拒绝
 *   6. 静态：筛查结果不落库（无 Prisma 写入、无 reviewStatus/publishStatus 赋值）
 *   7. 静态：不接模型（模块内无 llm / openai / aiProvider 调用）
 *   8. 管理端 DTO 透出 contentFlags，且 UI 文案保持「疑似 / 人工复核」口径
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-content-screening
 * 纯静态 + 纯函数，不连数据库。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  screenJob,
  screenJobText,
  normalizeForScreening,
  JOB_CONTENT_FLAG_RULES,
  type JobContentFlagCategory,
} from '../src/jobs/job-content-screening'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function main(): void {
  console.log('\n=== verify:job-content-screening ===')

  // ── 1. 典型违规表述必须命中,且分类正确 ────────────────────────────────
  const mustFlag: Array<{ text: string; category: JobContentFlagCategory; note: string }> = [
    { text: '岗位要求：限男性，能适应出差', category: 'discrimination', note: '性别' },
    { text: '本岗位只招女，形象佳', category: 'discrimination', note: '性别' },
    { text: '已婚已育优先考虑', category: 'discrimination', note: '婚育' },
    { text: '限汉族，其他条件面议', category: 'discrimination', note: '民族' },
    { text: '限本地户籍，需提供户口本', category: 'mobility_restriction', note: '户籍' },
    { text: '本地户口优先，外地勿投', category: 'mobility_restriction', note: '地域' },
  ]
  for (const c of mustFlag) {
    const hits = screenJobText(c.text, 'requirements')
    if (hits.length === 0) {
      fail(`1. 漏检（${c.note}）：「${c.text}」未命中任何规则`)
    }
    if (!hits.some((h) => h.category === c.category)) {
      fail(`1. 分类错误（${c.note}）：「${c.text}」命中 ${JSON.stringify(hits.map((h) => h.category))}，期望含 ${c.category}`)
    }
  }
  pass(`1. ${mustFlag.length} 类典型歧视 / 限制流动表述全部命中且分类正确`)

  // ── 2. 合规表述零命中（误判控制）──────────────────────────────────────
  // 这些全部是**合法**写法。任何一条命中都说明词表退化成了裸词匹配,
  // 会开始挡正常岗位 —— 比漏检更该拦住。
  const mustNotFlag = [
    '不限户籍，欢迎各地求职者',
    '不限性别，男女不限',
    '男女不限，年龄不限',
    '民族不限，宗教信仰自由',
    '负责华南地区渠道拓展，需要经常出差',
    '要求本科及以上学历，三年以上后端开发经验',
    '熟悉 React / TypeScript，有大型项目经验优先',
    '五险一金，年终奖，带薪年假',
    '',
  ]
  for (const text of mustNotFlag) {
    const hits = screenJobText(text, 'description')
    if (hits.length > 0) {
      fail(`2. 误判：合规表述「${text}」命中了 ${JSON.stringify(hits.map((h) => h.term))} —— 会挡掉正常岗位`)
    }
  }
  pass(`2. ${mustNotFlag.length} 条合规表述零命中（否定前缀 / 不限系列 / 正常岗位描述）`)

  // ── 2b. 已知误报边界:被"引用/反驳"的违规短语仍会命中 ──────────────────
  // 词表里「不招外地」本身以否定词开头,所以 NEGATION_PREFIXES 对它无效;
  // 「我们反对『不招外地』的做法」这类句子会误报。这是**已知且接受**的:
  //   - 招聘正文里出现引用/反驳歧视短语的概率极低;
  //   - 更重要的是,本模块只标记不拒绝,一次误报的代价是审核员多看一眼,
  //     不是岗位被挡。这正是选择「flag 而非 reject」的理由之一。
  // 这条断言把这个取舍钉死:一旦有人给筛查加上自动拒绝,断言 5 会红。
  const quotedHits = screenJobText('我们反对「不招外地」这种做法', 'description')
  if (quotedHits.length === 0) {
    fail('2b. 词表变了:引用式误报样本不再命中,说明「不招外地」被删了或匹配退化')
  }
  pass('2b. 已知误报边界（引用/反驳违规短语）如实记录:命中但只标记，不拒绝')

  // ── 3. 归一化:全角 / 空格 / 大小写变体仍能命中 ────────────────────────
  const variants = ['限 本 地 户 籍', '限本地户籍', '限　本地户籍']
  for (const v of variants) {
    if (screenJobText(v, 'requirements').length === 0) {
      fail(`3. 归一化失效：变体「${v}」漏检 —— 插空格 / 全角就能绕过整道筛查`)
    }
  }
  if (normalizeForScreening('限 本 地 户 籍') !== '限本地户籍') {
    fail('3. normalizeForScreening 未去除空白')
  }
  pass('3. 归一化生效：空格 / 全角空格 / NFKC 变体仍能命中')

  // ── 4. 命中信息可追溯 ─────────────────────────────────────────────────
  const jobHits = screenJob({ title: '销售经理', description: '限本地户籍', requirements: '限男性' })
  if (jobHits.length < 2) fail(`4. screenJob 未汇总多字段命中：${JSON.stringify(jobHits)}`)
  if (!jobHits.every((h) => h.field && h.label && h.term)) {
    fail(`4. 命中缺少 field / label / term，审核员无法定位：${JSON.stringify(jobHits)}`)
  }
  if (!jobHits.some((h) => h.field === 'description') || !jobHits.some((h) => h.field === 'requirements')) {
    fail('4. 命中未标出正确字段')
  }
  if (!JOB_CONTENT_FLAG_RULES.every((r) => r.label.includes('《通知》') || r.label.includes('性别歧视'))) {
    fail('4. 存在未标注法条依据的规则 —— 审核员无从判断命中的是哪一条')
  }
  pass('4. 命中带 field / term / label，可指回具体字段与法条')

  // ── 5. 只标记不拒绝（本门禁最重要的一条）────────────────────────────
  // content-trust.ts 有 assertOrgContentTrustActive 是因为「机构未核验」是确定事实;
  // 这里是语言推断,准确率不足以自动拒绝。谁想加 throw,必须先过这条断言。
  const src = readFileSync(path.join(apiRoot, 'src/jobs/job-content-screening.ts'), 'utf8')
  const throwLike = /\b(throw\s+new|assert\w*\(|Exception\()/.exec(src)
  if (throwLike) {
    fail(
      `5. job-content-screening.ts 出现 "${throwLike[0]}" —— ` +
      '确定性关键词筛查只允许标记待人工复核，不得自动拒绝 / 拦截岗位（见该文件顶部约束 1）',
    )
  }
  pass('5. 筛查模块无 throw / assert：只标记，判定权留给审核员')

  // ── 6. 不落库 ────────────────────────────────────────────────────────
  for (const bad of ['prisma.', 'reviewStatus', 'publishStatus', 'update(', 'create(']) {
    if (src.includes(bad)) {
      fail(`6. job-content-screening.ts 出现 "${bad}" —— 筛查结果必须读取时派生，落库会停在入库那天的词表版本上`)
    }
  }
  pass('6. 筛查不落库（无 Prisma 写入、不改 reviewStatus / publishStatus）')

  // ── 7. 不接模型 ──────────────────────────────────────────────────────
  // CLAUDE.md 红线:AI 是加速器不是前置条件。本模块是 AI 预审下面的确定性地板,
  // 模型不可用时必须照常工作。
  for (const bad of ['llm', 'openai', 'aiProvider', 'chatCompletion']) {
    if (src.toLowerCase().includes(bad.toLowerCase())) {
      fail(`7. job-content-screening.ts 出现 "${bad}" —— 本模块必须是纯确定性的，模型挂掉时仍要工作`)
    }
  }
  pass('7. 筛查为纯确定性实现，不依赖任何模型')

  // ── 8. 端到端接线:后端透出 + 前端口径 ────────────────────────────────
  const sharedSrc = readFileSync(path.join(apiRoot, 'src/jobs/jobs-shared.ts'), 'utf8')
  if (!sharedSrc.includes('contentFlags: screenJob(j)')) {
    fail('8. prismaJobToAdminDto 未透出 contentFlags —— 审核员在审核队列里看不到命中结果')
  }
  const adminUi = readFileSync(path.join(repoRoot, 'apps/admin/src/routes/job-sources/index.tsx'), 'utf8')
  if (!adminUi.includes('contentFlags')) {
    fail('8. Admin 岗位审核页未渲染 contentFlags —— 后端算了但没人看得到，等于静默处理')
  }
  // 文案不得写成结论。命中只是「疑似」,写成「违规岗位」会让审核员照着拒。
  if (!adminUi.includes('疑似') || !adminUi.includes('人工复核')) {
    fail('8. Admin 命中提示未保持「疑似 / 人工复核」口径 —— 不得把关键词命中呈现为已定性的违规结论')
  }
  pass('8. 后端透出 contentFlags，Admin 审核队列渲染且保持「疑似 / 请人工复核」口径')

  console.log('\nALL PASS')
}

main()
