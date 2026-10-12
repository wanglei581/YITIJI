// ============================================================
// 小青被问到眼前这台打印设备故障时：不教人动手。
//
// 三道，各管各的（真机实操 F-04，2026-10-10；输入侧按 2026-10-11 收窄）：
//   1. DEVICE_FAULT_PROMPT_RULE：嘱咐模型。语音小青不经过后端，只有这一句。字不改。
//   2. isDeviceFaultQuestion：用户明说是眼前这台出了故障，或想自己开盖、取纸、重启、断电，
//      才不送模型。拿不准的放给模型。
//   3. hasHandsOnMachineInstruction：模型答完再查有没有教人动手。有，且不是在聊求职内容，
//      整段换成固定的话。这一道不看用户这一句是不是被输入侧拦，但用户这一句明确在聊求职内容时不换
//      （约束句照样在提示词里）。
//
// 固定的两段话字由合规定，不许改：
//   - 不说已经有人收到提醒或会来处理（告警不一定送得到人）；
//   - 不编电话，只指到帮助中心或意见反馈；
//   - 不说换一台（不知道附近有没有别的终端）。
// ============================================================

export type DeviceFaultChannel = 'kiosk' | 'miniapp'

const KIOSK_REPLY =
  '机器卡纸、缺纸、打不出来或有其它故障时，请不要自己打开机器、拉扯纸张、按机身上的按键或拔插电源。' +
  '机器暂时用不了的话，请稍后再来；需要帮助请看「帮助中心」里的联系方式。' +
  '如果看到冒烟、闻到焦味或听到异常响声，请立刻离开机器；有明火或人身危险请拨打 119。'

const MINIAPP_REPLY =
  '一体机卡纸、缺纸、打不出来或有其它故障时，请不要自己打开机器、拉扯纸张、按机身上的按键或拔插电源。' +
  '机器暂时用不了的话，请稍后再来；需要帮助可以在「意见反馈」里告诉我们。' +
  '如果看到冒烟、闻到焦味或听到异常响声，请立刻离开机器；有明火或人身危险请拨打 119。'

/** 写给模型的约束。字由合规定（2026-10-10），改之前先过合规。 */
export const DEVICE_FAULT_PROMPT_RULE =
  '设备故障：用户问到打印机或本机卡纸、缺纸、打不出来、损坏、冒烟、异响等故障时，不要教用户打开机器、取纸、按机身按键或拔插电源，' +
  '也不要说已经有人收到提醒或会来处理；不要自己说出任何电话号码，不要提退款或订单状态。' +
  '只提醒不要自行处理、可以稍后再来，并请用户查看帮助页上的联系方式；说到冒烟、焦味或明火时，先提醒离开机器，有明火或人身危险拨打 119。'

export function deviceFaultReply(channel: DeviceFaultChannel): string {
  return channel === 'miniapp' ? MINIAPP_REPLY : KIOSK_REPLY
}

/**
 * 作业面问答的出处说明。输入侧、输出侧都用这一句，源码里只写在这里。
 * 页面上的标叫「安全提示」，由前端写，后端不出这个标。字由合规六 2026-10-11 定。
 */
export const DEVICE_FAULT_SOURCE_NOTE = '这是固定的安全提示，不是 AI 的判断。'

const TOPIC_PREFIX = /^当前咨询主题：[^\n]*\n用户问题：/
const MAX_FAULT_QUESTION_CHARS = 160
const MAX_FOLLOW_UP_CHARS = 40
/** 归一后两个词中间隔多少字还算「十来个字」。 */
const CONTEXT_GAP = 12
const SHORT_DANGER_CHARS = 12

const TRADITIONAL: Record<string, string> = {
  機: '机', 紙: '纸', 壞: '坏', 煙: '烟', 電: '电', 開: '开', 關: '关',
  麼: '么', 沒: '没', 這: '这', 裡: '里',
}

/** 打印上下文。耗材词不在这里：硒鼓、墨盒单独出现不算故障。 */
const PRINT_CONTEXT =
  /打印机|复印机|扫描仪|一体机|机器(?!学习|人|视觉|翻译)|机子|这台|本机|这个设备|这设备|出来的纸|打出来|印出来|出纸口|出纸|进纸|纸盒|纸盘|打印|复印|扫描|吐出/g

