// 假 OCR 的识别稿。人物、单位、学校都来自 personas.json 的虚构人设，不含「测试」。
// 张建国默认为 47 岁、青岛海湾某机械有限公司装配工（PERSONAS.md §2）。
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const personasDoc = JSON.parse(readFileSync(join(here, 'personas.json'), 'utf8'))
const byId = new Map(personasDoc.personas.map((p) => [p.id, p]))

/** 单位与学校全部虚构，结构是「青岛某某」或「示例·」。 */
const PROFILE = {
  p601: ['青岛海湾某机械有限公司', '装配工', '青岛市某机电中等专业学校', '机电技术应用', '中专', '2002.07-2025.11', '装配或仓库现场'],
  p602: ['青岛金沙滩某商贸有限公司', '理货员', '青岛市某职业中等专业学校', '商品经营', '中专', '2011.03-2025.08', '仓管或收货'],
  p603: ['青岛海湾某物流有限公司', '仓管员', '青岛市某机电中等专业学校', '物流管理', '中专', '2008.04-2026.02', '仓库管理'],
  p604: ['青岛小麦岛某物业服务有限公司', '会计', '青岛市某财经职业学校', '会计', '大专', '2010.07-2026.01', '会计或出纳'],
  p605: ['青岛栈桥某餐饮管理有限公司', '后厨帮工', '青岛市某职业中等专业学校', '烹饪', '中专', '1988.03-2024.12', '食堂兼职'],
  p606: ['青岛红岛某水产有限公司', '跟单', '青岛市某职业中等专业学校', '电子商务', '中专', '2014.06-2025.09', '跟单或客服'],
  p607: ['青岛海湾某物流有限公司', '司机', '青岛市某交通技工学校', '汽车驾驶', '中专', '2005.05-2026.03', '货运司机'],
  p608: ['青岛崂山某配送服务有限公司', '配送员', '青岛市某职业中等专业学校', '物流服务', '中专', '2016.02-2026.08', '配送或仓储'],
  p609: ['青岛崂山某配送服务有限公司', '骑手', '青岛市某职业中等专业学校', '汽车维修', '中专', '2018.03-2026.09', '外卖配送'],
  p610: ['青岛麦岛某家政服务有限公司', '保洁', '青岛市某职业中等专业学校', '家政服务', '初中', '2000.04-2026.06', '家政保洁'],
  p611: ['青岛浮山某装修工程有限公司', '油漆工', '青岛市某建设技工学校', '建筑装饰', '中专', '2019.04-2026.09', '装修油漆'],
  p612: ['青岛麦岛某家政服务有限公司', '保洁', '青岛市某职业中等专业学校', '家政服务', '初中', '2004.08-2026.07', '保洁'],
  p613: ['青岛麦岛某家政服务有限公司', '搬运工', '青岛市某职业中等专业学校', '物流服务', '高中', '2017.05-2026.08', '搬家搬运'],
  p614: ['青岛黄岛某电商有限公司', '分拣员', '青岛市某职业中等专业学校', '电子商务', '中专', '2022.07-2026.09', '仓库分拣'],
  p615: ['青岛城阳某电子有限公司', '实习生', '示例·黄岛某高校', '机械电子', '本科', '2025.07-2025.09', '机械电子'],
  p616: ['青岛海湾某机械有限公司', '实习生', '示例·黄岛某高校', '英语', '本科', '2025.07-2025.08', '外贸跟单'],
  p617: ['青岛金沙滩某商贸有限公司', '销售实习', '示例·黄岛某高校', '市场营销', '本科', '2025.06-2025.08', '销售'],
  p618: ['青岛黄岛某电商有限公司', '研究助理', '示例·黄岛某高校', '统计学', '硕士', '2024.09-2026.06', '数据分析'],
  p619: ['青岛浮山某装修工程有限公司', '学徒', '示例·黄岛某职校', '建筑工程', '专科', '2025.03-2025.07', '施工员'],
  p620: ['青岛小麦岛某物业服务有限公司', '行政实习', '示例·黄岛某高校', '视觉传达', '本科', '2025.07-2025.09', '平面设计'],
  p621: ['青岛海湾某物流有限公司', '仓管员', '示例·黄岛某高校', '物流管理', '本科', '2023.07-2025.12', '仓储规划'],
  p622: ['青岛金沙滩某商贸有限公司', '店员', '青岛市某财经职业学校', '会计', '大专', '2016.03-2021.06', '门店收银或理货'],
  p623: ['青岛小麦岛某物业服务有限公司', '安保', '青岛市某职业中等专业学校', '保安服务', '中专', '2018.09-2026.04', '秩序维护'],
  p624: ['青岛市南某社区服务站', '家属代办', '青岛市某中学', '普通高中', '高中', '1978.09-1981.07', '代子女取件'],
  p625: ['青岛麦岛某家政服务有限公司', '兼职保洁', '青岛市某职业中等专业学校', '学前教育', '中专', '2015.04-2020.11', '兼职保洁'],
  p626: ['青岛红岛某水产有限公司', '门卫', '青岛市某职业中等专业学校', '机电', '初中', '1984.03-2023.02', '看门或零活'],
  p627: ['青岛黄岛某电商有限公司', '客服', '青岛市某财经职业学校', '电子商务', '大专', '2019.07-2026.05', '线上客服'],
  p628: ['青岛城阳某电子有限公司', '实习生', '示例·城阳某职校', '电子技术', '中专', '2026.03-2026.06', '电子装配实习'],
}

