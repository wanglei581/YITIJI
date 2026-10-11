/**
 * 小青被问到设备故障（卡纸、缺纸、打不出来、机器坏了、冒烟、异响）时：
 * 不送模型，回固定的话，不教人打开机器、抽纸、按机身按键、拔插电源。
 *
 * 起因是真机实操 F-04（2026-10-10）：一体机上问「打印机卡纸怎么办」，模型教人
 * 自己打开前盖和纸盒抽纸。现场无人值守，所以这一类不靠模型自觉。
 *
 * 覆盖：
 *   1. 判定表：该拦的问法（含真机实操列的那十种、带一体机咨询主题前缀的）、不该拦的求职话题和打字问题
 *   2. 固定回答的字：四样「不要」都在；没有承诺、没有电话号码、不叫人找现场的人
 *   3. 运行时：命中时一个请求都不发给模型、不进会话历史、不扣公网次数、不记成内容拦截；
 *      紧接着追问「能不能自己弄」同样不送模型；模型连不上时照样能答
 *   4. 写给模型的约束句：小青文字、语音小青、作业面问答三处的提示词里都有（关键词兜不住的问法
 *      和不经过后端的语音靠它）
 *
 * 不触网、不碰库（fetch 换成假实现）。
 * 运行：pnpm --filter @ai-job-print/api verify:assistant-device-fault
 */
