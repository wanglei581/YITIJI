/** 服务台走查钩子：写成 data-hub-card / quick / goal、data-hub-title、data-hub-reason。 */
export type QxTouchHubMarker = { kind: 'card' | 'quick' | 'goal'; title: string; reason?: string | null }

/**
 * 触屏件共用的 data-* 标记。值为 undefined（或空的走查原因）的不写；
 * dataAttrs 的键不带 data- 前缀。四样都不传时返回空对象，元素上不多任何属性。
 */
export function qxTouchDataMarkers({
  actionId,
  dataAttrs,
  hub,
  testId,
}: {
  actionId?: string
  dataAttrs?: Record<string, string | undefined>
  hub?: QxTouchHubMarker
  testId?: string
}): Record<string, string> {
  const props: Record<string, string> = {}
  if (actionId) props['data-action'] = actionId
  for (const [key, value] of Object.entries(dataAttrs ?? {})) {
    if (value !== undefined) props[`data-${key}`] = value
  }
  if (hub) {
    props[`data-hub-${hub.kind}`] = ''
    props['data-hub-title'] = hub.title
    if (hub.reason) props['data-hub-reason'] = hub.reason
  }
  if (testId) props['data-testid'] = testId
  return props
}
