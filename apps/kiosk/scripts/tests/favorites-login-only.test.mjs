// 收藏只存进本人账号（2026-11-05 政策最小闭环 B2）：
// 未登录点收藏去登录、不写本机；「我的收藏」取消失败放回原位并说明。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(join(root, path), 'utf8')

function load(path, resolve) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', output)(module.exports, module, resolve)
  return module.exports
}

/** 不进 React：用最小钩子把 Provider 函数跑一遍，取出交给 Context 的 value。 */
function renderProvider({ loggedIn, api }) {
  const navigations = []
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    useMemo: (factory) => factory(),
    useEffect: () => undefined,
  }
  const jsx = (type, props) => ({ type, props })
  const Provider = function Provider() {}
  const mod = load('src/favorites/FavoritesProvider.tsx', (name) => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'react-router-dom') {
      return { useNavigate: () => (to) => navigations.push(to), useLocation: () => ({ pathname: '/renshi', search: '?policy=p1' }) }
    }
    if (name === '../auth/useAuth') return { useAuth: () => ({ isLoggedIn: loggedIn, getToken: () => (loggedIn ? 'token' : null) }) }
    if (name === '../services/api/memberFavorites') return api
    if (name === './context') return { FavoritesContext: { Provider } }
    throw new Error(`Unexpected dependency ${name}`)
  })
  const element = mod.FavoritesProvider({ children: null })
  assert.equal(element.type, Provider)
  return { value: element.props.value, navigations }
}

const neverCalled = {
  addFavorite: () => { throw new Error('未登录不该写收藏') },
  removeFavorite: () => { throw new Error('未登录不该写收藏') },
  getAllMyFavorites: async () => [],
}

test('未登录点收藏：去登录页并带回原页地址，不写本机也不调接口', () => {
  const provider = read('src/favorites/FavoritesProvider.tsx')
  assert.doesNotMatch(provider, /from ['"]\.\/localFavorites['"]/, 'Provider 不再引用停放的本机收藏')
  assert.doesNotMatch(provider, /登录后可同步到账号|已收藏到本机/)
  const { value, navigations } = renderProvider({ loggedIn: false, api: neverCalled })
  assert.equal(value.source, 'local')
  value.toggle({ type: 'policy', id: 'p1', title: '标题' })
  assert.deepEqual(navigations, [`/login?from=${encodeURIComponent('/renshi?policy=p1')}`])
  assert.equal(value.isFavorite('policy', 'p1'), false)
})

test('取消收藏：成功回 true；接口失败回 false（由页面放回原位并说明）', async () => {
  const removed = []
  const ok = renderProvider({ loggedIn: true, api: { ...neverCalled, removeFavorite: async (_t, type, id) => { removed.push(`${type}:${id}`); return { removed: true } } } })
  assert.equal(await ok.value.unfavorite('policy', 'p1'), true)
  assert.deepEqual(removed, ['policy:p1'])
  const failing = renderProvider({ loggedIn: true, api: { ...neverCalled, removeFavorite: async () => { throw new Error('503') } } })
  assert.equal(await failing.value.unfavorite('policy', 'p1'), false)
  const anonymous = renderProvider({ loggedIn: false, api: neverCalled })
  assert.equal(await anonymous.value.unfavorite('policy', 'p1'), false)
})

test('「我的收藏」每条有 64px 以上的取消按钮，失败放回原位并照实说明', () => {
  const page = read('src/pages/profile/me/MyFavoritesPage.tsx')
  const css = read('src/pages/profile/me/styles/member-records-qx.css')
  assert.match(page, /data-testid=\{`member-records-fav-remove-\$\{item\.id\}`\}/)
  assert.match(page, /'取消收藏'/)
  assert.match(page, /favorites\.unfavorite\(item\.targetType, item\.targetId\)/)
  assert.match(page, /next\.splice\(Math\.max\(0, Math\.min\(index, next\.length\)\), 0, item\)/, '失败时放回原来的位置')
  assert.match(page, /role="alert"/)
  assert.match(page, /还在收藏里，请稍后再试/)
  assert.doesNotMatch(page, /取消收藏在(详情|政策)页里/, '说明不能再说只能去详情页取消')
  assert.match(css, /\.me-fav-line > \.me-fav-remove \{[^}]*min-height: 64px;/)
})

test('停放的本机收藏只剩清场残留这一个引用', () => {
  const sensitive = read('src/auth/kioskSensitiveSession.ts')
  assert.match(sensitive, /import \{\s*clearAllLocalFavorites,\s*hasLocalFavorites,\s*\} from '\.\.\/favorites\/localFavorites'/)
  assert.ok(read('src/favorites/localFavorites.ts').startsWith('// 停放（2026-11-05 政策最小闭环）'))
})
