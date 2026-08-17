// ============================================================
// 模拟面试「通用题库」（ai-down 支线素材）。
//
// 为什么有这个文件：
//   `POST /mock-interviews/:id/start` 第一件事就是调 LLM 出题（mock-interview.service.ts
//   的 `start` → `this.llm.nextQuestion`）。模型 503 时这一步抛错，setup 页只剩一行
//   「创建练习失败」—— 整条「模拟面试」能力从一台**打印终端**上消失，用户一张纸也拿不走。
//
//   口径来源：`docs/design/kiosk-ai-os-v3-2026-08/20-interview-pod.html` 的 ai-down 支线
//   （「AI 不可用 · 只能用通用题库」/「只看题目」/「题目与答案单」/「本单不含点评」）。
//
// 三条硬约束（对应红线）：
//   1. 这里的题目是**人工写死的通用题**，不是模型产物，也不是「按你的岗位定制」。
//      纸面与页面都必须写明这一点，不得让用户以为拿到的是 AI 按简历出的题。
//   2. 不含任何点评 / 评分 / 通过率 —— 点评依赖模型，模型不可用时就没有，不许编。
//   3. 合规边界不变：仅供本人练习参考，不代表招聘结果，不参与企业筛选或邀约。
//
// 题库按面试官身份分组：身份是用户在 setup 页自己选的**确定性输入**，
// 按它取题不需要任何模型判断。岗位名称只印在抬头做标识，不参与选题 ——
// 假装按岗位选题才是伪造个性化。
// ============================================================

/** 本地镜像 packages/shared 的 InterviewerType（services/api 走 commonjs，见 files/file.types.ts 顶部说明）。 */
export type PracticeSheetInterviewerType = 'hr' | 'manager' | 'tech' | 'campus' | 'final'

export interface PracticeSheetQuestion {
  /** 题干。 */
  readonly question: string
  /** 这道题一般在考什么。人工写死的通用说明，不是对用户答案的判断。 */
  readonly examines: string
}

/** 每种面试官身份都必须至少有 8 道题，覆盖最长一档（8 分钟 ≈ 8 题）。 */
const HR_QUESTIONS: readonly PracticeSheetQuestion[] = [
  { question: '请用两分钟做一个自我介绍。', examines: '表达结构、重点取舍' },
  { question: '你为什么想应聘这个岗位？', examines: '求职动机、岗位理解' },
  { question: '请讲一段你最有代表性的经历：背景、你做了什么、结果是什么。', examines: '经历真实度、结果意识' },
  { question: '你希望的薪资范围是多少？依据是什么？', examines: '自我定位、沟通分寸' },
  { question: '上一份工作（或实习）为什么结束？', examines: '稳定性、表述方式' },
  { question: '你最近一次和别人意见不一致，是怎么处理的？', examines: '协作方式、情绪管理' },
  { question: '未来一到两年你希望在工作上有什么变化？', examines: '发展预期与岗位的匹配' },
  { question: '你有什么想问我们的？', examines: '准备程度、关注点' },
]

const MANAGER_QUESTIONS: readonly PracticeSheetQuestion[] = [
  { question: '请介绍你最近负责的一件完整的事，从开始到交付。', examines: '执行链路、责任范围' },
  { question: '这件事里哪一部分是你自己做的，哪一部分是别人做的？', examines: '职责边界、表述诚实度' },
  { question: '这个岗位每天大概要做什么，你怎么理解？', examines: '岗位理解' },
  { question: '你遇到过最棘手的一次问题是什么，最后怎么收的？', examines: '问题解决、复盘能力' },
  { question: '同时有三件事都说很急，你怎么排？', examines: '优先级判断' },
  { question: '和上级意见不一致但你更有把握时，你会怎么做？', examines: '沟通方式、分寸' },
  { question: '你怎么衡量自己一个月做得好不好？', examines: '结果意识、自我要求' },
  { question: '进来之后前三个月你打算先做什么？', examines: '落地思路' },
]

const TECH_QUESTIONS: readonly PracticeSheetQuestion[] = [
  { question: '挑一个你最熟的项目，讲讲它解决的是什么问题。', examines: '技术表达、问题定义' },
  { question: '这个项目里你具体负责哪一块？', examines: '职责边界' },
  { question: '当时有哪些方案可选，你为什么选了现在这个？', examines: '技术判断、取舍依据' },
  { question: '上线后出过什么问题，你是怎么定位的？', examines: '排查能力、复盘' },
  { question: '如果现在重做一次，你会改哪里？', examines: '反思深度' },
  { question: '你平时怎么确认自己写的东西是对的？', examines: '质量意识' },
  { question: '最近在学什么？为什么学它？', examines: '学习驱动力' },
  { question: '给一个不懂技术的同事解释你做的东西，你会怎么讲？', examines: '跨角色沟通' },
]

