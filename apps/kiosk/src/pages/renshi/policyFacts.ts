/**
 * 发布日期只认两个字段：优先 publishedDate，没有再用 publishConfirmedAt 的日期部分。
 * 同步时间不拿来填。两个都没有就返回 undefined，页面显示「—」。
 */
export function policyPublishedOn(input: {
  publishedDate?: string | null
  publishConfirmedAt?: string | null
}): string | undefined {
  const published = input.publishedDate?.trim()
  if (published) return published
  const confirmed = input.publishConfirmedAt?.trim()
  if (!confirmed) return undefined
  const dated = /^(\d{4}-\d{2}-\d{2})/.exec(confirmed)
  return dated?.[1] ?? confirmed
}
