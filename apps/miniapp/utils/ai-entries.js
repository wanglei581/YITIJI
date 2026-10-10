// AI 页的路由字面量和入口数据只写在这里。
// scripts/make-review-variant.mjs --variant no-ai 会把本文件整份换成空版本，
// --variant full 按 review-variants/stash 逐字节还原。
function href(url, query) {
  if (!url) return ''
  if (!query) return url
  return url + '?' + query
}

const aiTab = '/pages/ai/ai'
const assistantUrl = '/pages/assistant/assistant'
const resumeBuildUrl = '/pages/resume-build/resume-build'
const resumeVoiceUrl = '/pages/resume-voice/resume-voice'
const resumeUploadUrl = '/pages/resume-upload/resume-upload'
const resumeDiagnoseUrl = '/pages/resume-diagnose/resume-diagnose'
const resumeOptimizeUrl = '/pages/resume-optimize/resume-optimize'
const resumeParseUrl = '/pages/resume-parse/resume-parse'
const interviewEntryUrl = '/pages/interview-entry/interview-entry'
const interviewQaUrl = '/pages/interview-qa/interview-qa'
const interviewResultUrl = '/pages/interview-result/interview-result'
const careerPlanUrl = '/pages/career-plan/career-plan'
const selfExploreUrl = '/pages/self-explore/self-explore'
const jobFitUrl = '/pages/job-fit/job-fit'
const aiRecordsUrl = '/pages/ai-records/ai-records'
const resumesUrl = '/pages/resumes/resumes'
const dailyReportUrl = '/pages/daily-report/daily-report'

// 首页四格。原「创建材料包」指向未实现的材料包下单，改为已实现的职业规划。
const PRIMARY_SERVICES = [
  { title: '简历诊断', icon: 'file-search', tone: 'blue', url: resumeDiagnoseUrl },
  { title: '简历优化', icon: 'edit', tone: 'violet', url: resumeOptimizeUrl },
  { title: '模拟面试', icon: 'comment', tone: 'cyan', url: interviewEntryUrl },
  { title: '职业规划', icon: 'compass', tone: 'orange', url: careerPlanUrl },
]

const meEntries = [
  { id: 'resume', icon: 'file-text', title: '我的简历', sub: '本人上传与 AI 处理记录', accent: 'plum' },
  { id: 'ai', icon: 'robot', title: 'AI 服务记录', sub: '服务端实际任务记录', accent: 'cyan' },
]

const printDailyPath = {
  id: 'daily',
  icon: 'file-text',
  accent: 'wheat',
  title: '今日提醒',
  desc: '即将过期的到机码和平台通知',
  flow: '登录后查看',
}

module.exports = {
  href,
  aiTab,
  assistantUrl,
  resumeBuildUrl,
  resumeVoiceUrl,
  resumeUploadUrl,
  resumeDiagnoseUrl,
  resumeOptimizeUrl,
  resumeParseUrl,
  interviewEntryUrl,
  interviewQaUrl,
  interviewResultUrl,
  careerPlanUrl,
  selfExploreUrl,
  jobFitUrl,
  aiRecordsUrl,
  resumesUrl,
  dailyReportUrl,
  PRIMARY_SERVICES,
  meEntries,
  printDailyPath,
}
