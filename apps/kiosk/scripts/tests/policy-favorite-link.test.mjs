import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const favorites = read('src/pages/profile/me/MyFavoritesPage.tsx')
const home = read('src/pages/home/components/QxHomeView.tsx')
const page = read('src/pages/renshi/RenshiPage.tsx')
const focus = read('src/pages/renshi/usePolicyFocus.ts')
const deadEnd = read('src/pages/renshi/policyFocus.tsx')
const panel = read('src/pages/renshi/PolicyPanel.tsx')
const notice = read('src/pages/renshi/NoticePanel.tsx')
const channelPage = read('src/pages/official-channels/OfficialChannelsPage.tsx')
const channelHook = read('src/hooks/useOfficialChannels.ts')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `找不到 ${start} … ${end}`)
  return source.slice(from, to)
}

test('收藏的政策打开对应那一条，不再停在待建设', () => {
  assert.match(favorites, /return `\/renshi\?policy=\$\{encodeURIComponent\(item\.targetId\)\}`/)
  assert.doesNotMatch(favorites, /return '\/renshi\?tab=policy'/)
  assert.equal(favorites.includes('对应政策页待建设'), false)
  assert.equal(favorites.includes('再打开这则政策说明'), true)
  assert.equal(favorites.includes('再打开这则说明，办理仍以官方入口为准。'), true)
})

test('点名的政策会去读那一条，找不到或失败时有出路', () => {
  assert.match(page, /searchParams\.get\('policy'\)/)
  assert.match(focus, /getPublishedPolicy\(/)
  assert.match(panel, /data-policy-id=\{item\.id\}/)
  assert.equal(deadEnd.includes('这条政策现在打不开'), true)
  assert.equal(deadEnd.includes('看看其他政策'), true)
  assert.equal(deadEnd.includes('返回我的收藏'), true)
  assert.equal(deadEnd.includes('这次没有打开这条政策'), true)
  assert.equal(deadEnd.includes('正在打开这条政策'), true)
})

test('打开来源码或上传自备材料前先按条确认，撤下的不再打开', () => {
  const uploadBody = between(page, 'async function uploadOwn', 'async function openPublishedSource')
  const sourceBody = between(page, 'async function openPublishedSource', 'const handlePolicyItemOpened')
  assert.ok(uploadBody.indexOf('guard.confirm(') >= 0)
  assert.ok(uploadBody.indexOf("navigate('/print/upload')") > uploadBody.indexOf('guard.confirm('))
  assert.ok(sourceBody.indexOf('guard.confirm(') >= 0)
  assert.ok(sourceBody.indexOf('setQrEntry(') > sourceBody.indexOf('guard.confirm('))
  assert.equal(focus.includes('这条政策已经撤下，不再提供来源入口'), true)
  assert.equal(focus.includes('这次没有确认这条还在，先不打开来源入口。'), true)
  assert.equal(focus.includes('正在确认这条还在'), true)
  assert.match(panel, /onClick=\{\(\) => onUpload\(item\.id\)\}/)
  assert.match(notice, /onClick=\{\(\) => onUpload\(notice\.id\)\}/)
  assert.equal((page.match(/onClick=\{\(\) => uploadOwn\(uploadTarget\)\}/g) ?? []).length, 2)
  assert.equal(deadEnd.includes('这条政策现在打不开'), true)
})

test('官方渠道打开时重新读，点卡片前再核对，不另加定时读取', () => {
  assert.match(channelPage, /useOfficialChannels\(\{ fresh: true \}\)/)
  assert.match(channelPage, /channels\.recheck\(/)
  assert.match(channelPage, /已经撤下，不再提供二维码。/)
  assert.equal((channelHook.match(/setInterval\(/g) ?? []).length, 1)
  assert.match(channelHook, /const recheck = useCallback/)
})

test('首页查政策不再写带走材料清单', () => {
  assert.match(home, /actionId="policy-hub"[^>]*foot="查看政策说明"/)
  assert.equal(home.includes('带走：材料清单'), false)
  assert.equal(home.includes('title="查政策"'), true)
})