export function linesForPersona(personaOrId) {
  const persona = typeof personaOrId === 'string' ? byId.get(personaOrId) : personaOrId
  if (!persona) return null
  const profile = PROFILE[persona.id]
  if (!profile) return null
  const [company, role, school, major, degree, period, intention] = profile
  const [start, end] = period.split('-')
  const emailLocal = persona.id.replace(/^p/, 'walk')
  return [
    '个人简历',
    `姓名：${persona.name}`,
    `性别：${persona.gender}    年龄：${persona.age}岁`,
    `联系电话：${persona.phone}`,
    `电子邮箱：${emailLocal}@example.com`,
    '现居城市：山东省青岛市',
    '求职意向',
    `意向岗位：${intention}`,
    '期望城市：青岛',
    '教育经历',
    `${start.slice(0, 4)}.09-${start.slice(0, 4)}.07  ${school}  ${major}  ${degree}`.replace(
      `${start.slice(0, 4)}.09-${start.slice(0, 4)}.07`,
      persona.age >= 40 ? `${Number(start.slice(0, 4)) - 6}.09-${Number(start.slice(0, 4)) - 3}.07` : `${Number(persona.birthDate.slice(0, 4)) + 18}.09-${Number(persona.birthDate.slice(0, 4)) + 21}.07`,
    ),
    '工作经历',
    `${period.replace('-', ' 至 ')}之前的经历见下一行`,
    `${start}-${end}  ${company}  ${role}`,
    `在${company}担任${role}，做一线日常工作`,
    '班组大约十来人，白班为主，忙的时候加过中班',
    '会记当天完成的件数和返修件数',
    persona.age >= 45 ? '2024 年以后有过几个月没上班' : '在校期间的实习写在这段里',
    '技能与证书',
    '会用手机微信收文件',
    role.includes('会计') ? '会用表格软件做简单台账' : '叉车和电工证件不在这份稿子里展开',
    '自我评价',
    `想在青岛找${intention}相关的工作`,
    '这份稿子是虚构走查材料，单位和学校都不对应真实机构',
  ]
}

export const DEFAULT_PERSONA_ID = 'p601'
export const DEFAULT_LINES = linesForPersona(DEFAULT_PERSONA_ID)

const MANIFEST = join(homedir(), '.cache/walk0929/dataset/files/manifest.json')
const STORAGE = process.env.FAKE_OCR_STORAGE_DIR || join(homedir(), '.cache/walk0929/files')

