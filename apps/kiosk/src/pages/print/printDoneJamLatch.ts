/**
 * 失败页记住「这一单已经确认过卡纸」。
 * 打印机状态是实时读数：读到过一次确认卡纸之后，即使稍后变成就绪，这一单仍按确认卡纸显示。
 * 换一单才忘掉。离开页面时调用方丢掉这份记忆（组件卸载，ref 一起没了）。
 */
export function rememberConfirmedJam(
  rememberedTaskId: string | null,
  taskId: string | null,
  seenConfirmedJam: boolean,
): string | null {
  const stillThisOrder = rememberedTaskId !== null && rememberedTaskId === taskId ? rememberedTaskId : null
  if (seenConfirmedJam && taskId) return taskId
  return stillThisOrder
}
