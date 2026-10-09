import type { ReactNode } from 'react'

/** 稿把标题后半句做成青绿强调。逗号前是主语，逗号后进 em。 */
export function emphasizeTitle(title: string): ReactNode {
  const cut = title.indexOf('，')
  if (cut < 0) return title
  return <>{title.slice(0, cut + 1)}<em>{title.slice(cut + 1)}</em></>
}