import { DEVICE_FAULT_PROMPT_RULE, deviceFaultReply, isDeviceFaultQuestion } from '../src/ai/safety/device-fault'
import { clearSafetyBlocks, consumeSafetyRefund, recentSafetyBlocks } from '../src/ai/safety/block-log'
import { scrubMiniappReply } from '../src/ai/llm/assistant-channel'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import { buildGuardedSystemPrompt } from '../src/ai/llm/llm-guard'
import { ADVISOR_QA_SYSTEM_PROMPT } from '../src/advisor/llm-advisor.service'
import { guardTrtcLlmConfigJson } from '../src/trtc/trtc-llm-safety'
import { ANONYMOUS_AI_CALLER, lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'

// 招聘内容托管按线上口径关着跑（小青的跳转过滤读这个开关）；本脚本不验证招聘内容。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

// ─── 1. 判定表 ───────────────────────────────────────────────────────────────

/** 真机实操分派表第四节列的问法，加上同一类的常见说法。每一条都必须拦。 */
const MUST_INTERCEPT = [
  '打印机卡纸怎么办',
  '没纸了',
  '打不出来',
  '打印机坏了',
  '机器冒烟了',
  '纸卡在里面拽不出来',
  '卡纸了怎么取出来',
  '打印机缺纸了怎么加纸',
  '我的简历打不出来怎么办',
  '面试材料打不出来',
  '打印岗位材料时卡纸了',
  '这台机器没反应了',
  '机器有异响',
  '打印机一直响',
  '闻到一股焦味',
  '漏电了',
  '打印机怎么打开前盖',
  '纸盒怎么拉出来',
  '怎么重启这台机器',
  '把电源拔了再插上行吗',
  '打印到一半不动了',
  '帮我看看这台打印机，简历印到一半就停了',
  '扫描仪没反应',
  '屏幕点不动了',
  '硒鼓怎么换',
  '没墨了',
  '一体机死机了',
  '机器蓝屏了',
  '打印机报错',
  '打印失败怎么办',
  '打印不了',
  '文件没打出来',
  '出纸口不出纸',
  '我能自己把卡住的纸抽出来吗',
  '怎么把纸取出来',
  '把盖子打开可以吗',
  // 口语、倒装、只说半句（反方评审逐条推出来的漏拦，2026-10-10）
  '纸卡里面了',
  '纸卡进去了',
  '纸塞在里面了',
  '卡在里面的纸怎么拿出来',
  '打印机没有纸了',
  '机器没有纸了',
  '打印纸没了',
  '纸张用光了',
  '打印机没有墨了',
  '没粉了',
  '打印机怎么加墨',
  '为什么无法打印',
  '不能打印了怎么办',
  '打印到一半卡住了',
  '打了一半停了',
  '印了一半卡了',
  '打印机不吐纸',
  '打出来全是白纸',
  '打印出来有一条黑线',
  '打印机用不了了',
  '这台机器不能用了',
  '机器卡了怎么办',
  '打印机声音好大',
  '前盖盖不上了',
  '纸盒关不上',
  '有纸卡着',
  '里面卡了张纸',
  '纸出不来',
  '怎么没出纸',
  '出纸口没东西',
  '打了没反应',
  '点了打印没反应',
  '纸打歪了',
  '打出来的纸是皱的',
  '纸撕破了',
  '是不是坏了',
  '这破机器',
  '打印机亮红灯',
  '红灯一直闪',
  '显示离线',
  '打印机脱机',
  '连不上打印机',
  '有股怪味',
  '被电了一下',
  '机器嗡嗡响',
  '噼里啪啦响',
  '机器很烫',
  '我把线拔了',
  '要不要拔线',
  '重启一下试试',
  '我把它关了重开',
  '长按电源',
  '我想踢这台机器两脚',
  '打印机怎么开机',
  '我想给这台机器关机再开',
  '打印出来是空白的',
  '机器有点问题',
  '电源键在哪',
  '复印机坏掉了怎么修',
  '可以自己修打印机吗',
  '谁负责修这台打印机',
  '打 印 机 卡 纸 了',
  '当前咨询主题：打印帮助\n用户问题：卡纸了',
  // 一体机四个咨询主题的名字里有「简历、面试、岗位」这些词；判定只看用户自己那一句，
  // 不能因为主题名里有求职的词就把「能不能自己修」放过去。
  '当前咨询主题：简历与求职材料\n用户问题：可以自己修打印机吗',
  '当前咨询主题：面试与沟通\n用户问题：可以自己修打印机吗',
  '当前咨询主题：岗位与选择\n用户问题：我想把打印机拆开看看',
  '当前咨询主题：入职与职场\n用户问题：怎么修这个机器',
] as const

/** 求职话题、打字和电话问题、正常的打印咨询。每一条都不许拦，要照常交给模型。 */
const MUST_NOT_INTERCEPT = [
  '你好',
  '帮我看看简历怎么写',
  '怎么打印简历',
  '打印一份要多少钱',
  '我以前在打印店工作，处理过打印机卡纸，这段经历怎么写进简历',
  '岗位要求会排除打印机卡纸等故障，我没做过怎么办',
  '面试官问我遇到设备故障怎么处理，该怎么回答',
  '我想应聘打印店店员，需要会处理卡纸吗',
  '我想找设备维修方面的工作',
  '我想找打印机维修的工作',
  '学校有没有打印机维修专业',
  '我现在的工作是维修打印机，简历怎么写',
  '我有三年打印机维修经验，帮我写自我介绍',
  '我是设备工程师，想优化一下简历',
  '机器学习方向的简历有问题吗',
  '无纸化办公经验怎么写',
  '没纸质版简历可以吗',
  '面试时要把纸质版简历拿出来吗',
  '进门后要把纸质简历拿出来吗',
  '帮我修改一下简历',
  '怎么修改这台机器上的字体大小',
  '帮我把这段话拆分成三点',
  '我的姓打不出来',
  '键盘打不出李字',
  '服务电话打不了',
  '人社局电话多少',
  // 「打不出」「打不了」的别的意思；「能不能打印」是在问规定；「粉」不是碳粉
  '我简历打不出亮点怎么办',
  '和领导打不了交道怎么办',
  '这个公司离家太远我打不了卡',
  '这个岗位我打不了包票',
  '能不能打印身份证',
  '证件照能换粉色底吗',
  '我做自媒体没粉丝怎么办',
  '打印不动产登记证明要带什么',
  '用这台机器打印不动产证明可以吗',
  '我对这台机器的使用有问题想问',
  '一体机几点关机',
  '这份简历打印出来有很多空白，怎么调整版式',
  '我的纸质简历卡在哪一步了',
  // 提到了机器、屏幕，但问的是怎么用，不是坏了
  '这台机器能拍证件照吗',
  '这台机器怎么用',
  '这台机器可以扫描吗',
  '一体机支持微信支付吗',
  '这台机器能打印彩色吗',
  '本机支持哪些格式',
  '屏幕上的字太小了',
  '机器会保存我的文件吗',
  '这台机器关机了我的文件还在吗',
  '一体机几点开机',
  '显示的二维码扫不了',
  '提示登录失败',
  '提示文件格式错误怎么办',
  '提示密码错误',
  '上传文件报错了',
  // 坏的是别的东西；字面上撞词的求职话题
  '我的U盘好像坏了读不出来',
  '我手机好像坏了',
  '被电话面试了怎么准备',
  '公司选拔线上面试怎么准备',
  '工作压力大到冒烟',
  '我没有墨迹的习惯',
  '我的简历被卡住了没人回复',
  '投了简历没反应怎么办',
  '我一紧张就卡住了',
  '脑子一片空白怎么办',
  '我会修电脑能找什么工作',
  '汽车维修专业好就业吗',
  '我在工厂开机器三年了',
  '打印社保证明',
  '怎么退款',
  // 说的是面试，不是眼前这台机器
  '刚才面试官问我打印机卡纸怎么处理，我该怎么回答',
  '那我自己能弄吗',
  '教我怎么取',
] as const

/** 只有上一轮刚回过固定回答时才拦的追问。 */
const FOLLOW_UPS = [
  '那我自己能弄吗', '教我怎么取', '我自己修一下行吗', '什么时候有人来修', '谁来处理', '多久能修好',
  '我要不要拍两下', '踢一脚能好吗', '按哪个键',
] as const

/** 上一轮是固定回答、这一句已经换了话题：要放回给模型，不能把人困在固定回答里。 */
const MOVED_ON = [
  '帮我看看简历怎么写',
  '怎么修改简历',
  '简历怎么开头',
  '教我写简历',
  '那我自己来写吧',
  '那帮我看看简历吧，我自己写的',
  '那我先去别处打印，这一段自己的经历帮我改改',
  '我辅修了法学有用吗',
  '教我怎么处理人际关系',
  '好的谢谢',
] as const

function tableChecks(): void {
  for (const text of MUST_INTERCEPT) {
    check(isDeviceFaultQuestion(text), `该拦：${JSON.stringify(text)}`)
  }
  for (const text of MUST_NOT_INTERCEPT) {
    check(!isDeviceFaultQuestion(text), `不该拦：${JSON.stringify(text)}`)
  }
  for (const text of FOLLOW_UPS) {
    check(!isDeviceFaultQuestion(text, false), `追问（上一轮不是固定回答）不拦：${text}`)
    check(isDeviceFaultQuestion(text, true), `追问（上一轮是固定回答）要拦：${text}`)
  }
  for (const text of MOVED_ON) {
    check(!isDeviceFaultQuestion(text, true), `上一轮是固定回答、已经换了话题，不拦：${text}`)
  }
  const pastedJd = `岗位职责：${'负责办公设备日常维护，能排除打印机卡纸等常见故障；'.repeat(8)}`
  check(pastedJd.length > 160 && !isDeviceFaultQuestion(pastedJd), '贴进来的长段岗位要求不拦')
  // 没有任何求职的词、只是很长的一段粘贴（比如讲稿、自述）：靠长度线放过。
  const pastedStory = '去年暑假我在学校文印室帮忙，每天开门先看打印机有没有卡纸、缺纸，再给老师和同学打印试卷。'.repeat(4)
  check(pastedStory.length > 160 && !isDeviceFaultQuestion(pastedStory), '贴进来的长段自述不拦')
  check(isDeviceFaultQuestion(pastedStory.slice(0, 40)), '同一段话截短以后会拦（阳性对照：放过它的是长度，不是别的词）')
  check(!isDeviceFaultQuestion(''), '空话不拦')
}

// ─── 2. 固定回答的字 ─────────────────────────────────────────────────────────

function replyChecks(): void {
  const kiosk = deviceFaultReply('kiosk')
  const miniapp = deviceFaultReply('miniapp')
  for (const [name, reply] of [['一体机', kiosk], ['小程序', miniapp]] as const) {
    for (const must of ['不要自己打开机器', '拉扯纸张', '按机身上的按键', '拔插电源', '请稍后再来', '请立刻离开机器', '119']) {
      check(reply.includes(must), `${name}固定回答有「${must}」`)
    }
    // 不承诺：提醒送不送得到人、谁来处理、多久处理，这里都不知道。
    for (const banned of ['收到提醒', '尽快处理', '马上处理', '已通知', '会有人', '远程处理']) {
      check(!reply.includes(banned), `${name}固定回答不说「${banned}」`)
    }
    // 现场无人值守；也不知道附近有没有别的在线终端。
    for (const banned of ['工作人员', '服务台', '管理员', '换一台']) {
      check(!reply.includes(banned), `${name}固定回答不说「${banned}」`)
    }
    // 不编电话：整段话里唯一的数字是 119。
    check(JSON.stringify(reply.match(/\d+/g)) === JSON.stringify(['119']), `${name}固定回答里唯一的数字是 119`)
  }
  check(kiosk.includes('「帮助中心」') && !kiosk.includes('意见反馈'), '一体机指到帮助中心')
  check(miniapp.includes('「意见反馈」') && !miniapp.includes('帮助中心'), '小程序指到意见反馈（它的帮助页没有电话）')
  check(scrubMiniappReply(miniapp) === miniapp, '小程序固定回答不会被小程序的禁用词过滤换掉')
}

// ─── 3. 运行时 ───────────────────────────────────────────────────────────────

const response = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response

async function runtimeChecks(): Promise<void> {
  const chatConfig = {
    vendor: 'openai', model: 'm', baseURL: 'http://127.0.0.1/v1', systemPrompt: '你是就业服务助手',
    roleScope: '', forbiddenWords: [] as string[], temperature: 0, enabled: true,
  }
  const chat = new LlmChatService({ getApiKey: () => 'verify-key', getConfig: () => chatConfig } as never)
  const sentBodies: string[] = []
  let modelDown = false
  const savedFetch = globalThis.fetch
  ;(globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => {
    if (modelDown) throw new Error('connect ECONNREFUSED')
    sentBodies.push(String(init.body))
    return response({ choices: [{ message: { content: '模型的回答' } }] })
  }
  const inRequest = <T>(fn: () => Promise<T>) =>
    runWithAiRequestContext(lazyAiRequestContext(async () => ({ ...ANONYMOUS_AI_CALLER })), async () => {
      const result = await fn()
      return { result, refunded: consumeSafetyRefund() }
    })
  const userTextsOf = (body: string) =>
    (JSON.parse(body) as { messages: Array<{ role: string; content: string }> }).messages
      .filter((message) => message.role !== 'system').map((message) => message.content)

  try {
    clearSafetyBlocks()

    // 阳性对照：正常的打印咨询照常调模型、照常扣次。
    const normal = await inRequest(() => chat.chat({ message: '怎么打印文件', channel: 'kiosk' } as never))
    check(sentBodies.length === 1 && normal.result.reply === '模型的回答', '阳性对照：正常咨询调了模型并拿到模型的回答')
    check(normal.refunded === false, '阳性对照：正常咨询不退次数')
    check((normal.result.actions ?? []).some((action) => action.route === '/print/upload'), '阳性对照：正常咨询带打印入口')
    const systemPrompt = (JSON.parse(sentBodies[0]!) as { messages: Array<{ role: string; content: string }> }).messages[0]
    check(systemPrompt?.role === 'system' && systemPrompt.content.includes(DEVICE_FAULT_PROMPT_RULE), '真正发给模型的系统提示词里带着设备故障那句约束')

    // 命中：一个请求都不发，回固定的话，不带跳转，不扣次，不记成内容拦截。
    const before = sentBodies.length
    const fault = await inRequest(() => chat.chat({ message: '打印机卡纸怎么办', sessionId: normal.result.sessionId, channel: 'kiosk' } as never))
    check(sentBodies.length === before, '命中：没有向模型发请求')
    check(fault.result.reply === deviceFaultReply('kiosk'), '命中：一体机拿到一体机的固定回答')
    check((fault.result.actions ?? []).length === 0, '命中：不带「打印文件」这类跳转')
    check(fault.result.sessionId === normal.result.sessionId, '命中：会话不变')
    check(fault.refunded === true, '命中：退回本次公网次数（没调模型不扣次）')
    check(recentSafetyBlocks().length === 0, '命中：不记成内容拦截')

    // 紧接着追问能不能自己弄：同样不送模型。
    const followUp = await inRequest(() => chat.chat({ message: '那我自己能弄吗', sessionId: normal.result.sessionId, channel: 'kiosk' } as never))
    check(sentBodies.length === before && followUp.result.reply === deviceFaultReply('kiosk'), '追问：不送模型，仍是固定回答')
    check(followUp.refunded === true, '追问：同样退回公网次数')

    // 换回正常话题：照常调模型；刚才那两问和固定回答都不在发给模型的历史里。
    const back = await inRequest(() => chat.chat({ message: '帮我看看简历怎么写', sessionId: normal.result.sessionId, channel: 'kiosk' } as never))
    check(sentBodies.length === before + 1 && back.result.reply === '模型的回答', '换回正常话题：照常调模型')
    const history = userTextsOf(sentBodies[sentBodies.length - 1]!)
    check(history.includes('怎么打印文件') && history.includes('帮我看看简历怎么写'), '换回正常话题：历史里有正常的两问（阳性对照）')
    check(!history.some((text) => text.includes('卡纸') || text.includes('自己能弄') || text.includes('不要自己打开机器')), '换回正常话题：故障那两问和固定回答不在历史里')

    // 正常一轮之后，同一句追问不再被当成故障追问。
    const later = await inRequest(() => chat.chat({ message: '那我自己能弄吗', sessionId: normal.result.sessionId, channel: 'kiosk' } as never))
    check(sentBodies.length === before + 2 && later.result.reply === '模型的回答', '正常一轮之后：「那我自己能弄吗」照常交给模型')

    // 一体机带咨询主题的前缀、小程序渠道。
    const prefixed = await inRequest(() => chat.chat({ message: '当前咨询主题：简历与求职材料\n用户问题：没纸了', channel: 'kiosk' } as never))
    check(sentBodies.length === before + 2 && prefixed.result.reply === deviceFaultReply('kiosk'), '带咨询主题前缀：照样命中')
    check(prefixed.refunded === true, '带咨询主题前缀：同样退回公网次数')
    const viaMiniapp = await inRequest(() => chat.chat({ message: '一体机卡纸了', channel: 'miniapp' } as never))
    check(sentBodies.length === before + 2 && viaMiniapp.result.reply === deviceFaultReply('miniapp'), '小程序渠道：拿到小程序的固定回答')
    check(viaMiniapp.refunded === true, '小程序渠道：同样退回公网次数')

    // 模型连不上：正常咨询报错（阳性对照），故障求助照样能答。
    modelDown = true
    let normalFailed = false
    try { await chat.chat({ message: '帮我看看简历怎么写', channel: 'kiosk' } as never) } catch { normalFailed = true }
    check(normalFailed, '模型连不上：正常咨询报错（阳性对照）')
    const whileDown = await inRequest(() => chat.chat({ message: '机器冒烟了', channel: 'kiosk' } as never))
    check(whileDown.result.reply === deviceFaultReply('kiosk'), '模型连不上：故障求助照样拿到固定回答')
    check(whileDown.refunded === true, '模型连不上：故障求助同样退回公网次数')
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = savedFetch
  }
}

// ─── 4. 写给模型的约束句 ─────────────────────────────────────────────────────

function promptChecks(): void {
  // 字是合规定的（2026-10-10）。这里钉住每一个半句，改字要先过合规再来改这张表。
  for (const must of [
    '不要教用户打开机器、取纸、按机身按键或拔插电源',
    '不要说已经有人收到提醒或会来处理',
    '不要自己说出任何电话号码',
    '不要提退款或订单状态',
    '只提醒不要自行处理、可以稍后再来',
    '请用户查看帮助页上的联系方式',
    '先提醒离开机器',
    '有明火或人身危险拨打 119',
  ]) {
    check(DEVICE_FAULT_PROMPT_RULE.includes(must), `约束句有「${must}」`)
  }
  const text = buildGuardedSystemPrompt({ systemPrompt: '你是就业服务助手' })
  check(text.includes(DEVICE_FAULT_PROMPT_RULE), '小青文字对话的系统约束里有这一句')
  const voice = buildGuardedSystemPrompt({ systemPrompt: '你是小青' }, { policyVariant: 'voice' })
  check(voice.includes(DEVICE_FAULT_PROMPT_RULE), '语音小青的系统约束里有这一句')
  // 语音小青的话由腾讯云直接调模型，不经过后端，关键词拦不到：下发给腾讯云的配置里必须带着这一句。
  const trtc = JSON.parse(guardTrtcLlmConfigJson(
    JSON.stringify({ LLMType: 'openai', SystemPrompt: '你是小青，说话简短' }), { systemPrompt: '兜底提示词' },
  )) as { SystemPrompt?: string }
  check(String(trtc.SystemPrompt).includes('你是小青，说话简短'), '阳性对照：下发给腾讯云的提示词确实是从配置拼出来的')
  check(String(trtc.SystemPrompt).includes(DEVICE_FAULT_PROMPT_RULE), '下发给腾讯云的语音小青提示词里有这一句')
  check(ADVISOR_QA_SYSTEM_PROMPT.includes(`6. ${DEVICE_FAULT_PROMPT_RULE}`), '作业面问答的提示词第 6 条是这一句')
}

async function main(): Promise<void> {
  console.log('\n=== 小青设备故障固定回答 ===')
  tableChecks()
  replyChecks()
  promptChecks()
  await runtimeChecks()
  console.log(`\nverify:assistant-device-fault ${failCount === 0 ? '通过' : '未通过'}：PASS ${passCount} / FAIL ${failCount}`)
  if (failCount > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