/**
 * 明确在聊求职内容才算。经验、工程师、熟悉、擅长、负责故意不在里面：
 * 「打印机卡纸了，我没经验」仍是眼前这台。
 */
const JOB_FRAME =
  /写进|写到|写在|怎么写|怎么描述|怎么表述|润色|改写|简历里|简历上|简历中|岗位要求|任职要求|招聘要求|jd|面试官|面试题|面试时|面试中|面试问|应聘|自我介绍|求职信|好找工作吗|销售/
const JOB_PAIR_A = /想找|找个|应聘|从事|转行|想学|学修|培训/g
const JOB_PAIR_B = /工作|岗位|职位|这一行/g
const HERE_AND_NOW = /这台|本机|这个机器|这机器|正在打|正在印|打到一半|印到一半/

const CAT1: readonly RegExp[] = [
  /卡纸/,
  /夹纸(?!板)/,
  /塞纸/,
  /缺纸(?!质)/,
  /缺墨/,
  /缺粉/,
  /不出纸/,
  /没出纸/,
  /不进纸/,
  /不走纸/,
  /不吐纸/,
  /出不了纸/,
  /出不来纸/,
  /纸卡[住在到进死了]/,
  /卡[住着了]的纸/,
  /纸用完了/,
  /没纸了/,
  /纸没了/,
  /吐出半张/,
]

/** 第二类：必须旁边有打印上下文。单字的「皱、歪、拆、修」也在这里，不能单独算。 */
const CAT2: readonly RegExp[] = [
  /卡住/, /卡了/, /卡壳/, /卡死/, /卡机/, /没反应/, /不动(?!产)/, /不干活/, /不工作/, /一直转/,
  /坏了/, /坏掉/, /故障/, /出问题/, /报错/, /出错/, /死机/, /黑屏/, /蓝屏/, /花屏/, /发烫/, /很烫/,
  /没纸/, /没墨/, /加墨/, /换墨/, /加粉/, /换粉/, /换硒鼓/, /指示灯/, /红灯/, /黄灯/, /灯闪/,
  /错误代码/, /错误码/, /打不出/, /印不出/, /打印不了/, /无法打印/, /没打出来/, /白纸/, /是白的/,
  /半张/, /打到一半/, /印到一半/, /出了一半/, /只出来一半/, /停了/, /皱/, /(?<!(?:放|摆|贴)得?)歪/, /重启/,
  /断电/, /拔电/, /电源键/, /电源开关/, /开盖/, /前盖/, /后盖/, /盖子/, /拆(?!分|解|迁)/,
  /修(?!改|订|饰|正|专业|技术|培训|课程|班|工|师|员|岗|行业)/,
]

const DANGER =
  /冒黑烟|冒白烟|在冒烟|一股烟|冒烟|着火|起火|明火|火花|烧焦|焦味|糊味|漏电(?!保护|开关|断路)|触电|被电到|电了一下/
const DANGER_OTHER = /脑子|脑袋|头|嗓子|心里|气得|菜|锅|饭|烤|炒|煮|烧烤|厨房|香烟|抽烟|吸烟|压力|累|忙/
const NOT_PRINTER_PRINT = /字|拼音|键盘|输入法|姓|名字|电话|号码|证|条|表|单/

const FOLLOW_UP =
  /自己(?:能|可以|来|去)?(?:(?:弄|修(?!改)|处理)(?!好|完)|动手|取|拿|拆|解决|搞)|我(?:来|能|会|可以)(?:弄|修(?!改)|取|拿|拆|试试)|教我(?:怎么)?(?:弄|取|拿|修(?!改)|拆|开(?!头|始|场))|(?:怎么|咋|如何)(?:弄|取出|拿出|抽出|拽出|拉出|修(?!改|订|饰|正)|拆(?!分))|(?:什么时候|啥时候|多久|谁|有人|找人|叫人|派人).{0,6}(?:修好|修一下|修|处理|弄好)|修一下|(?:拽|拉|抽|扯|取|拿|弄)出来|(?:拍|踢|敲|砸|晃|摇)(?:一|两|几)?(?:下|脚)|按(?:哪|了|一下)?.{0,4}键/

function normalizeFaultText(message: string): string {
  let text = message.replace(TOPIC_PREFIX, '')
  text = text.replace(/[機紙壞煙電開關麼沒這裡]/g, (ch) => TRADITIONAL[ch] ?? ch)
  text = text.replace(/印表机/g, '打印机').replace(/列印/g, '打印')
  return text.toLowerCase().replace(/[\s\p{P}]+/gu, '')
}

