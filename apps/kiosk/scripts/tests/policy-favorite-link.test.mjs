import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const favorites = read('src/pages/profile/me/MyFavoritesPage.tsx')
const activity = read('src/pages/profile/me/activityPresentation.ts')
const home = read('src/pages/home/components/HomeTouchView.tsx')
const page = read('src/pages/renshi/RenshiPage.tsx')
const detail = read('src/pages/renshi/PolicyDetail.tsx')
const notices = read('src/pages/renshi/PolicyNotices.tsx')
const notice = read('src/pages/renshi/NoticePanel.tsx')
const channelPage = read('src/pages/official-channels/OfficialChannelsPage.tsx')
const channelHook = read('src/hooks/useOfficialChannels.ts')

test('浏览记录和打开来源都按编号打开那一条政策', () => {
  // 规格：点浏览或打开来源里的政策，必须落到 /renshi?policy=<编号>，与收藏同一条路。
  // 落到 /renshi 会丢掉编号，政策页打不开那一条。编号要编码，避免查询串被拆开。
  assert.match(activity, /case 'policy':[\s\S]*?return `\/renshi\?policy=\$\{encodeURIComponent\(targetId\)\}`/)
  assert.match(activity, /function detailRoute/)
})

test('收藏的政策打开对应那一条，不再停在待建设', () => {
  assert.match(favorites, /return `\/renshi\?policy=\$\{encodeURIComponent\(item\.targetId\)\}`/)
  assert.doesNotMatch(favorites, /return '\/renshi\?tab=policy'/)
  assert.equal(favorites.includes('对应政策页待建设'), false)
  // 证据锚点随稿换字，判据不变：我的收藏改按触屏稿后，说明写在列表下面的小字里——
  // 点一条是打开那一条政策，办理仍以官方入口为准，不是平台代办。
  assert.equal(favorites.includes('点一条打开政策'), true)
  assert.equal(favorites.includes('办理仍以官方入口为准'), true)
})

test('点名政策按编号现读，缺失与失败分别有出路', () => {
  assert.match(page, /params\.get\('policy'\)/)
  assert.match(page, /<PolicyDetail key=\{id\} id=\{id\}/)
  assert.match(detail, /getPublishedPolicy\(id\)/)
  for (const text of ['这条政策已经撤下或不在可查看范围', '这次没读到', '重新读取', '返回政策首页']) assert.ok(detail.includes(text))
  assert.doesNotMatch(page + detail, /withdrawnIds/)
})

test('政策打印走清单交接，公告扫码和自备上传仍先按条确认', () => {
  assert.match(detail, /createPolicyChecklist\(id\)/)
  assert.match(detail, /origin: 'policy_checklist'/)
  assert.match(detail, /result\.status === 'withdrawn'/)
  assert.doesNotMatch(detail, /\/print\/upload/)
  assert.match(notices, /confirm\(id\)\.then/)
  assert.match(notices, /confirm\(notice\.id\)\.then/)
  assert.match(notices, /source\.kind !== 'verified'/)
  assert.match(notice, /onClick=\{\(\) => onUpload\(notice\.id\)\}/)
})

test('官方渠道打开时重新读，点卡片前再核对，不另加定时读取', () => {
  assert.match(channelPage, /useOfficialChannels\(\{ fresh: true \}\)/)
  assert.match(channelPage, /channels\.recheck\(/)
  assert.match(channelPage, /已经撤下，不再提供二维码。/)
  assert.equal((channelHook.match(/setInterval\(/g) ?? []).length, 1)
  assert.match(channelHook, /const recheck = useCallback/)
})

test('首页查政策不再写带走材料清单', () => {
  assert.match(home, /actionId="policy-hub"[\s\S]{0,400}take="查看政策说明"/)
  assert.equal(home.includes('带走：材料清单'), false)
  assert.equal(home.includes('title="查政策"'), true)
})
