// 简历优化没有任务编号时的出路，以及首页 / AI 页入口怎么带编号。
// 只复用已经能走通的页面，不新增接口。
//
// 优化接口只认解析任务（kind=parse 且诊断已完成）。生成简历、失败或还在处理的记录
// 打开优化页会直接失败，所以不放进「接着改」。没有 fileId 的解析页只会停在
// 「缺少待解析的简历文件」，上传必须从上传页进。

const CONTINUABLE_KIND = 'parse'
const CONTINUABLE_STATUS = 'completed'
const UPLOAD_URL = '/pages/resume-upload/resume-upload'
const BUILD_URL = '/pages/resume-build/resume-build'
const OPTIMIZE_URL = '/pages/resume-optimize/resume-optimize'

function optimizeUrl(taskId) {
  return `${OPTIMIZE_URL}?taskId=${encodeURIComponent(taskId)}`
}

// 只看最近 50 条。列表按创建时间从新到旧，接口一页就是这 50 条。
// 前 50 条都不可优化时，不读 nextCursor，也不再请求更早的记录。
const RECENT_LIMIT = 50

/** 只看最近 50 条里的第一份已完成诊断。更早的记录不在这次入口里找。 */
function continuable(list) {
  const items = Array.isArray(list) ? list : []
  const recent = items.slice(0, RECENT_LIMIT)
  for (let i = 0; i < recent.length; i += 1) {
    const item = recent[i]
    if (!item || item.kind !== CONTINUABLE_KIND || item.status !== CONTINUABLE_STATUS) continue
    const taskId = typeof item.taskId === 'string' ? item.taskId.trim() : ''
    if (!taskId) continue
    return { taskId, optimized: item.optimized === true }
  }
  return null
}

function waysFor(hit) {
  const ways = []
  if (hit && hit.taskId) {
    ways.push({
      id: 'continue',
      title: '接着改上次那份',
      hint: hit.optimized
        ? '打开上次的优化结果，可以继续改'
        : '用你最近一次诊断过的简历进入优化',
      url: optimizeUrl(hit.taskId),
      primary: true,
    })
  }
  ways.push({
    id: 'upload',
    title: '上传一份简历',
    hint: '上传后先做诊断，诊断完可以接着优化',
    url: UPLOAD_URL,
    primary: ways.length === 0,
  })
  ways.push({
    id: 'build',
    title: '从零写一份',
    hint: '没有现成简历时，从空白表开始填',
    url: BUILD_URL,
    primary: false,
  })
  return ways
}

function staticWays() {
  return waysFor(null)
}

function readSaved(storage) {
  if (!storage || typeof storage.get !== 'function' || !storage.KEYS) return { taskId: '', accessToken: '' }
  const saved = storage.get(storage.KEYS.RESUME_TASK) || {}
  const taskId = saved && typeof saved.taskId === 'string' ? saved.taskId.trim() : ''
  const accessToken = saved && typeof saved.accessToken === 'string' ? saved.accessToken : ''
  return { taskId, accessToken }
}

function readList(deps) {
  if (!deps.api || typeof deps.api.getMyResumes !== 'function') return Promise.resolve(null)
  // 只看最近 50 条：只请求这一页。有下一页也不翻，避免把更早的诊断带进来。
  return Promise.resolve()
    .then(() => deps.api.getMyResumes({ pageSize: RECENT_LIMIT }))
    .then((list) => continuable(list), () => null)
}

function readLocal(deps, saved) {
  if (!deps.api || typeof deps.api.getResumeRecord !== 'function') return Promise.resolve(null)
  return Promise.resolve()
    .then(() => deps.api.getResumeRecord(saved.taskId, saved.accessToken || ''))
    .then((rec) => {
      if (!rec || rec.status !== CONTINUABLE_STATUS) return null
      if (rec.kind && rec.kind !== CONTINUABLE_KIND) return null
      return { taskId: saved.taskId, optimized: false }
    }, () => null)
}

/** 登录先看本人简历列表。列表里没有，或没登录，再核对本机最近一次解析。读失败不猜编号。 */
function resolveHit(deps) {
  const saved = readSaved(deps.storage)
  const loggedIn = !!(deps.auth && typeof deps.auth.isLoggedIn === 'function' && deps.auth.isLoggedIn())
  const local = () => (saved.taskId ? readLocal(deps, saved) : Promise.resolve(null))
  if (!loggedIn) return local()
  return readList(deps).then((hit) => (hit && hit.taskId ? hit : local()))
}

function resolveEntryUrl(deps) {
  return resolveHit(deps).then(
    (hit) => (hit && hit.taskId ? optimizeUrl(hit.taskId) : OPTIMIZE_URL),
    () => OPTIMIZE_URL,
  )
}

function showEntry(page, deps) {
  const seq = (page._waysSeq = (page._waysSeq || 0) + 1)
  page.setData({ phase: 'no-task', ways: waysFor(null) })
  resolveHit(deps).then((hit) => {
    if (page._gone || page._waysSeq !== seq || page.data.phase !== 'no-task') return
    if (!hit || !hit.taskId) return
    page.setData({ ways: waysFor(hit) })
  }, () => {})
}

function openWay(page, event, wxApi) {
  const dataset = event && event.currentTarget && event.currentTarget.dataset
  const id = dataset ? dataset.id : ''
  const ways = page.data.ways || []
  let way = null
  for (let i = 0; i < ways.length; i += 1) {
    if (ways[i] && ways[i].id === id) {
      way = ways[i]
      break
    }
  }
  if (!way || !way.url || !wxApi) return
  wxApi.navigateTo({
    url: way.url,
    fail: () => wxApi.showToast({ title: '页面跳转失败', icon: 'none' }),
  })
}

function goBack(wxApi) {
  wxApi.navigateBack({ fail() { wxApi.switchTab({ url: '/pages/home/home' }) } })
}

function openEntry(page, deps) {
  if (page._optimizeOpening) return
  page._optimizeOpening = true
  page._optimizeLoadingHidden = false
  const gen = (page._optimizeGen = (page._optimizeGen || 0) + 1)
  const wxApi = deps.wx
  wxApi.showLoading({ title: '正在打开…', mask: true })
  const finish = (url) => {
    // 先看代次。切走再回来又点了一次之后，旧请求立刻返回，
    // 不得清掉新请求的打开状态，也不得藏起新的加载提示。
    if (page._optimizeGen !== gen) return
    page._optimizeOpening = false
    if (!page._optimizeLoadingHidden) {
      page._optimizeLoadingHidden = true
      wxApi.hideLoading()
    }
    wxApi.navigateTo({ url: url || OPTIMIZE_URL })
  }
  resolveEntryUrl(deps).then(finish, () => finish(OPTIMIZE_URL))
}

function cancelEntry(page, wxApi) {
  if (!page._optimizeOpening) return
  page._optimizeGen = (page._optimizeGen || 0) + 1
  page._optimizeOpening = false
  if (!page._optimizeLoadingHidden && wxApi) {
    page._optimizeLoadingHidden = true
    wxApi.hideLoading()
  }
}

module.exports = {
  CONTINUABLE_KIND,
  CONTINUABLE_STATUS,
  UPLOAD_URL,
  BUILD_URL,
  OPTIMIZE_URL,
  staticWays,
  waysFor,
  continuable,
  showEntry,
  openWay,
  goBack,
  openEntry,
  cancelEntry,
  resolveEntryUrl,
}
