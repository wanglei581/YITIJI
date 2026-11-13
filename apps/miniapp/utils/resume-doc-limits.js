// 优化稿编辑区的字段上限。
// 这是后端 services/api/src/ai/resume/resume-doc-limits.ts 里同名常量 RESUME_DOC_LIMITS
// 的镜像，给优化稿编辑区用：简介、教育说明、经历说明，以及技能、证书两个框。
//
// 不要和 utils/resume-build-model.js 的 LEN 混用。LEN 是「AI 生成简历」录入 DTO 的镜像，
// 那条路的 description 上限是 1000、技能单条是 40；把这里的数字写进 LEN，用户写长了会被生成接口拒绝。
const RESUME_DOC_LIMITS = {
  summary: 24000,
  description: 24000,
  skills: 60,
  skill: 200,
  certificates: 40,
  certificate: 200,
}

// 技能、证书在编辑区各是一个 textarea。进编辑区时按换行拼成一段
// （pages/resume-optimize/draft.js 的 resumeToEditor），导出时再用
// utils/resume-build-model.js 的 parseList 按换行、逗号、顿号、分号拆回成条。
//
// 框上限 = 条数上限 × 单条字数 + (条数上限 - 1)。
// 多出来的是条与条之间的换行：满编时每一条都能写到单条上限，中间还要放分隔符。
// 只按「条数 × 单条字数」算，最后一条前面的换行会把末尾挤出框外，后端其实还收得下。
// 数字从上面的镜像算，不手写结果；后端改条数或单条长度时，框上限跟着变。
function joinedListLimit(count, itemLength) {
  return count * itemLength + (count - 1)
}

const LIST_BOX_LIMITS = {
  skillsText: joinedListLimit(RESUME_DOC_LIMITS.skills, RESUME_DOC_LIMITS.skill),
  certsText: joinedListLimit(RESUME_DOC_LIMITS.certificates, RESUME_DOC_LIMITS.certificate),
}

/**
 * 导出前查技能、证书有没有超出简历文档容量。返回错误句数组，空数组表示没超。
 *
 * 不用 utils/resume-build-model.js 的 validate()、LEN、MAX_SKILLS、MAX_CERTIFICATES。
 * 那一份是「AI 生成简历」录入上限，和导出接口按 RESUME_DOC_LIMITS 校验的条数、单条字数不是同一份。
 * 入参是 buildExportPayload 已经拆好并滤掉空串的请求体，这里只看 skills、certificates 两个数组，
 * 不再对编辑区文本重拆：编辑区用顿号、逗号拼起来的一条，和请求体里已经分开的数组，条数可能不同。
 */
// 提示里的前 10 个字按字符取。slice 按 UTF-16 单元切，表情会从中间断开。
function listItemHead(text) {
  return Array.from(text).slice(0, 10).join('')
}

function exportListErrors(payload) {
  const errors = []
  const body = payload || {}
  const skills = Array.isArray(body.skills) ? body.skills : []
  const certificates = Array.isArray(body.certificates) ? body.certificates : []
  if (skills.length > RESUME_DOC_LIMITS.skills) {
    errors.push(`技能最多 ${RESUME_DOC_LIMITS.skills} 项，当前 ${skills.length} 项`)
  }
  skills.forEach((item) => {
    const text = item == null ? '' : String(item)
    if (text.length > RESUME_DOC_LIMITS.skill) {
      errors.push(`技能「${listItemHead(text)}…」超过 ${RESUME_DOC_LIMITS.skill} 字`)
    }
  })
  if (certificates.length > RESUME_DOC_LIMITS.certificates) {
    errors.push(`证书最多 ${RESUME_DOC_LIMITS.certificates} 项，当前 ${certificates.length} 项`)
  }
  certificates.forEach((item) => {
    const text = item == null ? '' : String(item)
    if (text.length > RESUME_DOC_LIMITS.certificate) {
      errors.push(`证书「${listItemHead(text)}…」超过 ${RESUME_DOC_LIMITS.certificate} 字`)
    }
  })
  return errors
}

// 有超限就弹「暂时不能导出」，关掉后再滚到技能卡，并返回 true。没有超限返回 false。
// 核对面板删事实会用 editorToResume 把编辑区文本重新拆条，条数可能比打开面板前更多。
// 调用方要把真正准备发出去的那个请求体传进来。
function stopIfListsOverLimit(payload, deps) {
  const errors = exportListErrors(payload)
  if (!errors.length) return false
  const wx = deps && deps.wx
  const getApp = deps && deps.getApp
  wx.showModal({
    title: '暂时不能导出',
    content: errors.join('；\n'),
    showCancel: false,
    success: () => scrollSkillsCardIntoView(wx, getApp),
  })
  return true
}

// 自定义顶栏会压住技能卡标题。pageScrollTo 的 offsetTop 从基础库 2.23.1 才有；
// project.config.json、文档和提审记录里没找到本项目的最低基础库，不能假定都支持。
// 先量 #edit-lists 相对视口的位置，加上已经滚过的距离，再减去状态栏和导航栏。
// 取不到高度时用 app.js 里 globalData 的初值：状态栏 20、导航栏 44。
// 查不到 #edit-lists，或 top 不是数字时不滚，避免把页面拉到顶上。
function scrollSkillsCardIntoView(wx, getApp) {
  const running = typeof getApp === 'function' ? getApp() : null
  const gd = (running && running.globalData) || {}
  const inset = (gd.statusBarHeight || 20) + (gd.navBarHeight || 44)
  const query = wx.createSelectorQuery()
  query.select('#edit-lists').boundingClientRect()
  query.selectViewport().scrollOffset()
  query.exec((res) => {
    const rect = (res && res[0]) || {}
    const view = (res && res[1]) || {}
    if (typeof rect.top !== 'number') return
    const scrolled = typeof view.scrollTop === 'number' ? view.scrollTop : 0
    const next = scrolled + rect.top - inset
    wx.pageScrollTo({ scrollTop: next > 0 ? next : 0, duration: 300 })
  })
}

module.exports = {
  RESUME_DOC_LIMITS,
  LIST_BOX_LIMITS,
  exportListErrors,
  stopIfListsOverLimit,
  scrollSkillsCardIntoView,
}
