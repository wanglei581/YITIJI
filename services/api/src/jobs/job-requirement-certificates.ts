/**
 * 岗位要求计数 —— 证书关键词词典。
 *
 * 单独成文件的理由：这是**数据**不是逻辑，而且注定会随真实岗位数据增补。
 * 词典每次增补必须同时递增 JOB_REQUIREMENT_CERT_DICT_VERSION，
 * 让前端能看出「这次的计数口径和上次不是一套」。
 *
 * 硬约束（与 rules 同）：不 import 框架/Prisma/env，不调任何模型。
 * 词典只决定「数哪些词」，不做任何判断、排序或推荐。
 */

/** 证书词典版本；词典没收录的证书不会出现在计数里，这一点必须随表展示给用户。 */
export const JOB_REQUIREMENT_CERT_DICT_VERSION = '2026-08-16.1'

// 关键词命中计数。词典没收录的证书不会出现，**不代表岗位没要求** —— 这一句必须随表展示。

export interface CertificateEntry { key: string; label: string; aliases: string[] }

export const CERTIFICATE_DICTIONARY: CertificateEntry[] = [
  { key: 'electrician',      label: '电工证',           aliases: ['电工证', '电工作业证', '电工操作证', '低压电工', '高压电工'] },
  { key: 'welder',           label: '焊工证',           aliases: ['焊工证', '焊工作业证', '焊接特种作业'] },
  { key: 'special_operation',label: '特种作业操作证',   aliases: ['特种作业操作证', '特种作业证', '特种设备作业'] },
  { key: 'forklift',         label: '叉车证',           aliases: ['叉车证', '叉车作业证', '叉车驾驶证'] },
  { key: 'work_at_height',   label: '高处作业证',       aliases: ['高处作业证', '高空作业证', '登高证'] },
  { key: 'crane',            label: '起重机械作业证',   aliases: ['起重机械作业', '行车证', '天车证'] },
  { key: 'pressure_vessel',  label: '压力容器作业证',   aliases: ['压力容器作业', '锅炉作业证'] },
  { key: 'safety',           label: '安全类资格证',     aliases: ['安全员证', '注册安全工程师', '安全生产资格'] },
  { key: 'fire',             label: '消防类资格证',     aliases: ['消防设施操作员', '注册消防工程师', '消防证'] },
  { key: 'constructor',      label: '建造师',           aliases: ['一级建造师', '二级建造师', '建造师'] },
  { key: 'cost_engineer',    label: '造价工程师',       aliases: ['造价工程师', '造价员'] },
  { key: 'teacher',          label: '教师资格证',       aliases: ['教师资格证', '教师资格证书'] },
  { key: 'mandarin',         label: '普通话等级证书',   aliases: ['普通话等级', '普通话证', '普通话二级', '普通话一级'] },
  { key: 'accounting',       label: '会计类证书',       aliases: ['初级会计', '中级会计', '注册会计师', '会计从业', '会计证', 'cpa'] },
  { key: 'legal',            label: '法律职业资格',     aliases: ['法律职业资格', '司法考试', '法考'] },
  { key: 'nurse',            label: '护士执业资格',     aliases: ['护士执业', '护士资格', '执业护士'] },
  { key: 'physician',        label: '医师资格',         aliases: ['执业医师', '执业助理医师', '医师资格'] },
  { key: 'pharmacist',       label: '药师资格',         aliases: ['执业药师', '药师资格'] },
  { key: 'rehab',            label: '康复治疗师',       aliases: ['康复治疗师'] },
  { key: 'health',           label: '健康证',           aliases: ['健康证'] },
  { key: 'driver',           label: '机动车驾驶证',     aliases: ['驾驶证', '驾照', '准驾'] },
  { key: 'english',          label: '英语等级证书',     aliases: ['英语四级', '英语六级', '四六级', 'cet-4', 'cet-6', 'cet4', 'cet6'] },
  { key: 'computer_rank',    label: '计算机等级证书',   aliases: ['计算机等级', '计算机二级', '计算机一级'] },
  { key: 'hr',               label: '人力资源管理师',   aliases: ['人力资源管理师'] },
  { key: 'social_worker',    label: '社会工作者职业资格', aliases: ['社会工作者职业', '社工证'] },
  { key: 'quality_audit',    label: '质量体系审核资格', aliases: ['内审员', 'iatf16949', 'iso9001', '体系审核'] },
  { key: 'pmp',              label: 'PMP 项目管理认证', aliases: ['pmp'] },
  { key: 'security_guard',   label: '保安员证',         aliases: ['保安员证', '保安证'] },
  { key: 'cook',             label: '厨师等级证',       aliases: ['厨师证', '中式烹调师', '面点师证'] },
]

/** 命中位置前 8 字内出现否定词就丢弃 —— 「无需持健康证」不算一条要求。 */
const NEGATION_WINDOW = 8
const NEGATION_PATTERN = /无需|不需要|不要求|无要求|非必须|不必/

export function matchCertificates(haystack: string): Set<string> {
  const hits = new Set<string>()
  for (const entry of CERTIFICATE_DICTIONARY) {
    for (const alias of entry.aliases) {
      const idx = haystack.indexOf(alias)
      if (idx < 0) continue
      const before = haystack.slice(Math.max(0, idx - NEGATION_WINDOW), idx)
      if (NEGATION_PATTERN.test(before)) continue
      hits.add(entry.key)
      break
    }
  }
  return hits
}
