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

module.exports = {
  RESUME_DOC_LIMITS,
  LIST_BOX_LIMITS,
}
