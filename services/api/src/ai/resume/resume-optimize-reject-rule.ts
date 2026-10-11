/**
 * 防编造校验把整份输出判作废时，是哪一条规则判的。只有规则名，绝不含输出内容或简历原文，
 * 可以进日志（真机实操 F-24：线上连着六次被判作废，日志里看不出是哪条规则）。
 */
export type OptimizeRejectRule =
  | 'not_json'            // 不是合法 JSON
  | 'no_resume_object'    // JSON 里没有 resume 对象
  | 'guard_term'          // 某段输出文字里有承诺类拦截词或管理员配置的禁用词
  | 'desc_too_long'       // 某条 description 超过长度上限
  | 'education_school'    // 教育经历的学校不在原文
  | 'education_major'     // 教育经历的专业不在原文
  | 'education_degree'    // 教育经历的学历不在原文
  | 'experience_company'  // 工作经历的公司不在原文
  | 'project_name'        // 项目名不在原文
  | 'certificate'         // 证书不在原文
