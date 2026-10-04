/**
 * 告警副标题。服务端正文里已经写了这台终端的编号时，不再在前面重复拼；
 * 正文没有这个编号时，仍把编号补在前面。不改写服务端原文。
 */
export function alertDetailText(terminalCode: string | null | undefined, detail: string): string {
  const code = terminalCode?.trim() ?? ''
  if (!code || detail.includes(code)) return detail
  return `${code} · ${detail}`
}
