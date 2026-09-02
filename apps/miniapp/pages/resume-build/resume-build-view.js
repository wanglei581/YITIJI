// 从零建简历 · 视图层：分段定义、步骤条已填标记、结果视图映射。
//
// 与 resume-build-model.js 的分工：model 管「发给后端 / 从后端收回的形状」
// （DTO 镜像、校验、payload 组装），本文件管「屏幕上长什么样」。
// 拆开的直接原因是 CLAUDE.md §8 的单文件阈值——页面 js 光是六段表单的
// 交互加三条 API 链路就已经顶到 500 行。

const model = require('./resume-build-model')

/** 六段的标题与说明。副标题里的上限数字直接引用 DTO 镜像，不另抄一份。 */
function steps() {
  return [
    { label: '基本', title: '基本信息', sub: '姓名必填；联系方式留空的话，简历上就是空的', filled: false },
    { label: '意向', title: '求职意向', sub: '目标岗位必填，其余可以留空', filled: false },
    { label: '教育', title: '教育经历', sub: `最多 ${model.MAX_EDUCATION} 条`, filled: false },
    { label: '经历', title: '实习 / 工作经历', sub: `最多 ${model.MAX_EXPERIENCE} 条；没有可以整段跳过`, filled: false },
    { label: '项目', title: '项目与技能', sub: `项目最多 ${model.MAX_PROJECTS} 条`, filled: false },
    { label: '自述', title: '自我介绍', sub: '不写也可以，AI 不会替你编一段', filled: false },
  ]
}

/**
 * 步骤条上的「已填」标记。
 * 判据是每段的**关键字段**有没有内容，不是「这段被打开过」——后者会把
 * 翻页翻过去的空段落也标成已填，那是假进度。
 */
function markFilled(list, form) {
  const filled = [
    Boolean(String(form.basic.name || '').trim()),
    Boolean(String(form.intention.position || '').trim()),
    form.eduRows.some((r) => String(r.school || '').trim()),
    form.expRows.some((r) => String(r.company || '').trim()),
    form.projRows.some((r) => String(r.name || '').trim()) || model.parseList(form.skillsText).length > 0,
    Boolean(String(form.selfIntro || '').trim()),
  ]
  return list.map((item, i) => Object.assign({}, item, { filled: filled[i] }))
}

/**
 * 生成结果 → 结果页视图。
 *
 * 关键约束：**这里不做任何补全**。空数组原样传给 wxml，由 wxml 的 wx:else
 * 分支渲染成可见的「（未填写：xxx）」。事实字段（学校/公司/职务/时间/证书）
 * 由服务端从用户输入逐字复制，AI 只动描述类文本，所以这里也不做任何清洗或改写。
 */
function toResultView(res) {
  const r = (res && res.resume) || {}
  const basic = r.basic || {}
  const intention = r.intention || {}
  return {
    name: basic.name || '',
    position: intention.position || '',
    contact: [basic.phone, basic.email, basic.city].filter(Boolean).join(' · '),
    wanted: [intention.city, intention.jobType, intention.salary].filter(Boolean).join(' · '),
    summary: r.summary || '',
    education: (r.education || []).map((e, i) => ({
      id: `re${i}`,
      title: [e.school, e.major, e.degree].filter(Boolean).join(' · '),
      period: e.period || '',
      desc: e.description || '',
    })),
    experience: (r.experience || []).map((e, i) => ({
      id: `rx${i}`,
      title: [e.company, e.role].filter(Boolean).join(' · '),
      period: e.period || '',
      desc: e.description || '',
    })),
    projects: (r.projects || []).map((p, i) => ({
      id: `rp${i}`,
      title: [p.name, p.role].filter(Boolean).join(' · '),
      desc: p.description || '',
    })),
    skills: r.skills || [],
    certificates: r.certificates || [],
    // 服务端确定性算出的缺口（llm-resume-generate.service.ts computeMissingHints）：
    // 不是模型写的，也不是前端猜的，所以可以直接展示为「系统核对结果」
    missingHints: (res && res.missingHints) || [],
    isMockProvider: typeof (res && res.providerName) === 'string' && res.providerName.indexOf('mock') === 0,
  }
}

/**
 * 失败分类 → { msg, kind }。kind 决定失败页给哪个出口：
 *   login  去登录（会话过期，重试没用）
 *   refill 回去改填写（服务端 400，是内容不合法，重发同一份还是 400）
 *   retry  可以重试（限流、服务不可用、断网、超时）
 *
 * 超时（statusCode -1）刻意不说「生成失败」：wx.request 90 秒超时的时候，
 * 服务端很可能已经算完并且已经计费，只是结果没回到小程序。说成失败是我们
 * 不知道的事。
 */
function classifyFailure(err, fallbackMsg) {
  const code = err && err.statusCode
  const msg = (err && err.message) || ''
  if (code === 401) return { msg: msg || '登录已失效，请重新登录后再试', kind: 'login' }
  if (code === 400) return { msg: msg || '填写内容没有通过服务端校验，请回去检查', kind: 'refill' }
  if (code === -1) return { msg: msg || '网络中断或等待超时，小程序没有拿到结果', kind: 'retry' }
  return { msg: msg || fallbackMsg, kind: 'retry' }
}

module.exports = { steps, markFilled, toResultView, classifyFailure }
