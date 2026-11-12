// 优化稿编辑区的字段上限。
// 这是后端 services/api/src/ai/resume/resume-doc-limits.ts 里同名常量 RESUME_DOC_LIMITS
// 的镜像，只给优化稿编辑区（简介、教育说明、经历说明）用。
//
// 不要和 utils/resume-build-model.js 的 LEN 混用。LEN 是「AI 生成简历」录入 DTO 的镜像，
// 那条路的 description 上限是 1000；把这里的数字写进 LEN，用户写长了会被生成接口拒绝。
const RESUME_DOC_LIMITS = {
  summary: 24000,
  description: 24000,
}

module.exports = {
  RESUME_DOC_LIMITS,
}
