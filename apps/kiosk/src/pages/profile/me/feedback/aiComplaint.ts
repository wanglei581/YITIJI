// AI 内容投诉（C3）。合规总表「生成式 AI 登记与标识」一行要求设投诉举报入口；
// 小程序 feedback 页已按同一口径上线，服务端类别是 member-feedback.dto.ts 的 ai_content。
//
// 答复时限：docs/compliance/pilot-compliance-procedures.md 制度 7（2026-09-28 产品负责人拍板
// 5 个工作日，律师确认后定稿）。写在页面上就是对用户的承诺，改之前先改那份制度，并同步小程序
// apps/miniapp/pages/feedback/feedback.js 的 AI_COMPLAINT_REPLY_DAYS。
export const AI_COMPLAINT_REPLY_DAYS = 5

/** AI 页面上的投诉入口都指向这里；反馈页按 ?category= 白名单直接选中「AI 内容投诉」。 */
export const AI_CONTENT_COMPLAINT_ROUTE = '/me/feedback?category=ai_content'

export const AI_COMPLAINT_NOTE =
  `对 AI 生成的内容有异议，写清是哪个功能、大概什么时间、哪段内容有问题。我们在 ${AI_COMPLAINT_REPLY_DAYS} 个工作日内答复，答复在下方「我的反馈」里查看。`
