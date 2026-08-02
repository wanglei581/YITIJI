// ============================================================
// 自我探索 · 倾向参考 —— v1 题目 seed（服务端 CJS 本地副本）
//
// 契约源:packages/shared/src/data/selfAssessment/v1.questions.json(前端 SSOT)。
//
// 任何题目变更须同时改两处：packages/shared JSON 与本文件。
// ============================================================

import type { SelfAssessmentQuestionsV1 } from './self-assessment.types'

export const SELF_ASSESSMENT_QUESTIONS_V1: SelfAssessmentQuestionsV1 = {
  version: 'v1',
  dimensions: [
    {
      key: 'interest',
      label: '兴趣偏好',
      questions: [
        {
          idx: 0,
          prompt: '在日常学习中，你更愿意花时间深入了解哪类内容？',
          choices: [
            { key: 'a', label: '解决具体的工程问题', weight: 1 },
            { key: 'b', label: '与不同岗位背景的人沟通协作', weight: 0 },
            { key: 'c', label: '梳理数据并得出结论', weight: 0 },
          ],
        },
        {
          idx: 1,
          prompt: '你更愿意花精力打磨哪种类型的产出？',
          choices: [
            { key: 'a', label: '可运行的产品或代码', weight: 1 },
            { key: 'b', label: '清晰可读的文档或方案', weight: 0 },
            { key: 'c', label: '对外发布的稿件或讲解', weight: 0 },
          ],
        },
        {
          idx: 2,
          prompt: '你更愿意花时间深入了解哪类内容？',
          choices: [
            { key: 'a', label: '一个具体技术栈的深度', weight: 1 },
            { key: 'b', label: '一个行业的全貌和趋势', weight: 0 },
            { key: 'c', label: '一个新工具从入门到能上手', weight: 0 },
          ],
        },
        {
          idx: 3,
          prompt: '在阅读资料时，你更偏向哪一类？',
          choices: [
            { key: 'a', label: '原理与机制拆解', weight: 1 },
            { key: 'b', label: '真实案例与经验复盘', weight: 0 },
            { key: 'c', label: '对外发布的稿件或讲解', weight: 0 },
          ],
        },
        {
          idx: 4,
          prompt: '如果有一周自由时间，更可能花在哪种活动上？',
          choices: [
            { key: 'a', label: '完成一个小型动手项目', weight: 1 },
            { key: 'b', label: '阅读行业研究报告和趋势', weight: 0 },
            { key: 'c', label: '与不同岗位背景的人交流', weight: 0 },
          ],
        },
      ],
    },
    {
      key: 'style',
      label: '工作风格',
      questions: [
        {
          idx: 0,
          prompt: '面对一项模糊任务，你更倾向先做什么？',
          choices: [
            { key: 'a', label: '拆解为可执行步骤', weight: 1 },
            { key: 'b', label: '先与他人对齐期望', weight: 0 },
            { key: 'c', label: '搜索参考资料与案例', weight: 0 },
          ],
        },
        {
          idx: 1,
          prompt: '在高压截止日期前，你的工作节奏倾向于？',
          choices: [
            { key: 'a', label: '提前排期、稳步推进', weight: 1 },
            { key: 'b', label: '集中冲刺、临近完成', weight: 0 },
            { key: 'c', label: '按工作量拆分、分块完成', weight: 0 },
          ],
        },
        {
          idx: 2,
          prompt: '你更喜欢哪种工作方式？',
          choices: [
            { key: 'a', label: '结构清晰、目标明确', weight: 1 },
            { key: 'b', label: '保持开放、允许调整', weight: 0 },
            { key: 'c', label: '先讨论、再行动', weight: 0 },
          ],
        },
        {
          idx: 3,
          prompt: '面对新工具或新方法，你通常会？',
          choices: [
            { key: 'a', label: '阅读文档并做小实验', weight: 1 },
            { key: 'b', label: '直接套用熟悉方案', weight: 0 },
            { key: 'c', label: '询问同事使用经验', weight: 0 },
          ],
        },
        {
          idx: 4,
          prompt: '对一个长周期任务，你更看重？',
          choices: [
            { key: 'a', label: '每个阶段都达到稳定质量', weight: 1 },
            { key: 'b', label: '最后交付的整体质量', weight: 0 },
            { key: 'c', label: '过程中的协作与反馈', weight: 0 },
          ],
        },
      ],
    },
    {
      key: 'team',
      label: '团队偏好',
      questions: [
        {
          idx: 0,
          prompt: '你更喜欢在团队中承担怎样的角色？',
          choices: [
            { key: 'a', label: '推动事情落实落地的执行者', weight: 1 },
            { key: 'b', label: '与不同岗位背景的人沟通协作', weight: 0 },
            { key: 'c', label: '梳理数据并得出结论', weight: 0 },
          ],
        },
        {
          idx: 1,
          prompt: '团队讨论出现分歧时，你倾向？',
          choices: [
            { key: 'a', label: '先收集信息再判断', weight: 1 },
            { key: 'b', label: '推动达成共识', weight: 0 },
            { key: 'c', label: '提出折中方案', weight: 0 },
          ],
        },
        {
          idx: 2,
          prompt: '你更愿意参与哪种协作？',
          choices: [
            { key: 'a', label: '分工明确、按时交付', weight: 1 },
            { key: 'b', label: '频繁同步、共同打磨', weight: 0 },
            { key: 'c', label: '独立完成、定期汇报', weight: 0 },
          ],
        },
        {
          idx: 3,
          prompt: '对于群体决策，你更倾向？',
          choices: [
            { key: 'a', label: '列清单逐项评估', weight: 1 },
            { key: 'b', label: '询问每位成员的理由', weight: 0 },
            { key: 'c', label: '直接选出最稳妥的方案', weight: 0 },
          ],
        },
        {
          idx: 4,
          prompt: '与不同背景的人合作时，你更看重？',
          choices: [
            { key: 'a', label: '目标与节奏的一致', weight: 1 },
            { key: 'b', label: '信息透明与及时反馈', weight: 0 },
            { key: 'c', label: '各自擅长的清晰分工', weight: 0 },
          ],
        },
      ],
    },
    {
      key: 'value',
      label: '价值取向',
      questions: [
        {
          idx: 0,
          prompt: '选择工作时，你更看重？',
          choices: [
            { key: 'a', label: '清晰的成长路径', weight: 1 },
            { key: 'b', label: '稳定的工作节奏', weight: 0 },
            { key: 'c', label: '团队氛围与协作方式', weight: 0 },
          ],
        },
        {
          idx: 1,
          prompt: '你更倾向在哪种组织里工作？',
          choices: [
            { key: 'a', label: '职能清晰、各司其职', weight: 1 },
            { key: 'b', label: '灵活调整、快速迭代', weight: 0 },
            { key: 'c', label: '结果导向、节奏自定', weight: 0 },
          ],
        },
        {
          idx: 2,
          prompt: '面对加班和长期投入，你更看重？',
          choices: [
            { key: 'a', label: '项目能稳定交付', weight: 1 },
            { key: 'b', label: '个人时间与节奏', weight: 0 },
            { key: 'c', label: '团队共同承担', weight: 0 },
          ],
        },
        {
          idx: 3,
          prompt: '在一家公司里，你更看重？',
          choices: [
            { key: 'a', label: '做的事情本身的价值', weight: 1 },
            { key: 'b', label: '团队与直属管理者', weight: 0 },
            { key: 'c', label: '清晰的岗位职责', weight: 0 },
          ],
        },
        {
          idx: 4,
          prompt: '对工作内容，你更看重？',
          choices: [
            { key: 'a', label: '持续积累可迁移的能力', weight: 1 },
            { key: 'b', label: '短期可见的成果', weight: 0 },
            { key: 'c', label: '与同伴共同成长', weight: 0 },
          ],
        },
      ],
    },
    {
      key: 'motivation',
      label: '求职动机',
      questions: [
        {
          idx: 0,
          prompt: '你目前求职最看重的是？',
          choices: [
            { key: 'a', label: '岗位与能力的匹配', weight: 1 },
            { key: 'b', label: '清晰的发展路径', weight: 0 },
            { key: 'c', label: '与团队成员的协作方式', weight: 0 },
          ],
        },
        {
          idx: 1,
          prompt: '在求职过程中，你更在意？',
          choices: [
            { key: 'a', label: '岗位要求的真实度', weight: 1 },
            { key: 'b', label: '面试流程的体验', weight: 0 },
            { key: 'c', label: '结果的反馈速度', weight: 0 },
          ],
        },
        {
          idx: 2,
          prompt: '面对仍在招聘中的岗位，你更倾向？',
          choices: [
            { key: 'a', label: '先看岗位要求', weight: 1 },
            { key: 'b', label: '先看公司背景', weight: 0 },
            { key: 'c', label: '先看团队信息', weight: 0 },
          ],
        },
        {
          idx: 3,
          prompt: '对与你能力匹配的岗位，你更关心？',
          choices: [
            { key: 'a', label: '具体的工作内容', weight: 1 },
            { key: 'b', label: '薪酬与岗位级别', weight: 0 },
            { key: 'c', label: '团队组成与协作方式', weight: 0 },
          ],
        },
        {
          idx: 4,
          prompt: '选择投递时，你更看重？',
          choices: [
            { key: 'a', label: '岗位与能力的匹配度', weight: 1 },
            { key: 'b', label: '招聘信息的真实性', weight: 0 },
            { key: 'c', label: '岗位的城市与工作节奏', weight: 0 },
          ],
        },
      ],
    },
  ],
}