function spans(text: string, pattern: RegExp): Array<[number, number]> {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  const found: Array<[number, number]> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match[0].length === 0) { re.lastIndex += 1; continue }
    found.push([match.index, match.index + match[0].length])
  }
  return found
}

function spansClose(text: string, left: RegExp, right: RegExp, gap: number): boolean {
  for (const [ls, le] of spans(text, left)) {
    for (const [rs, re] of spans(text, right)) {
      if (le <= rs && rs - le <= gap) return true
      if (re <= ls && ls - re <= gap) return true
    }
  }
  return false
}

/** 征兆自己带的「打印」不算旁边的打印上下文（「无法打印」不能自己证明自己）。 */
function nearPrintContext(text: string, symptom: RegExp): boolean {
  const contexts = spans(text, PRINT_CONTEXT)
  for (const [ss, se] of spans(text, symptom)) {
    for (const [cs, ce] of contexts) {
      const overlaps = cs < se && ss < ce
      if (overlaps) continue
      if (ce <= ss && ss - ce <= CONTEXT_GAP) return true
      if (se <= cs && cs - se <= CONTEXT_GAP) return true
    }
  }
  return false
}

function category1(text: string): boolean {
  if (text === '加纸' || text === '装纸' || text === '换纸') return true
  // 「卡机了」整句就是机器卡住。旁边没有「打印机」也算。
  // 「卡住了」仍要有打印上下文，不跟着放进来。
  if (text === '卡机' || text === '卡机了') return true
  return CAT1.some((pattern) => pattern.test(text))
}

/** 「空白」只认这几种，而且仍要挨着打印上下文。「空白的地方 / 表格」不算。 */
const BLANK_PAGE = /全是空白|一片空白|全空白|是空白|空白的(?!地方|处|栏|格|表|模板)/

function category2(text: string): boolean {
  if (CAT2.some((pattern) => nearPrintContext(text, pattern))) return true
  if (nearPrintContext(text, BLANK_PAGE)) return true
  // 错字「卡只」只在有打印上下文时当成卡纸（「打印机卡只了」）。「卡低了」对不上。
  if (nearPrintContext(text, /卡只/)) return true
  // 指着眼前的东西说坏了，不要求再出现「打印机」。「其它」里的「它」不算。
  return spansClose(text, /这玩意|这东西|(?<!其)它/g, /坏了|不工作|不动了|没反应/g, 6)
}

function category3(text: string): boolean {
  if (!DANGER.test(text)) return false
  if (nearPrintContext(text, DANGER)) return true
  return text.length <= SHORT_DANGER_CHARS && !DANGER_OTHER.test(text)
}

function englishFault(text: string): boolean {
  if (text.includes('paperjam') || text.includes('jammed')) return true
  if (spansClose(text, /打印机/g, /jam|error/g, CONTEXT_GAP)) return true
  return spansClose(text, /printer/g, /broken|notworking|error|jam|stuck|smoke|fire/g, 16)
}

/** 「打不出来 / 打不了」默认当打印；句里在说字、证、条、电话时不算。 */
function cannotPrintPhrase(text: string): boolean {
  const saysOther = NOT_PRINTER_PRINT.test(text)
  if (/打不出来/.test(text) && !saysOther) return true
  if (/打不了(?=$|了|怎|咋|啊|呢|吗|呀)/.test(text) && !saysOther) return true
  return false
}

function consumableFault(text: string): boolean {
  return spansClose(text, /硒鼓|墨盒|粉盒|碳粉/g, /没了|用完|空了|缺|换|加|坏/g, 8)
}

function matchesFault(text: string): boolean {
  return category1(text) || category2(text) || category3(text) || englishFault(text) || cannotPrintPhrase(text) || consumableFault(text)
}

export function isAboutJobContent(message: string): boolean {
  const text = normalizeFaultText(message)
  if (!text) return false
  if (JOB_FRAME.test(text)) return true
  if (spansClose(text, JOB_PAIR_A, JOB_PAIR_B, CONTEXT_GAP)) return true
  // 「我想学修打印机」没有「工作 / 岗位」，但学修就是在说这一行，不是要修眼前这台。
  return /想学修|学修打印机|学修复印机|学修一体机/.test(text)
}

