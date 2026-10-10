/** AI 展示映射：纯数据，日志与两后台大屏共用。 */
export const AI_OPERATION_LABELS: Readonly<Record<string, string>> = {
  parseResume:        '简历解析',
  optimizeResume:     '简历优化',
  adjustResumeLayout: '排版调整',
  generateResume:     'AI 简历生成',
  chatAssistant:      'AI 对话',
  classifyIntent:     '意图分类',
  jobRecommend:       '岗位 AI 推荐',
  jobExplain:         'AI 岗位解读',
  jobMatch:           '岗位匹配参考',
  // A-6 成本可见性补齐
  careerPlan:         '职业规划',
  fairVisitPlan:      '招聘会参观计划',
  interviewQuestion:  '模拟面试出题',
  interviewReport:    '面试报告生成',
  voiceTranscribe:    '语音转写 (ASR)',   // 按时长计费，成本 Admin 展示 N/A
  voiceSynthesize:    '语音播报 (TTS)',   // 按字符计费，成本 Admin 展示 N/A
  // 自我探索 · 倾向参考（2026-08-01）
  selfAssessment:     '自我探索 · 倾向参考',
  // 合同审查（2026-08-17）：此前完全不落 AiServiceLog，花费在统计里根本查不到
  contractReview:     '合同审查',
}

export const AI_USAGE_FEATURE_LABELS: Readonly<Record<string, string>> = {
  assistant_chat: 'AI助手对话',
  resume_diagnosis: 'AI简历诊断',
  resume_generate: 'AI简历生成',
  resume_optimize: 'AI简历优化',
  job_fit: 'AI岗位匹配参考',
  career_plan: 'AI职业规划建议',
  fair_visit_plan: 'AI招聘会拜访计划',
  self_assessment: 'AI自我探索解读',
  job_recommend: 'AI岗位推荐排序',
  job_explain: 'AI岗位解读',
  advisor_work: 'AI顾问作业面',
  print_param_prefill: '打印参数预填',
  mock_interview: 'AI模拟面试',
  digital_human: 'AI数字人引导',
  poster_generation: 'AI海报生成',
  // 下面两个不在功能位表里：advisor/assistant-summary.service.ts（对话要点小结）
  // 与计量器的 fallback（拿不到功能名时记 unknown）。
  assistant_summary: '顾问对话小结',
  unknown: '未知功能',
}

export const AI_USAGE_VENDOR_LABELS: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  hunyuan: '腾讯混元',
  unknown: '未知厂商',
}

export const AI_LOG_REASON_LABELS: Readonly<Record<string, string>> = {
  ServiceUnavailableException: 'AI 服务暂时不可用',
  AI_PROVIDER_ERROR: '模型厂商服务异常',
  AI_NOT_CONFIGURED: 'AI 服务尚未配置',
  AI_PROVIDER_NOT_CONFIGURED: 'AI 服务尚未配置',
  AI_PAUSED: 'AI 服务已暂停',
  MAINTENANCE_MODE: '设备维护中',
  AI_BUDGET_EXHAUSTED: '当日 AI 额度已用完',
  AI_BUDGET_UNAVAILABLE: 'AI 额度暂时无法读取',
  AI_LOGIN_REQUIRED: '需要先登录',
  AI_DECLARATION_REQUIRED: '需要确认 AI 使用声明',
  AI_CONTENT_BLOCKED: '内容未通过安全检查',
  AI_BUSY: 'AI 服务繁忙',
  AI_TIMEOUT: 'AI 响应超时',
}
