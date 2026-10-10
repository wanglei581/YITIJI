import { peekSupportContact, helpNeededLine, machineUnusableLine } from '../../../copy/unattendedCopy'
import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import { FX, type SignStampStateId } from './constants'
import type { ComposeResult, LiveSnapshot } from './signStampModel'

export interface StatusCopy {
  kind: 'error' | 'warn' | 'lock' | 'info'
  title: string
  body: string
  /** 稿上状态卡的第二段。只有结果未确认那一态有。 */
  more?: string
  chips: { text: string; tone?: 'ok' | 'warn' }[]
}

/** 稿上阻断态状态卡的三颗胶囊。仍带着旧求助原句的态不换这套，那些原句另路统一改。 */
const BLOCK_CHIPS: StatusCopy['chips'] = [
  { text: '这一页不显示任何文件' },
  { text: '不生成、不保存、不上传' },
  { text: '签名图不跨这次办理保留' },
]

export function statusCopy(state: SignStampStateId, live: LiveSnapshot): StatusCopy {
  const contact = peekSupportContact()
  const place = `第 ${live.page} 页 · ${labelPos(live.position)} · ${labelSize(live.size)}`
  const copies: Partial<Record<SignStampStateId, StatusCopy>> = {
    'auth-unknown': {
      kind: 'lock',
      title: '还没确认你是谁',
      body: '签名是<b>高敏材料</b>，在确认身份之前，这一页不提供上传、不显示任何文件，也不合成。',
      chips: BLOCK_CHIPS,
    },
    'login-required': {
      kind: 'lock',
      title: '先登录才能签名',
      body: '签名图片属于<b>高敏个人材料</b>，只允许本人在登录后上传与合成。未登录不能在这里签名。',
      chips: BLOCK_CHIPS,
    },
    'login-expired': {
      kind: 'warn',
      title: '登录已过期',
      body: '为保护高敏材料，登录过期时<b>已上传的签名图片会被丢弃</b>，需要重新登录后重新上传。原文档还在你的账号里。',
      chips: BLOCK_CHIPS,
    },
    'context-missing': {
      kind: 'warn',
      title: '没有可用的办理上下文',
      body: '没有拿到这次办理的来路，无法判断该回到哪里，也无法确认要处理哪一份材料。<b>请从打印扫描重新进入</b>。',
      chips: BLOCK_CHIPS,
    },
    'terminal-missing': {
      kind: 'error',
      title: '这台机器还没登记',
      body: '签名要先确认这台机器能不能用。读不到登记信息就<b>无法确认是否允许使用</b>，因此不放行。',
      chips: [{ text: '不假设读不到就是可用' }, { text: machineUnusableLine(contact) }],
    },
    'capability-loading': {
      kind: 'info',
      title: '正在确认这台机器能不能签名',
      body: '还没拿到这台机器是否开放「签名」的答复。<b>拿到之前不提供上传，也不显示任何文件</b>。',
      chips: BLOCK_CHIPS,
    },
    'capability-disabled': {
      kind: 'lock',
      title: '这台机器没有开放签名',
      body: '管理员没有为这台机器开放「签名」。<b>未登记一律按不允许处理</b>，不做静默降级。',
      chips: [{ text: '文档打印扫描不受影响', tone: 'ok' }, { text: helpNeededLine(contact) }],
    },
    'capability-maintenance': {
      kind: 'warn',
      title: '签名正在维护',
      body: '这台机器的签名功能被管理员置为维护状态，<b>暂时不受理新的合成</b>。已生成的文件不受影响。',
      chips: [{ text: '维护是管理员登记的真实状态' }, { text: helpNeededLine(contact) }],
    },
    'capability-error': {
      kind: 'error',
      title: '还没确认能不能签名',
      body: '没能确认这台机器能不能签名。<b>确认之前不放行</b>——不说能用，也不说不能用。',
      chips: BLOCK_CHIPS,
    },
    'return-source-unknown': {
      kind: 'warn',
      title: '认不出你是从哪里进来的',
      body: '来路参数不在允许的内部白名单里，<b>返回已安全回落到「打印扫描」</b>。原始来路值既不接受，也不回显。',
      chips: BLOCK_CHIPS,
    },
    'pick-document': {
      kind: 'info',
      title: '先选一份要签名的 PDF',
      body: '把本人手写签名的<b>图片</b>叠到 PDF 的指定位置，生成<b>一份新的 PDF</b>。原文件不会被改写。',
      chips: [
        { text: '原 PDF ≤ 15MB · 1–30 页' },
        { text: '产物是新文件', tone: 'ok' },
        { text: '原文件不被改写', tone: 'ok' },
      ],
    },
    'document-local-uploading': {
      kind: 'info',
      title: '正在把这份 PDF 传进本机',
      body: '单次上传，<b>没有可用的进度百分比</b>，所以这里只说在传。传完会立刻读一次页数。',
      chips: [{ text: '单次上传' }, { text: '没有进度回传' }, { text: '失败会原样说明', tone: 'ok' }],
    },
    'document-phone-entry': {
      kind: 'info',
      title: '用手机把 PDF 传进来',
      body: '手机扫屏幕上的码，选一份 PDF 上传。<b>确认之后才会进入下一步</b>，这一页不会替你确认。',
      chips: [{ text: '手机扫屏幕码' }, { text: '需你在手机上确认', tone: 'warn' }, { text: '不使用扫码枪' }],
    },
    'document-inspecting': {
      kind: 'info',
      title: '正在读这份 PDF 的页数',
      body: '系统打开文档，读出<b>一共几页</b>，好让你选放在第几页。<b>加密、损坏、含数字签名域的会在这一步被拒绝</b>。',
      chips: [{ text: '读取页数' }, { text: '没有进度回传' }, { text: '原文件不被改写', tone: 'ok' }],
    },
    'document-ready': {
      kind: 'info',
      title: live.pages ? `这份 PDF 读好了：共 ${live.pages} 页` : '这份 PDF 读好了',
      body: live.pages
        ? `读到 <b>${live.pages} 页</b>；没加密、没损坏、没有数字签名域。接下来传<b>这次要用的</b>签名图。`
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
      body: '签名只能放在 PDF 上。刚才那份不是 PDF，<b>没有进入流程</b>；图片要签名，先用「格式转换」拼成 PDF。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-too-large': {
      kind: 'warn',
      title: '这份 PDF 太大',
      body: '原文档上限 <b>15 MB</b>，系统不接收，<b>没有进入流程</b>。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-encrypted': {
      kind: 'warn',
      title: '这份 PDF 加了密',
      body: '系统<b>不解密</b>任何文档，加密文档一律拒绝。请换一份未加密的 PDF 再来。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-corrupt': {
      kind: 'warn',
      title: '这份 PDF 读不开',
      body: '文件结构损坏或不是有效 PDF，系统<b>解析不了</b>，<b>没有进入流程</b>。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-digital-signature': {
      kind: 'warn',
      title: '这份 PDF 已含数字签名域',
      body: '在上面叠图片会让原有数字签名失效，本功能<b>不处理这类文件</b>。请找原签发方处理。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-too-many-pages': {
      kind: 'warn',
      title: '这份 PDF 页数超出',
      body: '只支持 <b>1–30 页</b>，<b>没有进入流程</b>。请先拆分再来。',
      chips: [{ text: '原文档未被改写', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-source-expired': {
      kind: 'warn',
      title: '这份文件的访问凭证过期了',
      body: '文件访问凭证有时效，过期后系统不再受理。<b>重新选一次就行</b>，不用重新做材料。',
      chips: [{ text: '重新选择即可', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'document-source-forbidden': {
      kind: 'warn',
      title: '这份文件不在你名下',
      body: '系统只接受<b>本人名下且未过期</b>的文件。别人的文件、或已清理的文件，一律按不存在处理。',
      chips: [{ text: '归属校验未通过' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'pick-stamp': {
      kind: 'info',
      title: '传一张这次要用的签名图',
      body: '只能用<b>这次新传的图</b>：按高敏材料保留约 1 小时，<b>不进我的文档</b>。',
      chips: [
        { text: 'JPG / PNG ≤ 10MB' },
        { text: '≤ 2500 万像素' },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
      ],
    },
    'stamp-local-uploading': {
      kind: 'info',
      title: '正在传这张签名图',
      body: '这张图按<b>高敏材料</b>处理：短期保留（约 1 小时），<b>不进「我的文档」</b>，这次办理结束即不可再用。',
      chips: [
        { text: '单次上传' },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
        { text: '不进我的文档', tone: 'warn' },
      ],
    },
    'stamp-phone-entry': {
      kind: 'info',
      title: '签名图片暂不支持手机上传',
      body: '手机上传的通道<b>还不收签名图片</b>。请回到上一步，在这台机器上选一张本人手写签名的图片。',
      chips: [
        { text: '请在本机上传' },
        { text: '这一页不替你确认', tone: 'warn' },
        { text: '只收本人手写签名', tone: 'warn' },
      ],
    },
    'stamp-ready': {
      kind: 'info',
      title: '签名图收到了',
      body: live.stamp
        ? `<b>${live.stamp.name.replace(/[<>]/g, '')}</b> 已经在这次办理里。接下来选<b>第几页、哪个位置、多大</b>，左边同步画出来。`
        : '签名图已经在这次办理里。接下来选<b>第几页、哪个位置、多大</b>。',
      chips: [
        { text: live.stamp ? live.stamp.size : FX.stamp.size },
        { text: '高敏 · 约 1 小时', tone: 'warn' },
        { text: '不进我的文档', tone: 'warn' },
      ],
    },
    'stamp-format-rejected': {
      kind: 'warn',
      title: '这张图不能用',
      body: '签名图片<b>只支持 JPG / PNG</b>。刚才那份<b>没有进入流程</b>，已选的文档不受影响。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-too-large': {
      kind: 'warn',
      title: '这张图太大',
      body: '签名图片上限 <b>10 MB</b>。请压缩后重传。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-pixels-too-large': {
      kind: 'warn',
      title: '这张图像素太多',
      body: '像素总量上限 <b>2500 万</b>。请缩小分辨率后重传。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-corrupt': {
      kind: 'warn',
      title: '这张图读不出来',
      body: '文件内容与声明的格式不符，或图片已损坏，系统<b>解析不了</b>。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-encoding-unsupported': {
      kind: 'warn',
      title: '这张图的编码暂不支持',
      body: '系统嵌入这张图时失败（常见于 CMYK JPEG）。请另存为普通 PNG / JPG 后重试。',
      chips: [{ text: '已选文档不受影响', tone: 'ok' }, { text: '没有生成任何文件', tone: 'ok' }],
    },
    'stamp-source-expired': {
      kind: 'warn',
      title: '签名图的访问凭证过期了',
      body: '签名图片<b>只在这次办理短期保留</b>（约 1 小时），过期后必须重新上传，<b>不能从历史复用</b>。',
      chips: [{ text: '不能从历史复用', tone: 'warn' }, { text: '已选文档不受影响', tone: 'ok' }],
    },
    'placement-invalid-page': {
      kind: 'warn',
      title: '页码超出这份文档',
      body: live.placeErr ?? '页码必须在这份文档的页数范围内，超出的请求系统会直接拒绝。',
      chips: [
        { text: live.pages ? `共 ${live.pages} 页` : '页码越界' },
        { text: '系统会直接拒绝', tone: 'warn' },
        { text: live.pages ? `改回 1–${live.pages} 页即可` : '改回有效页码即可', tone: 'ok' },
      ],
    },
    'authorization-required': {
      kind: 'warn',
      title: live.authReset ? '换了签名图，授权要重新确认' : '生成之前先确认授权',
      body: live.authReset
        ? '上一次的授权只对上一张图有效。换图之后<b>授权已经复位</b>，得对这张新图再确认一次才能生成。'
        : '勾选「我拥有这张图的使用授权」之后才能生成。<b>没勾就不给生成</b>，原因常驻在按钮上方。',
      chips: live.authReset
        ? [
            { text: '授权已复位', tone: 'warn' },
            { text: '上一张图不留存', tone: 'warn' },
            { text: '原 PDF 不被改写', tone: 'ok' },
          ]
        : [
            { text: '需勾选授权', tone: 'warn' },
            { text: '换图后需重新确认', tone: 'warn' },
            { text: '原 PDF 不被改写', tone: 'ok' },
          ],
    },
    composing: {
      kind: 'info',
      title: '正在提交这一次合成',
      body: `按<b>${place}</b>把图片叠上去，生成一份新 PDF。交出去之后<b>系统不回传进度</b>，所以没有百分比也没有阶段。`,
      chips: [
        { text: '参数已锁定' },
        { text: '不会自动重复提交', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    'rate-limited': {
      kind: 'warn',
      title: '提交太频繁了',
      body: '合成一分钟内最多三次。<b>你的文档、签名图和位置都还在</b>，等一会儿<b>原样重试</b>一次即可。',
      chips: [
        { text: '一分钟内 3 次上限' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '没有重复生成', tone: 'ok' },
      ],
    },
    'conversion-in-progress': {
      kind: 'warn',
      title: '上一次合成还没结束',
      body: '刚才那一次的合成<b>还在进行</b>。为避免生成两份，这次先不受理，<b>稍候原样重试</b>。',
      chips: [
        { text: '系统登记为进行中' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '不会另开一份', tone: 'ok' },
      ],
    },
    'known-failed': {
      kind: 'error',
      title: '这一次明确失败了',
      body: '系统给了<b>明确的失败答复</b>：这一次<b>没有生成文件</b>。文档、签名图、页码、位置、大小和授权全部保留，重试不用重传。',
      chips: [
        { text: '系统明确拒绝' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    'result-unknown': {
      kind: 'warn',
      title: '这一次的结果<b>没有确认</b>',
      body: '刚才那一次中途断了，<b>不知道系统做了没有</b>。所以这里<b>不说已生成，也不说没生成</b>。',
      more: '只能<b>原样重试刚才那一次</b>。文档、签名图或位置一改就算新的一次，可能真生成两份。',
      chips: [
        { text: '结果未确认' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '只能原样重试那一次', tone: 'ok' },
      ],
    },
    'retrying-same-request': {
      kind: 'info',
      title: '正在原样重试<b>刚才那一次</b>',
      body: '还是<b>刚才那一次</b>：文档、签名图、页码、位置、大小<b>一点都没改</b>。如果系统上一次已经做完，会把那一份直接还回来，不会再生成一份。',
      chips: [{ text: '不算新的一次' }, { text: '同一份输入', tone: 'ok' }, { text: '参数已锁定', tone: 'ok' }],
    },
    'idempotency-conflict': {
      kind: 'error',
      title: '和刚才那一次的参数对不上',
      body: '刚才那一次交的是<b>另一组参数</b>，系统拒绝覆盖，<b>上一次的结果原样保留</b>。换参数就得重新开始。',
      chips: [
        { text: '系统拒绝覆盖' },
        { text: '上一次结果未被覆盖', tone: 'ok' },
        { text: '未生成新文件', tone: 'ok' },
      ],
    },
    'recovered-completed': {
      kind: 'info',
      title: '这一份是<b>恢复出来的已完成结果</b>',
      body: '已经确认<b>刚才那一次、同一份输入</b>其实已经做完，于是把那一份还回来了。<b>没有重复生成</b>。',
      chips: [
        { text: '刚才那一次已完成' },
        { text: '没有重复生成', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    completed: {
      kind: 'info',
      title: '新的签好的 PDF 已生成',
      body: '结果回来了<b>一份新文件</b>。<b>原 PDF 一点没改</b>。下一步去<b>材料检查</b>，那一步才决定能不能打印。',
      chips: [
        { text: live.result ? `${live.result.pages} 页 · ${formatResultSize(live.result)}` : '签好的 PDF' },
        { text: '原 PDF 未被改写', tone: 'ok' },
        { text: '下一步：材料检查', tone: 'ok' },
      ],
    },
    'output-preview-failed': {
      kind: 'warn',
      title: '签好的 PDF 已生成，但这里渲染不出来',
      body: '浏览器没能把这份 PDF 画出来。<b>这不代表文件损坏或丢失</b>，可以重新取一次预览链接，或直接去材料检查。',
      chips: [
        { text: '预览渲染失败', tone: 'warn' },
        { text: '文件仍在', tone: 'ok' },
        { text: '可继续下一步', tone: 'ok' },
      ],
    },
    'output-expired': {
      kind: 'warn',
      title: '签好的 PDF 已生成，但预览链接过期了',
      body: '访问链接<b>有效期 30 分钟</b>，已到期。<b>文件没丢，但现在打不了</b>——要重新取一次。',
      chips: [
        { text: '链接已过期', tone: 'warn' },
        { text: '文件仍在', tone: 'ok' },
        { text: '需重新取链接', tone: 'warn' },
      ],
    },
    'output-too-large': {
      kind: 'error',
      title: '合成结果超出大小限制',
      body: '叠加后的 PDF 超过 <b>15 MB</b>，系统没有保存，<b>没有生成可用文件</b>。换小一点的签名图，或先压缩原 PDF。',
      chips: [
        { text: '系统明确拒绝' },
        { text: '输入已全部保留', tone: 'ok' },
        { text: '原 PDF 不被改写', tone: 'ok' },
      ],
    },
    'add-another-ready': {
      kind: 'info',
      title: '以刚才的合成结果继续叠加',
      body: '旧签名图和授权<b>已清空</b>，<b>得重新传一张</b>才能接着叠。',
      chips: [
        { text: live.doc ? `${live.doc.name} · ${live.pages ?? ''} 页` : '签好的 PDF 已作为原文档' },
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
    if (!live.authorized) {
      return {
        kind: 'warn',
        title: '生成之前先确认授权',
        body: '勾选「我拥有这张图的使用授权」之后才能生成。<b>没勾就不给生成</b>，原因常驻在按钮上方。',
        chips: [
          { text: '需勾选授权', tone: 'warn' },
          { text: '换图后需重新确认', tone: 'warn' },
          { text: '原 PDF 不被改写', tone: 'ok' },
        ],
      }
    }
    return {
      kind: 'info',
      title: '参数已就绪，可以生成',
      body: `将按<b>${place}</b>合成一份新的 PDF。<b>原 PDF 不会被改写</b>，成功后进入材料检查。`,
      chips: [
        { text: place, tone: 'ok' },
        { text: '产物是新文件', tone: 'ok' },
        { text: '下一步是材料检查', tone: 'ok' },
      ],
    }
  }
  if (state === 'ready-to-compose') {
    return {
      kind: 'info',
      title: '参数已就绪，可以生成',
      body: `将按<b>${place}</b>合成一份新的 PDF。<b>原 PDF 不会被改写</b>，成功后进入材料检查。`,
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
    'auth-unknown': { authReady: false, loggedIn: false },
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
      placeErr: '这份文档共 6 页，第 7 页不存在。页码必须在 1–6 之间，超出的页码系统会直接拒绝。',
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
