import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import { FX, type SignStampStateId } from './constants'
import type { ComposeResult, LiveSnapshot } from './signStampModel'

export interface StatusCopy {
  kind: 'error' | 'warn' | 'lock' | 'info'
  title: string
  body: string
  chips: { text: string; tone?: 'ok' | 'warn' }[]
}

export function statusCopy(state: SignStampStateId, live: LiveSnapshot): StatusCopy {
  const place = `第 ${live.page} 页 · ${labelPos(live.position)} · ${labelSize(live.size)}`
  const copies: Partial<Record<SignStampStateId, StatusCopy>> = {
    'auth-unknown': {
      kind: 'lock',
      title: '还没确认你是谁',
      body: '签名和印章是高敏材料，在确认身份之前，这一页不提供上传、不显示任何文件，也不合成。',
      chips: [
        { text: '这一页不显示任何文件' },
        { text: '不生成、不保存、不上传' },
        { text: '签名图不跨会话保留' },
      ],
    },
    'login-required': {
      kind: 'lock',
      title: '先登录才能做签名盖章',
      body: '签名 / 印章图片属于高敏个人材料，只允许本人在登录后上传与合成。未登录不提供这项能力。',
      chips: [
        { text: '这一页不显示任何文件' },
        { text: '不生成、不保存、不上传' },
        { text: '普通打印扫描不受影响', tone: 'ok' },
      ],
    },
    'login-expired': {
      kind: 'warn',
      title: '登录已过期',
      body: '为保护高敏材料，登录过期时已上传的签名 / 印章图片会被丢弃，需要重新登录后重新上传。原文档还在你的账号里。',
      chips: [
        { text: '签名图不做跨会话保留' },
        { text: '不会替你自动重传' },
        { text: '原文档仍在账号里', tone: 'ok' },
      ],
    },
    'context-missing': {
      kind: 'warn',
      title: '没有可用的办理上下文',
      body: '没有拿到这次办理的来路，无法判断该回到哪里，也无法确认要处理哪一份材料。请从打印扫描重新进入。',
      chips: [{ text: '不猜上一步是什么' }, { text: '不放示例文件' }],
    },
    'terminal-missing': {
      kind: 'error',
      title: '这台机器还没登记终端编号',
      body: '签名盖章要按终端校验能力开关。读不到终端编号就无法确认这台机器是否被允许使用，因此不放行。',
      chips: [{ text: '不假设读不到就是可用' }, { text: '请联系现场工作人员' }],
    },
    'capability-loading': {
      kind: 'info',
      title: '正在读取这台机器的能力开关',
      body: '还没拿到「签名盖章」在这台机器上是否开放的答复。拿到之前不提供上传，也不显示任何文件。',
      chips: [{ text: '读取中不等于可用' }, { text: '这里不画进度条' }],
    },
    'capability-disabled': {
      kind: 'lock',
      title: '这台机器没有开放签名盖章',
      body: '管理员没有为这台机器开放「签名盖章」。未登记一律按不允许处理，不做静默降级。',
      chips: [{ text: '文档打印扫描不受影响', tone: 'ok' }, { text: '需要开放请联系工作人员' }],
    },
    'capability-maintenance': {
      kind: 'warn',
      title: '签名盖章正在维护',
      body: '这台机器的签名盖章被管理员置为维护状态，暂时不受理新的合成。已生成的文件不受影响。',
      chips: [{ text: '维护是管理员登记的真实状态' }, { text: '恢复时间请问现场工作人员' }],
    },
    'capability-error': {
      kind: 'error',
      title: '能力开关读取失败',
      body: '没能读到这台机器的能力开关。读不到就不放行——不说可用，也不说不可用。',
      chips: [{ text: '不把一次读取失败当成已关闭' }, { text: '可重试读取' }],
    },
    'return-source-unknown': {
      kind: 'warn',
      title: '认不出你是从哪里进来的',
      body: '来路参数不在允许的内部白名单里，返回已安全回落到「打印扫描」。原始来路值既不接受，也不回显。',
      chips: [{ text: '外部地址一律不作为返回落点' }, { text: '不回显原始来路' }],
    },
    'pick-document': {
      kind: 'info',
      title: '先选一份要盖章的 PDF',
      body: '把签名或印章图片叠到 PDF 的指定位置，生成一份新的 PDF。原文件不会被改写。',
      chips: [
        { text: '原 PDF ≤ 15MB · 1–30 页' },
        { text: '产物是新文件', tone: 'ok' },
        { text: '原文件不被改写', tone: 'ok' },
      ],
    },
    'document-local-uploading': {
      kind: 'info',
      title: '正在把这份 PDF 传进本机',
      body: '单次上传，没有可用的进度百分比，所以这里只说在传。传完会立刻读一次页数。',
      chips: [{ text: '单次上传' }, { text: '没有进度回传' }, { text: '失败会原样说明', tone: 'ok' }],
    },
    'document-phone-entry': {
      kind: 'info',
      title: '用手机把 PDF 传进来',
      body: '手机扫屏幕上的码，选一份 PDF 上传。确认之后才会进入下一步，这一页不会替你确认。',
      chips: [{ text: '手机扫屏幕码' }, { text: '需你在手机上确认', tone: 'warn' }, { text: '不使用扫码枪' }],
    },
    'document-inspecting': {
      kind: 'info',
      title: '正在读这份 PDF 的页数',
      body: '服务端打开文档，读出一共几页，好让你选放在第几页。加密、损坏、含数字签名域的会在这一步被拒绝。',
      chips: [{ text: '读取页数' }, { text: '没有进度回传' }, { text: '原文件不被改写', tone: 'ok' }],
    },
    'document-ready': {
      kind: 'info',
      title: live.pages ? `这份 PDF 读好了：共 ${live.pages} 页` : '这份 PDF 读好了',
      body: live.pages
        ? `读到 ${live.pages} 页；没加密、没损坏、没有数字签名域。接下来传这次要用的签名图。`
        : '页数已读到。接下来传这次要用的签名图。',
      chips: [
        { text: live.doc ? `${live.doc.name} · ${live.doc.size}` : FX.doc.name },
        { text: live.pages ? `${live.pages} 页 · 在 1–30 内` : '页数已确认', tone: 'ok' },
        { text: '原文件不被改写', tone: 'ok' },
      ],
    },
    'document-format-rejected': {
      kind: 'warn',
      title: '这份不是 PDF',
      body: '签名盖章只收 PDF。刚才那份没有进入流程；图片要盖章，先用「格式转换」拼成 PDF。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-too-large': {
      kind: 'warn',
      title: '这份 PDF 太大',
      body: '原文档上限 15 MB，服务端不接收，没有进入流程。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-encrypted': {
      kind: 'warn',
      title: '这份 PDF 加了密',
      body: '服务端不解密任何文档，加密文档一律拒绝。请换一份未加密的 PDF 再来。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-corrupt': {
      kind: 'warn',
      title: '这份 PDF 读不开',
      body: '文件结构损坏、已加密或不是有效 PDF，服务端解析不了，没有进入流程。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-digital-signature': {
      kind: 'warn',
      title: '这份 PDF 已含数字签名域',
      body: '在上面叠图片会让原有数字签名失效，本功能不处理这类文件。请找原签发方处理。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-too-many-pages': {
      kind: 'warn',
      title: '这份 PDF 页数超出',
      body: '只支持 1–30 页，没有进入流程。请先拆分再来。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-source-expired': {
      kind: 'warn',
      title: '这份文件的访问凭证过期了',
      body: '文件访问凭证有时效，过期后服务端不再受理。重新选一次就行，不用重新做材料。',
      chips: [{ text: '重新选择即可', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-source-forbidden': {
      kind: 'warn',
      title: '这份文件不在你名下',
      body: '服务端只接受本人名下且未过期的文件。别人的文件、或已清理的文件，一律按不存在处理。',
      chips: [{ text: '归属校验未通过' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'pick-stamp': {
      kind: 'info',
      title: '传一张这次要用的签名 / 印章图',
      body: '只能用这次新传的图：按高敏材料保留约 1 小时，不进我的文档。',
      chips: [
        { text: 'JPG / PNG ≤ 10MB' },
        { text: '≤ 2500 万像素' },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
      ],
    },
    'stamp-local-uploading': {
      kind: 'info',
      title: '正在传这张签名 / 印章图',
      body: '这张图按高敏材料处理：短期保留（约 1 小时），不进「我的文档」，会话结束即不可再用。',
      chips: [
        { text: '单次上传' },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
        { text: '不进我的文档', tone: 'warn' },
      ],
    },
    'stamp-phone-entry': {
      kind: 'info',
      title: '用手机传签名 / 印章图',
      body: '手机拍一张签名，或选一张印章图片。确认之后才会进入下一步。这张图同样只在本次会话短期保留。',
      chips: [
        { text: '手机扫屏幕码' },
        { text: '需你在手机上确认', tone: 'warn' },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
      ],
    },
    'stamp-ready': {
      kind: 'info',
      title: '签名图收到了',
      body: live.stamp
        ? `${live.stamp.name} 已经在本次会话里。接下来选第几页、哪个位置、多大，左边同步画出来。`
        : '签名图已经在本次会话里。接下来选第几页、哪个位置、多大。',
      chips: [
        { text: live.stamp ? live.stamp.size : FX.stamp.size },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
        { text: '不进我的文档', tone: 'warn' },
      ],
    },
    'stamp-format-rejected': {
      kind: 'warn',
      title: '这张图不能用',
      body: '签名 / 印章图片只支持 JPG / PNG。刚才那份没有进入流程，已选的文档不受影响。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-too-large': {
      kind: 'warn',
      title: '这张图太大',
      body: '签名 / 印章图片上限 10 MB。请压缩后重传。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-pixels-too-large': {
      kind: 'warn',
      title: '这张图像素太多',
      body: '像素总量上限 2500 万。请缩小分辨率后重传。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-corrupt': {
      kind: 'warn',
      title: '这张图读不出来',
      body: '文件内容与声明的格式不符，或图片已损坏，服务端解析不了。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-encoding-unsupported': {
      kind: 'warn',
      title: '这张图的编码暂不支持',
      body: '服务端嵌入这张图时失败（常见于 CMYK JPEG）。请另存为普通 PNG / JPG 后重试。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-source-expired': {
      kind: 'warn',
      title: '签名图的访问凭证过期了',
      body: '签名 / 印章图片只在本次会话短期保留（约 1 小时），过期后必须重新上传，不能从历史复用。',
      chips: [{ text: '不能从历史复用', tone: 'warn' }, { text: '已选文档不受影响', tone: 'ok' }],
    },
    'placement-invalid-page': {
      kind: 'warn',
      title: '页码超出这份文档',
      body: live.placeErr ?? '页码必须在这份文档的页数范围内，超出的请求服务端会直接拒绝。',
      chips: [
        { text: live.pages ? `共 ${live.pages} 页` : '页码越界' },
        { text: '服务端会直接拒绝', tone: 'warn' },
      ],
    },
    'authorization-required': {
      kind: 'warn',
      title: live.authReset ? '换了签名图，授权要重新确认' : '生成之前先确认授权',
      body: live.authReset
        ? '上一次的授权只对上一张图有效。换图之后授权已经复位，得对这张新图再确认一次才能生成。'
        : '勾选「我拥有这张图的使用授权」之后才能生成。没勾就不给生成，原因常驻在按钮上方。',
      chips: [
        { text: '需勾选授权', tone: 'warn' },
        { text: '换图后需重新确认', tone: 'warn' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    composing: {
      kind: 'info',
      title: '正在提交这一次合成',
      body: `按${place}把图片叠上去，生成一份新 PDF。一次性请求，服务端不回传进度，所以没有百分比也没有阶段。`,
      chips: [
        { text: '参数已锁定' },
        { text: '不会自动重复提交', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    'rate-limited': {
      kind: 'warn',
      title: '提交太频繁了',
      body: '合成一分钟内最多三次。你的文档、签名图和位置都还在，等一会儿用同一次请求标识重试即可。',
      chips: [
        { text: '一分钟内 3 次上限' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '没有重复生成', tone: 'ok' },
      ],
    },
    'conversion-in-progress': {
      kind: 'warn',
      title: '上一次合成还没结束',
      body: '同一个请求标识上还有一次正在进行的合成。为避免生成两份，这次不受理，稍候用同一次请求重试。',
      chips: [
        { text: '服务端登记为进行中' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '不会另开一份', tone: 'ok' },
      ],
    },
    'known-failed': {
      kind: 'error',
      title: '这一次明确失败了',
      body: '服务端给了明确的失败答复：这一次没有生成文件。文档、签名图、页码、位置、大小和授权全部保留，重试不用重传。',
      chips: [
        { text: '服务端明确拒绝' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    'result-unknown': {
      kind: 'warn',
      title: '这一次的结果没有确认',
      body: '请求中断了，不知道服务端有没有执行。所以这里不说已生成，也不说没生成。只能用同一请求标识 + 同一份输入重试。',
      chips: [
        { text: '结果未确认' },
        { text: '输入与请求标识已保留', tone: 'ok' },
        { text: '只允许同一请求重试', tone: 'ok' },
      ],
    },
    'retrying-same-request': {
      kind: 'info',
      title: '正在用同一次请求重试',
      body: '复用同一次请求标识，并且文档、签名图、页码、位置、大小一个字节都没有改。如果服务端上一次已经做完，会把那一份直接还回来，不会再生成一份。',
      chips: [{ text: '同一请求标识' }, { text: '同一份输入', tone: 'ok' }, { text: '参数已锁定', tone: 'ok' }],
    },
    'idempotency-conflict': {
      kind: 'error',
      title: '这个请求标识已经用过了',
      body: '同一个请求标识上一次绑定的是另一组参数。服务端拒绝覆盖，上一次的结果原样保留。要换参数，就得是一次新的请求。',
      chips: [
        { text: '请求标识已被占用' },
        { text: '上一次结果未被覆盖', tone: 'ok' },
        { text: '未生成新文件', tone: 'ok' },
      ],
    },
    'recovered-completed': {
      kind: 'info',
      title: '这一份是恢复出来的已完成结果',
      body: '服务端确认同一次请求标识、同一份输入上已经有完成的结果，于是把那一份还回来了。没有重复生成。',
      chips: [
        { text: '同一请求已完成' },
        { text: '没有重复生成', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    completed: {
      kind: 'info',
      title: '新的派生 PDF 已生成',
      body: '服务端返回了一份新文件。原 PDF 一个字节没改。下一步去材料检查，那一步才决定能不能打印。',
      chips: [
        { text: live.result ? `${live.result.pages} 页 · ${formatResultSize(live.result)}` : '派生 PDF' },
        { text: '原 PDF 未被改写', tone: 'ok' },
        { text: '下一步：材料检查', tone: 'ok' },
      ],
    },
    'output-preview-failed': {
      kind: 'warn',
      title: '派生 PDF 已生成，但这里渲染不出来',
      body: '浏览器没能把这份 PDF 画出来。这不代表文件损坏或丢失，可以重新取一次预览链接，或直接去材料检查。',
      chips: [
        { text: '预览渲染失败', tone: 'warn' },
        { text: '文件仍在', tone: 'ok' },
        { text: '可继续下一步', tone: 'ok' },
      ],
    },
    'output-expired': {
      kind: 'warn',
      title: '派生 PDF 已生成，但预览链接过期了',
      body: '访问链接有效期 30 分钟，已到期。文件没丢，但现在打不了——要重新取一次。',
      chips: [
        { text: '链接已过期', tone: 'warn' },
        { text: '文件仍在', tone: 'ok' },
        { text: '需重新取链接', tone: 'warn' },
      ],
    },
    'output-too-large': {
      kind: 'error',
      title: '合成结果超出大小限制',
      body: '叠加后的 PDF 超过 15 MB，服务端拒绝落库，没有生成可用文件。换小一点的签名图，或先压缩原 PDF。',
      chips: [{ text: '服务端明确拒绝' }, { text: '输入已全部保留', tone: 'ok' }],
    },
    'add-another-ready': {
      kind: 'info',
      title: '以刚才的合成结果继续叠加',
      body: '旧签名图和授权已清空，得重新传一张才能接着叠。',
      chips: [
        { text: live.doc ? `${live.doc.name} · ${live.pages ?? ''} 页` : '派生 PDF 已作为原文档' },
        { text: '旧签名图已清空', tone: 'warn' },
        { text: '授权已复位', tone: 'warn' },
      ],
    },
  }
  if (copies[state]) return copies[state] as StatusCopy
  if (state.startsWith('output-preview')) {
    return copies.completed as StatusCopy
  }
  if (state.startsWith('preview-') || state.startsWith('placement-')) {
    return {
      kind: 'info',
      title: live.authorized ? '参数已就绪，可以生成' : '生成之前先确认授权',
      body: live.authorized
        ? `将按${place}合成一份新的 PDF。原 PDF 不会被改写，成功后进入材料检查。`
        : '勾选授权确认之后才能生成。没勾就不给生成。',
      chips: [
        { text: place, tone: live.authorized ? 'ok' : undefined },
        { text: '产物是新文件', tone: 'ok' },
        { text: '下一步是材料检查', tone: 'ok' },
      ],
    }
  }
  if (state === 'ready-to-compose') {
    return {
      kind: 'info',
      title: '参数已就绪，可以生成',
      body: `将按${place}合成一份新的 PDF。原 PDF 不会被改写，成功后进入材料检查。`,
      chips: [
        { text: place, tone: 'ok' },
        { text: '产物是新文件', tone: 'ok' },
        { text: '下一步是材料检查', tone: 'ok' },
      ],
    }
  }
  return copies['pick-document'] as StatusCopy
}

function labelPos(position: SignStampPosition): string {
  const found = {
    'top-left': '左上',
    'top-center': '上',
    'top-right': '右上',
    'middle-left': '左',
    center: '中',
    'middle-right': '右',
    'bottom-left': '左下',
    'bottom-center': '下',
    'bottom-right': '右下',
  }[position]
  return found
}

function labelSize(size: SignStampSize): string {
  return size === 'small' ? '小' : size === 'large' ? '大' : '中'
}

function formatResultSize(result: ComposeResult): string {
  if (result.sizeBytes < 1024) return `${result.sizeBytes} B`
  if (result.sizeBytes < 1024 * 1024) return `${Math.round(result.sizeBytes / 1024)} KB`
  return `${(result.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fixtureLive(state: SignStampStateId): Partial<LiveSnapshot> {
  const base: Partial<LiveSnapshot> = {
    authReady: true,
    loggedIn: true,
    sessionExpired: false,
    fromUnknown: false,
    terminalId: 'KSK-001',
    cap: 'ready',
    doc: null,
    pages: null,
    docStage: 'idle',
    docErr: null,
    docJustRead: false,
    derived: false,
    stamp: null,
    stampStage: 'idle',
    stampErr: null,
    stampJustAdded: false,
    page: 1,
    position: 'bottom-right',
    size: 'medium',
    placeErr: null,
    authorized: false,
    authReset: false,
    phase: 'idle',
    result: null,
    outErr: null,
    oversize: false,
    viewMode: 'page',
    viewPage: 1,
    zoom: 0,
    pan: null,
  }
  const doc = { fileId: 'fx-doc', fileAccessUrl: '', name: FX.doc.name, size: FX.doc.size }
  const stamp = { fileId: 'fx-stamp', fileAccessUrl: '', name: FX.stamp.name, size: FX.stamp.size }
  const result: ComposeResult = {
    fileId: 'fx-out',
    printFileUrl: '',
    fileMd5: '',
    sizeBytes: 2.1 * 1024 * 1024,
    pages: FX.out.pages,
    name: FX.out.name,
  }
  const withDoc = { doc, pages: FX.doc.pages, viewPage: 1 }
  const withStamp = { ...withDoc, stamp }
  const withAuth = { ...withStamp, authorized: true }
  const withResult = {
    ...withAuth,
    phase: 'completed' as const,
    result,
    viewPage: 1,
  }

  const table: Partial<Record<SignStampStateId, Partial<LiveSnapshot>>> = {
    'auth-unknown': { authReady: false, loggedIn: false, terminalId: '' },
    'login-required': { loggedIn: false },
    'login-expired': { sessionExpired: true, loggedIn: false },
    'context-missing': {},
    'terminal-missing': { terminalId: '' },
    'capability-loading': { cap: 'loading' },
    'capability-disabled': { cap: 'disabled' },
    'capability-maintenance': { cap: 'maintenance' },
    'capability-error': { cap: 'error' },
    'return-source-unknown': { fromUnknown: true },
    'pick-document': {},
    'document-local-uploading': { docStage: 'uploading' },
    'document-phone-entry': { docStage: 'phone' },
    'document-inspecting': { docStage: 'inspecting' },
    'document-ready': { ...withDoc, docJustRead: true },
    'document-format-rejected': { docErr: 'document-format-rejected' },
    'document-too-large': { docErr: 'document-too-large' },
    'document-encrypted': { docErr: 'document-encrypted' },
    'document-corrupt': { docErr: 'document-corrupt' },
    'document-digital-signature': { docErr: 'document-digital-signature' },
    'document-too-many-pages': { docErr: 'document-too-many-pages' },
    'document-source-expired': { docErr: 'document-source-expired' },
    'document-source-forbidden': { docErr: 'document-source-forbidden' },
    'pick-stamp': withDoc,
    'stamp-local-uploading': { ...withDoc, stampStage: 'uploading' },
    'stamp-phone-entry': { ...withDoc, stampStage: 'phone' },
    'stamp-ready': { ...withStamp, stampJustAdded: true },
    'stamp-format-rejected': { ...withDoc, stampErr: 'stamp-format-rejected' },
    'stamp-too-large': { ...withDoc, stampErr: 'stamp-too-large' },
    'stamp-pixels-too-large': { ...withDoc, stampErr: 'stamp-pixels-too-large' },
    'stamp-corrupt': { ...withDoc, stampErr: 'stamp-corrupt' },
    'stamp-encoding-unsupported': { ...withDoc, stampErr: 'stamp-encoding-unsupported' },
    'stamp-source-expired': { ...withDoc, stampErr: 'stamp-source-expired' },
    'placement-default': { ...withStamp, page: 1, position: 'bottom-right', size: 'medium' },
    'placement-page2': { ...withStamp, page: 2, viewPage: 2 },
    'placement-last-page': { ...withStamp, page: 6, viewPage: 6 },
    'placement-top-left-small': { ...withStamp, position: 'top-left', size: 'small' },
    'placement-center-medium': { ...withStamp, page: 1, position: 'center', size: 'medium', viewPage: 1 },
    'placement-bottom-right-large': { ...withStamp, size: 'large' },
    'placement-invalid-page': {
      ...withStamp,
      placeErr: '这份文档共 6 页，第 7 页不存在。页码必须在 1–6 之间，超出的请求服务端会直接拒绝。',
    },
    'preview-fit-page': { ...withStamp, page: 3, viewPage: 3, position: 'center', viewMode: 'page' },
    'preview-fit-width': { ...withStamp, page: 3, viewPage: 3, position: 'center', viewMode: 'width' },
    'preview-zoomed': { ...withStamp, page: 3, viewPage: 3, position: 'center', viewMode: 'zoom', zoom: 2 },
    'preview-panned-corner': {
      ...withStamp,
      page: 3,
      viewPage: 3,
      position: 'center',
      viewMode: 'zoom',
      zoom: 2,
      pan: 'br',
    },
    'preview-rotated-source-page': { ...withStamp, page: 4, viewPage: 4 },
    'authorization-required': { ...withStamp, authReset: true },
    'ready-to-compose': withAuth,
    composing: { ...withAuth, phase: 'composing' },
    'rate-limited': { ...withAuth, phase: 'rate-limited' },
    'conversion-in-progress': { ...withAuth, phase: 'in-progress' },
    'known-failed': { ...withAuth, phase: 'known-failed' },
    'result-unknown': { ...withAuth, phase: 'result-unknown' },
    'retrying-same-request': { ...withAuth, phase: 'retrying' },
    'recovered-completed': { ...withResult, phase: 'recovered' },
    'idempotency-conflict': { ...withAuth, phase: 'conflict' },
    completed: withResult,
    'output-preview-page2': { ...withResult, viewPage: 2 },
    'output-preview-last': { ...withResult, viewPage: 6 },
    'output-preview-zoomed': { ...withResult, viewMode: 'zoom', zoom: 2 },
    'output-preview-failed': { ...withResult, outErr: 'render' },
    'output-expired': { ...withResult, outErr: 'expired' },
    'output-too-large': { ...withAuth, phase: 'known-failed', oversize: true, size: 'large' },
    'add-another-ready': {
      doc: { fileId: 'fx-out', fileAccessUrl: '', name: FX.out.name, size: FX.out.size },
      pages: FX.out.pages,
      derived: true,
    },
  }
  return { ...base, ...(table[state] ?? {}) }
}
