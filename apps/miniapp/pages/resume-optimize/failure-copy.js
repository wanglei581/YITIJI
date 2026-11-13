const { SUPPORT_HINT } = require('../../utils/user-error')

// 失败页只有重试和返回。编辑区只在成功态出现，生成页打开的是另一份空白表，
// 打不开这次没生成出来的优化稿，所以不说「可以先手动修改」。
// AI_OPTIMIZE_INVALID_OUTPUT 也覆盖非法 JSON、禁用词和超长，没有单独的事实核查码。
const OPTIMIZE_FAIL_BY_CODE = {
  AI_PROVIDER_NOT_CONFIGURED: `AI 优化暂时用不了。${SUPPORT_HINT}`,
  AI_OPTIMIZE_INVALID_OUTPUT: 'AI 优化没有生成可用结果，请稍后重试。',
  AI_OPTIMIZE_UNAVAILABLE: 'AI 优化服务暂时不可用，请稍后重试。',
  AI_OPTIMIZE_TIMEOUT: 'AI 优化服务暂时不可用，请稍后重试。',
  AI_TASK_NOT_FOUND: '优化记录不存在或无权访问',
}

/** 请求抛错和 HTTP 200 且 status:failed 走同一张码表。未知码不把让人去找人的原话贴出来。 */
function optimizeFailureView(code, failReason) {
  if (code && Object.prototype.hasOwnProperty.call(OPTIMIZE_FAIL_BY_CODE, code)) {
    return { failMsg: OPTIMIZE_FAIL_BY_CODE[code], needReupload: false }
  }
  const reason = typeof failReason === 'string' ? failReason.trim() : ''
  const needReupload = /简历原文|清理|重新上传/.test(reason)
  const unsafe = !reason || /管理员|真实性校验|工作人员|现场人员|店员|值守人员|服务台|到店/.test(reason)
  const fallback = needReupload
    ? '请重新上传简历后再试。'
    : (reason ? '优化生成失败，请稍后重试。' : '加载失败，请返回重试。')
  return { failMsg: unsafe ? `${fallback}${SUPPORT_HINT}` : reason, needReupload }
}

module.exports = { optimizeFailureView }