/**
 * 这句话是不是在求助眼前这台打印设备。
 * @param justAnsweredFault 同一会话上一轮是否刚回过固定的话
 */
/** 已经好了、能打了，又没有在问，不当成还要自己动手的追问。问号可能被归一去掉，所以看原句。 */
function settledAfterFault(raw: string, text: string): boolean {
  if (!/好了|搞定|解决了|能用了|能打了|正常了/.test(text)) return false
  if (/[吗么呢]/.test(text)) return false
  return !/[？?]/.test(raw)
}

export function isDeviceFaultQuestion(message: string, justAnsweredFault = false): boolean {
  const text = normalizeFaultText(message)
  if (!text || text.length > MAX_FAULT_QUESTION_CHARS) return false
  const here = HERE_AND_NOW.test(text)
  if (isAboutJobContent(message) && !here) return false
  if (matchesFault(text)) return true
  if (!justAnsweredFault || text.length > MAX_FOLLOW_UP_CHARS || settledAfterFault(message, text)) return false
  return FOLLOW_UP.test(text)
}

const NEGATION = /不要|请勿|切勿|不能|不可|禁止|无需|不用|别/g
/** 否定词后面出现这些，说明又开始吩咐人做。请、先要出现在否定词之后，不能算进「请勿」自己的「请」。 */
const REENABLE = /可以|然后|接着|建议|麻烦|请|先/
/** 不用担心、不要慌、不要紧：否定词只管这几个安慰字。 */
const COMFORT_AFTER = /^(?:担心|着急|害怕|紧张|慌|怕|急|紧)/

/** 否定词管同一句里它后面的动作；中间出现「可以、然后、请、先」就不再算否定。 */
function isNegated(sentence: string, verbAt: number): boolean {
  const before = sentence.slice(0, verbAt)
  const re = new RegExp(NEGATION.source, 'g')
  let lastEnd = -1
  let match: RegExpExecArray | null
  while ((match = re.exec(before))) {
    const word = match[0]
    const prev = before[match.index - 1] ?? ''
    const afterWord = before.slice(match.index + word.length)
    if (word === '别' && ((prev !== '' && '特区别类级各'.includes(prev)) || afterWord.startsWith('的') || afterWord.startsWith('人') || afterWord.startsWith('处'))) continue
    if (word === '不能' && prev === '能') continue
    if (word === '不可' && afterWord.startsWith('思')) continue
    if (COMFORT_AFTER.test(afterWord)) continue
    lastEnd = match.index + word.length
  }
  if (lastEnd < 0) return false
  return !REENABLE.test(before.slice(lastEnd))
}

function objectIn(text: string, from: number, to: number, objects: RegExp, avoidBefore: boolean): boolean {
  const hay = text.slice(from, to)
  const re = new RegExp(objects.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(hay))) {
    if (match[0].length === 0) { re.lastIndex += 1; continue }
    if (avoidBefore) {
      const abs = from + match.index
      const prefix = text.slice(Math.max(0, abs - 2), abs)
      if (/(?:避免|防止|以免|免得)$/.test(prefix)) continue
    }
    return true
  }
  return false
}

function nearObject(text: string, verbAt: number, verbEnd: number, objects: RegExp, gap: number, avoidBefore: boolean): boolean {
  if (objectIn(text, verbEnd, verbEnd + gap, objects, avoidBefore)) return true
  return objectIn(text, Math.max(0, verbAt - gap), verbAt, objects, avoidBefore)
}

/** 关闭 / 关掉和电源之间夹着手机、电脑、平板、笔记本的，不算教人动打印机。 */
function powerObjectCounts(text: string, verbAt: number, verbEnd: number, gap: number): boolean {
  const objects = /电源线|电源开关|电源|插头/
  const regions: Array<[number, number]> = [
    [verbEnd, verbEnd + gap],
    [Math.max(0, verbAt - gap), verbAt],
  ]
  for (const [from, to] of regions) {
    const hay = text.slice(from, to)
    const re = new RegExp(objects.source, 'g')
    let match: RegExpExecArray | null
    while ((match = re.exec(hay))) {
      if (match[0].length === 0) { re.lastIndex += 1; continue }
      const objAt = from + match.index
      const objEnd = objAt + match[0].length
      const between = verbEnd <= objAt ? text.slice(verbEnd, objAt) : text.slice(objEnd, verbAt)
      if (/手机|电脑|平板|笔记本/.test(between)) continue
      return true
    }
  }
  return false
}

