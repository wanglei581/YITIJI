/**
 * Terminal.orgId 与 orgBoundAt 一起变。
 * orgBoundAt 是当前 orgId 开始生效的时间；orgId 为空时 orgBoundAt 也是空。
 * 机构端「终端数据」只统计这个时间之后的打印、扫描和心跳。
 */

/** 新建终端：当时就绑了机构才记下绑定时间。 */
export function terminalOrgBindingOnCreate(orgId: string | null, now: Date): Date | null {
  return orgId === null ? null : now
}

/**
 * 给 terminal.update 的 data。
 * orgId 没变时不带 orgBoundAt，这次保存不会把绑定时间刷新成现在。
 * 解绑（next 为 null）时 orgBoundAt 写成 null。
 */
export function terminalOrgBindingWrite(
  currentOrgId: string | null,
  nextOrgId: string | null,
  now: Date,
): { orgId: string | null; orgBoundAt?: Date | null } {
  if (currentOrgId === nextOrgId) return { orgId: nextOrgId }
  return { orgId: nextOrgId, orgBoundAt: nextOrgId === null ? null : now }
}
