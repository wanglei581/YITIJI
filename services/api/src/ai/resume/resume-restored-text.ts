/** 补回时单位 / 项目名称、职务能当标题的最大字数；超过或带句读就整句放进描述。 */
export const RESTORED_TITLE_MAX = 40
export const RESTORED_ROLE_MAX = 20
export const BULLET_RE = /^[\s·•●▪■◆*\-–—]+/u

export function isTitleLike(text: string, max: number): boolean {
  return text.length > 0 && text.length <= max && !/[，。；,;!！?？\n]/u.test(text)
}