/** 这一类里每个动词都看；前一个被否定，后面没被否定的仍算。 */
function unguarded(text: string, verbs: RegExp, hit: (verb: string, verbAt: number, verbEnd: number) => boolean): boolean {
  const re = new RegExp(verbs.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match[0].length === 0) { re.lastIndex += 1; continue }
    const verbAt = match.index
    const verbEnd = verbAt + match[0].length
    if (!hit(match[0], verbAt, verbEnd)) continue
    if (isNegated(text, verbAt)) continue
    return true
  }
  return false
}

/** 关机到开机、断电到通电 / 重新上电 / 开机，中间不超过 10 个字。 */
function withinTen(after: string, right: RegExp, rightChars: number): boolean {
  const found = new RegExp(right.source).exec(after.slice(0, 10 + rightChars))
  return !!found && found.index <= 10
}

function sentenceHasHandsOn(sentence: string): boolean {
  const cover = /前盖|后盖|上盖|顶盖|侧盖|盖板|机盖|盖子|纸盒|纸盘|纸仓|纸匣|硒鼓|墨盒|粉盒/
  const jammed = /卡住的纸|被卡的纸|夹住的纸|残留的纸|卡在.{0,4}的纸|卡纸|残纸|碎纸|纸屑/
  const powerObj = /电源线|电源开关|电源|插头/
  const powerKey = /电源键|电源按钮|开关键|复位键|重启键/
  const device = /打印机|一体机|本机|机器(?!人)|设备/
  if (unguarded(sentence, /打开|掀开|拉开|翻开|抬起|拆开|拆下|卸下|取下|取出|抽出|拿出/g,
    (_verb, at, end) => nearObject(sentence, at, end, cover, 8, false))) return true
  if (unguarded(sentence, /抽出|取出|拉出|拽出|扯出|拔出|清除|清理|取掉/g,
    (_verb, at, end) => nearObject(sentence, at, end, jammed, 10, true))) return true
  if (unguarded(sentence, /拔掉|拔下|拔出|插拔|重新插|断开|切断|关闭|关掉/g,
    (verb, at, end) => (verb === '关闭' || verb === '关掉')
      ? powerObjectCounts(sentence, at, end, 8)
      : nearObject(sentence, at, end, powerObj, 8, false))) return true
  if (unguarded(sentence, /长按|按住|按下|按一下|按/g,
    (_verb, at, end) => nearObject(sentence, at, end, powerKey, 6, false))) return true
  if (unguarded(sentence, /重新启动|关机再开机|断电重启|重启/g,
    (_verb, at, end) => nearObject(sentence, at, end, device, 8, false))) return true
  if (unguarded(sentence, /关机/g, (_verb, _at, end) => withinTen(sentence.slice(end), /开机/, 2))) return true
  if (unguarded(sentence, /断电/g, (_verb, _at, end) => withinTen(sentence.slice(end), /通电|重新上电|开机/, 4))) return true
  if (unguarded(sentence, /长按|按住|按下|按一下|按/g, (_verb, at, end) => {
    const window = sentence.slice(at, end + 10)
    const placeAt = window.search(/机身|面板|打印机上|机器上/)
    if (placeAt < 0) return false
    return /按钮|键/.test(window.slice(placeAt))
  })) return true
  if (unguarded(sentence, /自行|自己|手动/g,
    (_verb, at, end) => nearObject(sentence, at, end, /更换硒鼓|更换墨盒|加碳粉|添加纸张|补充纸张|放入纸张|装入纸张|加墨|修理|维修|拆(?!成|分|解)/, 6, false))) return true
  return unguarded(sentence, /放入|装入|添加|补充|加入|放进/g,
    (_verb, at, end) => nearObject(sentence, at, end, /纸盒|纸盘|纸仓/, 6, false))
}

/** 模型回答里有没有教人动手处理机器。固定的话本身因为带「不要」不算。 */
export function hasHandsOnMachineInstruction(reply: string): boolean {
  const parts = reply.split(/[。！？!?；;\n]+/)
  for (const part of parts) {
    const sentence = normalizeFaultText(part)
    if (sentence && sentenceHasHandsOn(sentence)) return true
  }
  return false
}