const CAMPUS_QUESTIONS: readonly PracticeSheetQuestion[] = [
  { question: '请做一个自我介绍，重点说和这个岗位有关的部分。', examines: '表达结构、重点取舍' },
  { question: '大学期间你投入时间最多的一件事是什么？', examines: '投入方式、真实经历' },
  { question: '讲一次你和同学一起完成的任务，你承担了什么。', examines: '协作方式、职责表述' },
  { question: '你的专业和这个岗位有什么关系？没关系的部分你打算怎么补？', examines: '岗位理解、学习计划' },
  { question: '你实习（或课程项目）里做过的具体产出是什么？', examines: '结果意识' },
  { question: '遇到完全不会的任务，你一般怎么开始？', examines: '学习方法' },
  { question: '你对第一份工作最看重什么？', examines: '求职预期' },
  { question: '你有什么想问我们的？', examines: '准备程度' },
]

const FINAL_QUESTIONS: readonly PracticeSheetQuestion[] = [
  { question: '用一句话说明，为什么是你来做这个岗位。', examines: '自我定位、概括能力' },
  { question: '你过去做过的哪件事，最能说明你的工作方式？', examines: '经历与自述的一致性' },
  { question: '你做过最难的一次取舍是什么？', examines: '判断依据、价值排序' },
  { question: '别人对你评价最一致的一点是什么？你自己认吗？', examines: '自我认知' },
  { question: '你希望三年后自己在做什么？', examines: '发展预期（本机不预测能否达成）' },
  { question: '什么样的工作环境会让你待不下去？', examines: '匹配度、表述分寸' },
  { question: '如果这次没有通过，你觉得原因可能是什么？', examines: '复盘意愿' },
  { question: '你有什么想问我们的？', examines: '关注点' },
]

const BANK: Record<PracticeSheetInterviewerType, readonly PracticeSheetQuestion[]> = {
  hr: HR_QUESTIONS,
  manager: MANAGER_QUESTIONS,
  tech: TECH_QUESTIONS,
  campus: CAMPUS_QUESTIONS,
  final: FINAL_QUESTIONS,
}

/**
 * 按面试官身份取通用题。
 *
 * 取题**只**依赖用户自己选的身份与题量，没有任何模型参与，也不读简历 ——
 * 读了简历再按它选题，就得解释「是谁在按简历判断」，而那个判断只能来自模型。
 * 身份不认识时回退 HR 通用题，并如实按 HR 组印（不编一个空题库）。
 */
export function pickPracticeQuestions(
  interviewerType: string,
  questionTarget: number,
): readonly PracticeSheetQuestion[] {
  const list = BANK[interviewerType as PracticeSheetInterviewerType] ?? HR_QUESTIONS
  const count = Math.max(1, Math.min(list.length, Math.round(questionTarget) || list.length))
  return list.slice(0, count)
}

/** 面试官身份 → 中文名。与 mock-interview.service.ts 的 INTERVIEWER_LABEL 同源含义。 */
export const PRACTICE_SHEET_INTERVIEWER_LABEL: Record<string, string> = {
  hr: 'HR 初筛',
  manager: '业务主管',
  tech: '技术面试官',
  campus: '校招面试官',
  final: '终面负责人',
}

/** 打印件标题。必须一眼看出「不含点评」，因为页面上的提示不会跟着纸走。 */
export const PRACTICE_SHEET_TITLE = '面试题目与答案单（通用题库 · 本单不含点评）'

/** 文件名同样带口径，避免在「我的文档」里和 AI 练习报告混淆。 */
export const PRACTICE_SHEET_FILENAME_PREFIX = '面试题目与答案单（通用题库）'

/** 抬头下方那句必须常驻的口径。改这句要同时改 InterviewSetupPage 里的同义文案。 */
export const PRACTICE_SHEET_CAVEAT =
  '本单题目来自本机写死的通用题库，按你选择的面试官身份取题，'
  + '未经 AI 按你的岗位或简历定制；本单不含任何点评、评分或通过率 —— 点评依赖 AI，本次生成时 AI 不可用。'

export interface PracticeSheetContent {
  readonly date: string
  readonly position: string
  readonly industry: string
  readonly interviewerLabel: string
  readonly questions: readonly PracticeSheetQuestion[]
}
