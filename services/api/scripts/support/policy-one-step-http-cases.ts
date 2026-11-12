// 机构后台「保存并发布」与保存前预估：走真实 HTTP 的用例（2026-11-11）。
//
// verify-policy-publish-gates.ts 直接调服务方法，测不到路由、入参白名单和角色守卫这一层；
// 页面发出去的请求体多一个或少一个字段，只有走 HTTP 才看得出来。由 verify-content-pipeline-e2e.ts 调用。

import { assert, show, unwrap, type HarnessEnv, type HttpResult } from './content-pipeline-harness'
import { POLICY_PUBLISH_FIXTURE } from './policy-publish-fixture'

interface PolicyBody { id?: string; publishStatus?: string; reviewStatus?: string; contentVersion?: number; title?: string }
interface Outcome { policy?: PolicyBody; stopped?: { at?: string; code?: string; message?: string } | null }

const ok = (res: HttpResult) => res.status === 200 || res.status === 201

export async function runPolicyOneStepHttpCases(
  h: HarnessEnv,
  tokens: { partner: string; admin: string },
): Promise<void> {
  // 与页面新建时发出的请求体同形：空的可选项直接省略。
  const base = { kind: 'policy_guide', title: `一次发布的政策(E2E-${h.run})`, audience: 'graduate', ...POLICY_PUBLISH_FIXTURE }

  const check = await h.http.post<{ publishWarning: string | null; checklistReady: boolean; columns: { key: string; truncated: boolean }[] }>(
    '/partner/policies/draft-check',
    { token: tokens.partner, json: { kind: 'policy_guide', externalUrl: 'http://example.gov.cn/policy/1', whoCanApply: '条件', requiredMaterials: '材料', whereToApply: '窗口' } },
  )
  show('保存前预估（http 链接）', check)
  const checked = unwrap(check)
  assert('一步发布｜保存前预估说出 http 链接发布时会被拒、原因是没用 https',
    ok(check) && /^发布时会被拒，原因是：原文链接要以 https:\/\/ 开头/.test(checked?.publishWarning ?? ''),
    `实际 ${check.status} ${JSON.stringify(checked).slice(0, 200)}`)
  assert('一步发布｜保存前预估在字体可用时给出三栏的判定，字体不可用时如实说没法判',
    checked?.checklistReady === true ? checked.columns.length === 3 : checked?.columns.length === 0,
    JSON.stringify(checked).slice(0, 200))

  const before = await h.http.get<PolicyBody[]>('/partner/policies?pageSize=100', { token: tokens.partner })
  const countBefore = (unwrap(before) ?? []).length

  const noAck = await h.http.post('/partner/policies/release-with-save', { token: tokens.partner, json: base })
  show('没勾选责任确认', noAck)
  assert('一步发布｜没勾选责任确认被拒', noAck.status === 400, `实际 ${noAck.status}`)
  const falseAck = await h.http.post('/partner/policies/release-with-save', { token: tokens.partner, json: { ...base, responsibilityAcknowledged: false } })
  assert('一步发布｜责任确认传 false 被拒', falseAck.status === 400, `实际 ${falseAck.status}`)
  const adminTry = await h.http.post('/partner/policies/release-with-save', { token: tokens.admin, json: { ...base, responsibilityAcknowledged: true } })
  show('管理员代发', adminTry)
  assert('一步发布｜管理员不能代发', adminTry.status === 403, `实际 ${adminTry.status}`)
  const anonymous = await h.http.post('/partner/policies/release-with-save', { json: { ...base, responsibilityAcknowledged: true } })
  assert('一步发布｜没登录不能发', anonymous.status === 401, `实际 ${anonymous.status}`)
  const extraField = await h.http.post('/partner/policies/release-with-save', {
    token: tokens.partner, json: { ...base, responsibilityAcknowledged: true, sourceOrgId: 'someone-else' },
  })
  assert('一步发布｜不认识的字段整条拒收（不能借此指定别的机构）', extraField.status === 400, `实际 ${extraField.status}`)
  const after = await h.http.get<PolicyBody[]>('/partner/policies?pageSize=100', { token: tokens.partner })
  assert('一步发布｜以上被拒的请求都没有留下记录', (unwrap(after) ?? []).length === countBefore,
    `之前 ${countBefore} 条，之后 ${(unwrap(after) ?? []).length} 条`)

  const created = await h.http.post<Outcome>('/partner/policies/release-with-save', { token: tokens.partner, json: { ...base, responsibilityAcknowledged: true } })
  show('新建并发布', created)
  const createdBody = unwrap(created)
  assert('一步发布｜新建后直接是已发布',
    ok(created) && createdBody?.stopped === null && createdBody.policy?.publishStatus === 'published' && createdBody.policy?.reviewStatus === 'approved',
    `实际 ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`)
  const id = createdBody?.policy?.id ?? ''
  const visible = await h.http.get<{ id: string }[]>('/policies?pageSize=200')
  assert('一步发布｜一体机前台读得到', (unwrap(visible) ?? []).some((p) => p.id === id), `/policies 未返回 ${id}`)

  // 与页面编辑时发出的请求体同形：清空的可选项发 null。
  const edited = await h.http.post<Outcome>(`/partner/policies/${id}/release-with-save`, {
    token: tokens.partner,
    json: { ...base, title: `改过标题的政策(E2E-${h.run})`, summary: null, content: null, externalId: null, publishedDate: null, responsibilityAcknowledged: true },
  })
  show('编辑并发布', edited)
  const editedBody = unwrap(edited)
  assert('一步发布｜编辑后直接是已发布、内容版本加一',
    ok(edited) && editedBody?.stopped === null && editedBody.policy?.id === id
      && editedBody.policy?.publishStatus === 'published' && editedBody.policy?.contentVersion === 2,
    `实际 ${edited.status} ${JSON.stringify(edited.body).slice(0, 200)}`)

  // 发布被拒时内容已经保存：正常返回这条政策和原因。编号要是放在报错里，会被全局错误过滤器丢掉，
  // 页面拿不到编号，改完再点一次就会新建出第二条。
  const halted = await h.http.post<Outcome>('/partner/policies/release-with-save', {
    token: tokens.partner,
    json: { ...base, title: `停在发布的政策(E2E-${h.run})`, externalUrl: 'https://other.gov.cn/policy/1', responsibilityAcknowledged: true },
  })
  show('外站链接停在发布', halted)
  const haltedBody = unwrap(halted)
  const haltedId = haltedBody?.policy?.id ?? ''
  assert('一步发布｜链接不对时停在发布，页面收得到已保存的编号和中文原因',
    ok(halted) && haltedBody?.stopped?.at === 'publish' && haltedBody.stopped.code === 'POLICY_SOURCE_URL_NOT_VERIFIED'
      && (haltedBody.stopped.message ?? '').startsWith('内容已保存并通过审核，停在发布。')
      && haltedId.length > 0 && haltedBody.policy?.reviewStatus === 'approved' && haltedBody.policy?.publishStatus === 'draft',
    `实际 ${halted.status} ${JSON.stringify(halted.body).slice(0, 240)}`)
  const haltedVisible = await h.http.get<{ id: string }[]>('/policies?pageSize=200')
  assert('一步发布｜停在发布的那一条前台读不到', !(unwrap(haltedVisible) ?? []).some((p) => p.id === haltedId), '停在发布的政策出现在前台')

  const countBeforeRetry = (unwrap(await h.http.get<PolicyBody[]>('/partner/policies?pageSize=100', { token: tokens.partner })) ?? []).length
  const retried = await h.http.post<Outcome>(`/partner/policies/${haltedId}/release-with-save`, {
    token: tokens.partner,
    json: { ...base, title: `停在发布的政策(E2E-${h.run})`, responsibilityAcknowledged: true },
  })
  show('改好链接后重试', retried)
  const retriedBody = unwrap(retried)
  const countAfterRetry = (unwrap(await h.http.get<PolicyBody[]>('/partner/policies?pageSize=100', { token: tokens.partner })) ?? []).length
  assert('一步发布｜改好链接后重试改的是同一条，不多出第二条',
    ok(retried) && retriedBody?.stopped === null && retriedBody.policy?.id === haltedId
      && retriedBody.policy?.publishStatus === 'published' && countAfterRetry === countBeforeRetry,
    `实际 ${retried.status} 重试前 ${countBeforeRetry} 条、重试后 ${countAfterRetry} 条 ${JSON.stringify(retried.body).slice(0, 160)}`)
}
