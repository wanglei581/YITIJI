// 「AI 帮你生成」输入表单：哪些经历会提交。页面 buildInput 与确认页的「会跳过几条」共用这一条规则。
//
// 10/6 总指挥定：只写了公司、没写职务的经历照样提交，职务如实留空，不在前端丢掉
// （用户自己写的真实经历被丢，和「不编造」同样冲突）。服务端 ResumeGenExperienceDto.role 同批改为可空，
// 两半必须一起合：单改前端会让整次生成被 400 拒绝。
// 公司没填的经历仍不提交：没有公司，这一条在简历上立不住。

export interface ExperienceDraft {
  company: string
  role: string
  period?: string
  description: string
}

export function isSubmittableExperience(item: Pick<ExperienceDraft, 'company'>): boolean {
  return item.company.trim() !== ''
}

export function toSubmittedExperience(list: readonly ExperienceDraft[]): ExperienceDraft[] {
  return list.filter(isSubmittableExperience).map((item) => ({
    company: item.company.trim(),
    role: item.role.trim(),
    period: item.period?.trim() || undefined,
    description: item.description.trim(),
  }))
}