let catalog = null

function loadCatalog() {
  const now = Date.now()
  if (catalog && now - catalog.loadedAt < 30_000) return catalog
  const bySha = new Map()
  const byName = new Map()
  let root = null
  try {
    const doc = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    root = dirname(MANIFEST)
    for (const file of doc.files ?? []) {
      if (file.sha256 && file.ownerId) bySha.set(file.sha256, file)
      if (file.path && file.ownerId) {
        byName.set(file.path, file)
        byName.set(file.path.split('/').pop(), file)
      }
    }
  } catch {
    // 素材目录不在时仍回默认识别稿
  }
  catalog = { loadedAt: now, bySha, byName, root }
  return catalog
}

function linesOfFile(file) {
  return linesForPersona(file?.ownerId) ?? DEFAULT_LINES
}

function matchName(raw) {
  if (!raw) return null
  const name = String(raw).trim()
  const cat = loadCatalog()
  const file = cat.byName.get(name) || cat.byName.get(name.split(/[/\\]/).pop())
  if (file) return linesOfFile(file)
  if (byId.has(name)) return linesForPersona(name)
  return null
}

let recentCache = { at: 0, lines: null }

function newestStoredLines() {
  const now = Date.now()
  if (now - recentCache.at < 2000) return recentCache.lines
  recentCache = { at: now, lines: null }
  const cat = loadCatalog()
  const cutoff = now - 90_000
  const found = []
  const walk = (dir, depth) => {
    if (depth > 6 || found.length > 12) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      if (found.length > 12) return
      const p = join(dir, ent.name)
      let st
      try { st = statSync(p) } catch { continue }
      if (ent.isDirectory()) {
        if (st.mtimeMs >= cutoff - 5_000) walk(p, depth + 1)
      } else if (st.isFile() && st.mtimeMs >= cutoff && st.size > 0 && st.size < 25_000_000) {
        found.push({ p, mtime: st.mtimeMs, size: st.size })
      }
    }
  }
  walk(STORAGE, 0)
  found.sort((a, b) => b.mtime - a.mtime)
  for (const item of found.slice(0, 6)) {
    try {
      const sha = createHash('sha256').update(readFileSync(item.p)).digest('hex')
      const file = cat.bySha.get(sha)
      if (file) {
        recentCache.lines = linesOfFile(file)
        return recentCache.lines
      }
    } catch {
      // 文件正在写入时跳过
    }
  }
  return null
}

function readActive(stateDir) {
  try {
    const raw = readFileSync(join(stateDir, 'active-file.txt'), 'utf8').trim()
    return matchName(raw)
  } catch {
    return null
  }
}

function readTextFile(stateDir) {
  try {
    const lines = readFileSync(join(stateDir, 'text.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    return lines.length > 0 ? lines : null
  } catch {
    return null
  }
}

/**
 * 选择本次识别文本。
 * 上传文件名、人设编号、图片字节哈希、刚落盘的素材文件、active-file.txt 都能对上 manifest。
 * text.txt 仍是整机手动覆盖，只在上面都没对上时使用。
 */
export function selectOcrLines({ image, form, stateDir }) {
  const named = matchName(form?.get('filename') || form?.get('persona') || form?.get('personaId'))
  if (named) return { lines: named, via: 'form' }
  if (image?.length) {
    const sha = createHash('sha256').update(image).digest('hex')
    const file = loadCatalog().bySha.get(sha)
    if (file) return { lines: linesOfFile(file), via: 'sha256' }
  }
  const recent = newestStoredLines()
  if (recent) return { lines: recent, via: 'recent-file' }
  const active = readActive(stateDir)
  if (active) return { lines: active, via: 'active-file' }
  const manual = readTextFile(stateDir)
  if (manual) return { lines: manual, via: 'text.txt' }
  return { lines: DEFAULT_LINES, via: 'default' }
}
