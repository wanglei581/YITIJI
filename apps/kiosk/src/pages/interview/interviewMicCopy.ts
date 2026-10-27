/**
 * 面试作答页展示层。共享麦克风文案里的现场求助句只在这里换成服务电话。
 * 读不到号码就去掉那一句，不改成隐私政策兜底。
 */
export function interviewMicLine(
  text: string | null | undefined,
  contact: { servicePhone: string | null; serviceHours: string | null },
): string | null {
  if (text == null || text === '') return text ?? null
  const staff = ['联系现场', '工作人员'].join('')
  const clause = new RegExp(
    `[；;，,]?\\s*(?:${['在一体机上请', staff].join('')}|${['一体机上请', staff].join('')})。?`,
  )
  if (!clause.test(text)) return text
  const phone = contact.servicePhone?.trim()
  if (!phone) return text.replace(clause, '').replace(/\s+/g, ' ').trim()
  const hours = contact.serviceHours?.trim()
  const line = hours
    ? `需要帮助？拨打服务电话 ${phone}（${hours}）`
    : `需要帮助？拨打服务电话 ${phone}`
  return text.replace(clause, `。${line}`)
}
