/**
 * 小青设备故障：输入侧只拦说得很明白的，输出侧兜底教人动手的回答，作业面同样拦。
 *
 * 不触网、不碰库（fetch 换成假实现；作业面用的库是验证库或临时库，用完删掉自己写的行）。
 * 运行：node -r @swc-node/register scripts/verify-assistant-device-fault-intercept.ts
 */
import 'dotenv/config'
import 'reflect-metadata'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import {
  DEVICE_FAULT_PROMPT_RULE,
  DEVICE_FAULT_SOURCE_NOTE,
  deviceFaultReply,
  hasHandsOnMachineInstruction,
  isAboutJobContent,
  isDeviceFaultQuestion,
} from '../src/ai/safety/device-fault'
import { LlmChatService, assistantOwnerKey } from '../src/ai/llm/llm-chat.service'
import { consumeSafetyRefund, clearSafetyBlocks, recentSafetyBlocks } from '../src/ai/safety/block-log'
import { ANONYMOUS_AI_CALLER, lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { AdvisorService } from '../src/advisor/advisor.service'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { ASSISTANT_SUMMARY_SYSTEM_PROMPT, AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { ADVISOR_DISCLAIMER } from '../src/advisor/advisor-skills'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

const KIOSK_REPLY =
  '机器卡纸、缺纸、打不出来或有其它故障时，请不要自己打开机器、拉扯纸张、按机身上的按键或拔插电源。机器暂时用不了的话，请稍后再来；需要帮助请看「帮助中心」里的联系方式。如果看到冒烟、闻到焦味或听到异常响声，请立刻离开机器；有明火或人身危险请拨打 119。'
const MINIAPP_REPLY =
  '一体机卡纸、缺纸、打不出来或有其它故障时，请不要自己打开机器、拉扯纸张、按机身上的按键或拔插电源。机器暂时用不了的话，请稍后再来；需要帮助可以在「意见反馈」里告诉我们。如果看到冒烟、闻到焦味或听到异常响声，请立刻离开机器；有明火或人身危险请拨打 119。'

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

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
  '闻到一股焦味',
  '漏电了',
  '打印机怎么打开前盖',
  '怎么重启这台机器',
  '打印到一半不动了',
  '帮我看看这台打印机，简历印到一半就停了',
  '扫描仪没反应',
  '硒鼓怎么换',
  '一体机死机了',
  '机器蓝屏了',
  '打印机报错',
  '出纸口不出纸',
  '我能自己把卡住的纸抽出来吗',
  '纸卡进去了',
  '打印纸没了',
  '打印机怎么加墨',
  '打印到一半卡住了',
  '打印机不吐纸',
  '打出来全是白纸',
  '打出来的纸是皱的',
  '点了打印没反应',
  '打印机亮红灯',
  '被电了一下',
  '机器很烫',
  '复印机坏掉了怎么修',
  '可以自己修打印机吗',
  '谁负责修这台打印机',
  '打 印 机 卡 纸 了',
  '当前咨询主题：打印帮助\n用户问题：卡纸了',
  '当前咨询主题：简历与求职材料\n用户问题：可以自己修打印机吗',
  '当前咨询主题：面试与沟通\n用户问题：可以自己修打印机吗',
  '当前咨询主题：岗位与选择\n用户问题：我想把打印机拆开看看',
  '当前咨询主题：入职与职场\n用户问题：怎么修这个机器',
  '打印机卡壳了',
  '复印机不走纸',
  '不进纸',
  '出来的纸是白的',
  '打出来是白的',
  '吐出半张',
  '冒白烟',
  '在冒黑烟',
  '一股烟',
  '纸卡到里头了',
  '卡、纸了',
  '打印机。坏了',
  '打印機卡紙了',
  'paper jam',
  '打印机 jam 了',
  'printer is broken',
  '打印机 error',
  '打印机卡纸了，我没经验',
  '打印机冒烟了，叫个工程师',
  '这玩意坏了',
  '它不工作了',
  '卡机了',
  '打印机一直转',
  '打印机不干活',
  '打印机黄灯亮了',
  '打印机卡只了',
  '纸用完了',
  '加纸',
  '装纸',
  '换纸',
  '机器卡了怎么办',
  '怎么没出纸',
  '打印出来是空白的',
  // 求职字样加上「这台、本机、正在打」仍是眼前这台，照拦。原表里已有的不算在这五句里。
  '我在写简历，可是这台打印机卡纸了怎么弄',
  '面试材料正在打，本机不出纸了',
  '简历里怎么写，但这台打印机卡纸了',
  '应聘的时候本机正在打，卡纸了怎么办',
  '面试官问我，可是这台机器现在冒烟了',
  '打印机怎么维修',
  '打印出来的字是歪的',
  '什么时候能修好',
  '我能自己修吗',
]

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
  '我的纸质简历卡在哪一步了',
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
  '我的U盘好像坏了读不出来',
  '我手机好像坏了',
  '被电话面试了怎么准备',
  '公司选拔线上面试怎么准备',
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
  '刚才面试官问我打印机卡纸怎么处理，我该怎么回答',
  '那我自己能弄吗',
  '教我怎么取',
  '没墨水味的纸是什么纸',
  '换墨镜好看吗',
  '加墨镜',
  '粉盒蛋糕怎么做',
  '墨盒笔和钢笔哪个好写',
  '碳粉是化工原料吗',
  '没有粉了面条怎么煮',
  '硒鼓销售好找工作吗',
  '我想找换碳粉的工作',
  '指示灯怎么看',
  '灯一直闪是不是要去医院',
  '错误码是啥',
  '我的订单显示故障',
  '我给他打了电话没反应',
  '我点了支付没反应',
  '我按了确认没反应',
  '我的优势没打出来',
  '心里话吐不出',
  '居住证打不出来怎么办',
  '工资条打不出来是公司不给开吗',
  '双面打印不了怎么设置',
  '政策规定无法打印彩色简历',
  '我一紧张脑子就冒烟',
  '这道菜有糊味正常吗',
  '耳朵嗡嗡的',
  '关节咔咔响',
  '滋滋冒油的烤肉',
  '漏电保护器是什么',
  '讨论一下子就烧起来了',
  '电脑重启一下试试',
  '关掉重开微信',
  '手机电源键在哪',
  '拔电线工是干什么的',
  '快递盖子打开了',
  '拆开手机外壳',
  '我心情坏了吧',
  '垃圾机器人太蠢了',
  '这破机器人',
  '纸巾破了',
  '夹纸板怎么用',
  '补纸质材料去哪办',
  '我想学修打印机',
  '手机屏幕碎了',
  '是不是坏了',
  '简历排版乱',
  '简历卡在第二页',
  '面试卡壳',
  '打印多少钱',
  '打成双面',
  '纸质简历怎么扫描',
  '打印机在哪里',
  '机器人会不会坏',
  '政策文件打不开',
  '缺一份纸质证明',
  '电源键在哪',
  '重启一下试试',
  '长按电源',
  '卡住了',
  '没反应',
  '一直转圈',
  '进度条一直转',
  '支付没反应',
  '坏了',
  '怎么重启',
  '烫得很',
  '灯在闪',
  '糊了',
  '白纸一张',
  '半张纸',
  '皱纸',
  '只出来一半',
  '黄灯亮了',
  '卡低了',
  '机器没声音',
  // 纯求职内容放行。原表里已有的不算在这五句里。
  '简历里怎么写负责处理打印机卡纸',
  '应聘设备维护岗，面试官问卡纸怎么排查，怎么回答',
  '怎么描述一段处理打印机缺纸的工作经历',
  '岗位要求里写了会处理卡纸，这段我该怎么写',
  '求职信里要不要提自己会换硒鼓',
  '这份简历打印出来有很多空白，怎么调整版式',
  '简历打出来有一大片空白',
  '我想在这台一体机上打印空白表格',
  '点了其它按钮没反应',
  '其它功能没反应',
  '学校有没有打印机维修专业',
  '工作压力大到冒烟',
  '身份证复印放歪了怎么重新印',
  '已经修好了，现在能打了吗',
  '我自己弄好了',
  '岗位要求：能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作能处理打印机卡纸并完成材料归档与接待记录填写工作',
]
const OUTPUT_MUST_REPLACE = [
  '您可以先打开前盖，看一下里面。',
  '您先掀开前盖就能看到卡纸。',
  '请拉开后盖检查一下。',
  '把上盖翻开即可。',
  '抬起顶盖就能看到硒鼓。',
  '拆开侧盖看一看。',
  '请卸下硒鼓检查。',
  '取下墨盒再装回去。',
  '打开纸盒看有没有纸。',
  '请把卡住的纸轻轻抽出来。',
  '取出卡纸后合上即可。',
  '拉出被卡的纸。',
  '拽出夹住的纸就好。',
  '清除残留的纸再打印。',
  '清理纸屑后再试一次。',
  '您可以先关闭打印机电源，然后打开前盖，轻轻把卡住的纸抽出来。',
  '请拔掉电源线等十秒。',
  '把插头拔下再插上。',
  '切断电源开关再打开。',
  '长按电源键十秒试试。',
  '按一下复位键。',
  '请重启打印机再试。',
  '把打印机重新启动一下。',
  '请按机身上的取消键。',
  '按下面板上的按钮。',
  '你可以自己更换硒鼓。',
  '请手动加碳粉。',
  '自行拆开检查一下。',
  '自己添加纸张就行。',
  '往纸盒里放入一些纸。',
  '请给纸盘补充纸张。',
  '在纸仓加入纸再打。',
  '不用担心，关掉电源，再打开前盖取出卡纸就好。',
  '不要慌，打开前盖取出卡纸即可。',
  '无需担心，先拔掉电源线，等一分钟再插上。',
  '不要紧，按一下机身上的电源键重启一下就好。',
  '别着急，打开前盖，把卡住的纸慢慢抽出来。',
  '不要打开前盖，请打开后盖把纸取出来。',
  '不要直接拔掉电源，先关闭电源再拔掉插头。',
  '把卡在里面的纸轻轻拉出来就好。',
  '清理进纸口卡住的纸就可以了。',
  '你可以按电源键尝试重启。',
  '请先关机，等一分钟后再开机。',
  '先将硒鼓取出，看看有没有异物。',
]

const OUTPUT_MUST_KEEP = [
  KIOSK_REPLY,
  MINIAPP_REPLY,
  '请不要自己打开机器，也不要拔电源，可以稍后再来。',
  '请不要自己打开前盖，也不要抽纸。',
  '不要拔掉电源。',
  '请勿自行拆开机器。',
  '不能自己更换硒鼓。',
  '不用打开纸盒。',
  '禁止按机身上的按键。',
  '打印完成后请从出纸口取走纸张。',
  '取走打印好的纸就可以了。',
  '在打印参数页可以选择双面打印。',
  '重启微信小程序再试一次。',
  '熟练处理打印机卡纸等常见办公设备故障',
  '建议把项目经历写成「做了什么、结果如何」，用数字说明规模，不要编造没做过的证书。',
  '就业补贴以当地人社部门公开发布的原文为准，可以到一体机首页查看本机构发布的政策，具体能不能办要看经办窗口的审核。',
  '您好，我是小青，可以帮你看简历、准备面试，也可以告诉你打印多少钱。',
  '这份简历建议把教育经历放在项目前面。',
  '模拟面试时先用一两句话介绍自己，再举一个例子。',
  '打印前可以在预览里看页数和清晰度。',
  '扫描件上传后可以在我的文档里找到。',
  '如果只是想知道价格，黑白和彩色的单价以页面上显示的为准。',
  '你可以把岗位要求里的关键词对应到自己的经历上。',
  '稍后再来就好，这次先不打印。',
  '请不要拉扯纸张，也不要拔插电源。',
  '帮助中心的联系方式在首页帮助中心里。',
  '取出纸张后请核对页数。',
  '别打开前盖，也别拔电源，稍后再来。',
  '打印完成后请及时取出文件，避免卡纸。',
  '面试前请关闭手机电源。',
  '别担心，请不要自己打开前盖，可以稍后再来。',
]

function duplicates(rows: readonly string[]): string[] {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of rows) {
    if (seen.has(row)) dup.push(row)
    seen.add(row)
  }
  return dup
}

function tableChecks(): void {
  const tables: Array<[string, readonly string[]]> = [
    ['MUST_INTERCEPT', MUST_INTERCEPT],
    ['MUST_NOT_INTERCEPT', MUST_NOT_INTERCEPT],
    ['OUTPUT_MUST_REPLACE', OUTPUT_MUST_REPLACE],
    ['OUTPUT_MUST_KEEP', OUTPUT_MUST_KEEP],
  ]
  for (const [name, rows] of tables) {
    check(rows.length > 0, `${name} 不是空表（${rows.length} 句）`)
    const dup = duplicates(rows)
    check(dup.length === 0, `${name} 没有重复句${dup.length ? `：${dup[0]}` : ''}`)
  }
  check(OUTPUT_MUST_REPLACE.length >= 25, `OUTPUT_MUST_REPLACE 至少 25 句（${OUTPUT_MUST_REPLACE.length}）`)
  check(OUTPUT_MUST_KEEP.length >= 25, `OUTPUT_MUST_KEEP 至少 25 句（${OUTPUT_MUST_KEEP.length}）`)
  const intercept = new Set(MUST_INTERCEPT)
  const keepOut = new Set(OUTPUT_MUST_KEEP)
  const bothIn = MUST_NOT_INTERCEPT.filter((row) => intercept.has(row))
  const bothOut = OUTPUT_MUST_REPLACE.filter((row) => keepOut.has(row))
  check(bothIn.length === 0, `输入侧两张表没有同一句${bothIn.length ? `：${bothIn[0]}` : ''}`)
  check(bothOut.length === 0, `输出侧两张表没有同一句${bothOut.length ? `：${bothOut[0]}` : ''}`)
  const interceptFollowUp = new Set(['什么时候能修好', '我能自己修吗'])
  const passFollowUp = new Set(['已经修好了，现在能打了吗', '我自己弄好了'])
  for (const row of MUST_INTERCEPT) {
    check(isDeviceFaultQuestion(row, interceptFollowUp.has(row)), `输入侧必须拦：${row.replace(/\n/g, ' / ')}`)
  }
  for (const row of MUST_NOT_INTERCEPT) {
    check(!isDeviceFaultQuestion(row, passFollowUp.has(row)), `输入侧不许拦：${row.replace(/\n/g, ' / ')}`)
  }
  for (const row of OUTPUT_MUST_REPLACE) {
    check(hasHandsOnMachineInstruction(row), `输出侧必须换掉：${row}`)
  }
  for (const row of OUTPUT_MUST_KEEP) {
    check(!hasHandsOnMachineInstruction(row), `输出侧不许动：${row.slice(0, 40)}`)
  }
  const longPosting = MUST_NOT_INTERCEPT[MUST_NOT_INTERCEPT.length - 1] ?? ''
  check(longPosting.includes('卡纸') && longPosting.includes('岗位要求') && longPosting.length > 160, '不许拦表最后一条是超过 160 字、带卡纸的岗位要求')
  const piece = '打印机卡纸了需要有人来看一下现场'
  const longPlain = piece.repeat(12)
  check(longPlain.length > 160 && !isDeviceFaultQuestion(longPlain), '超过 160 字、没有求职框定词的卡纸长文不拦')
  check(isDeviceFaultQuestion(piece), '同一句卡纸截短之后仍然拦')
}

const SOURCE_NOTE = '这是固定的安全提示，不是 AI 的判断。'

function countLiteral(dir: string, sentence: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'prisma') continue
      count += countLiteral(path, sentence)
    } else if (entry.name.endsWith('.ts')) {
      const text = readFileSync(path, 'utf8')
      let from = 0
      while (from < text.length) {
        const at = text.indexOf(sentence, from)
        if (at < 0) break
        count += 1
        from = at + sentence.length
      }
    }
  }
  return count
}

function wordingChecks(): void {
  check(DEVICE_FAULT_SOURCE_NOTE === SOURCE_NOTE, '出处说明常量逐字等于合规定的那句')
  check(countLiteral(join(process.cwd(), 'src'), SOURCE_NOTE) === 1, '出处说明在源码里只写一处')
  check(deviceFaultReply('kiosk') === KIOSK_REPLY, '一体机固定的话逐字等于原文')
  check(deviceFaultReply('miniapp') === MINIAPP_REPLY, '小程序固定的话逐字等于原文')
  for (const text of [KIOSK_REPLY, MINIAPP_REPLY]) {
    for (const banned of ['已经收到提醒', '会尽快处理', '换一台', '退款']) {
      check(!text.includes(banned), `固定的话不含「${banned}」`)
    }
    const digits = text.match(/\d+/g) ?? []
    check(digits.length === 1 && digits[0] === '119', '固定的话里除了 119 没有别的数字')
    check(!hasHandsOnMachineInstruction(text), '固定的话本身不被判成动手指导')
  }
}

function followUpChecks(): void {
  check(!isDeviceFaultQuestion('那我自己能弄吗', false) && isDeviceFaultQuestion('那我自己能弄吗', true), '追问只在上一轮刚回过固定的话时拦')
  check(!isDeviceFaultQuestion('教我怎么处理人际关系', true), '追问：教我怎么处理人际关系不算')
  check(!isDeviceFaultQuestion('怎么修改简历', true), '追问：怎么修改简历不算')
  check(!isDeviceFaultQuestion('那我自己来写吧', true), '追问：那我自己来写吧不算')
  check(isAboutJobContent('面试官问我打印机卡纸怎么处理，我该怎么答'), '求职内容：面试官问卡纸怎么答')
  check(!isAboutJobContent('打印机卡纸了，我没经验'), '单独的「经验」不算求职内容')
}

const HANDS_ON = '您可以先关闭打印机电源，然后打开前盖，轻轻把卡住的纸抽出来。'

interface SentBody { messages: Array<{ role: string; content: string }> }

const llmConfig = {
  vendor: 'openai', model: 'm', baseURL: 'http://127.0.0.1/v1', systemPrompt: '你是就业服务助手',
  roleScope: '', forbiddenWords: [] as string[], temperature: 0, enabled: true,
}
const configStub = {
  getApiKey: () => 'verify-key',
  getConfig: () => llmConfig,
  isReady: () => true,
}

let modelReply = '模型的回答'
let fetchThrows = false
const sent: SentBody[] = []
const replyQueue: string[] = []

function installFetch(): void {
  ;(globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => {
    if (fetchThrows) throw new Error('model down')
    sent.push(JSON.parse(String(init.body)) as SentBody)
    const content = replyQueue.shift() ?? modelReply
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } }),
    }
  }
}

const inRequest = <T>(fn: () => Promise<T>) =>
  runWithAiRequestContext(lazyAiRequestContext(async () => ({ ...ANONYMOUS_AI_CALLER })), fn)

async function captureWrites<T>(bucket: string[], fn: () => Promise<T>): Promise<T> {
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  const wrap = (orig: typeof process.stdout.write): typeof process.stdout.write => (chunk, ...rest) => {
    bucket.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return orig(chunk, ...rest)
  }
  process.stdout.write = wrap(origOut)
  process.stderr.write = wrap(origErr)
  try {
    return await fn()
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

async function chatRuntime(chat: LlmChatService): Promise<void> {
  clearSafetyBlocks()
  modelReply = '可以先在打印页上传文件。'
  const positiveBefore = sent.length
  const positive = await inRequest(async () => {
    const out = await chat.chat({ message: '怎么打印文件', channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund() }
  })
  check(sent.length === positiveBefore + 1, '阳性对照：正常咨询调了模型')
  check(positive.out.reply === '可以先在打印页上传文件。' && positive.out.fixedNotice !== true && positive.refund === false, '阳性对照：原样返回、没有 fixedNotice、不退次数')
  check(positive.out.actions?.some((action) => action.route === '/print/upload') === true, '阳性对照：打印跳转还在')

  modelReply = '模型的回答'
  const blockBefore = recentSafetyBlocks().length
  const inputBefore = sent.length
  const input = await inRequest(async () => {
    const out = await chat.chat({ message: '打印机卡纸怎么办', channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund(), blocks: recentSafetyBlocks().length }
  })
  check(sent.length === inputBefore, '输入侧命中：没发请求')
  check(input.out.reply === KIOSK_REPLY && input.out.fixedNotice === true, '输入侧命中：一体机固定的话，fixedNotice')
  check((input.out.actions ?? []).length === 0, '输入侧命中：不带跳转')
  check(input.refund === true, '输入侧命中：退次数')
  check(input.blocks === blockBefore, '输入侧命中：不记成内容拦截')
  const sessionId = input.out.sessionId

  const followBefore = sent.length
  const follow = await inRequest(async () => {
    const out = await chat.chat({ message: '那我自己能弄吗', sessionId, channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund() }
  })
  check(sent.length === followBefore && follow.out.reply === KIOSK_REPLY && follow.out.fixedNotice === true && follow.refund === true, '追问：不送模型，仍是固定的话，退次数')

  modelReply = '先看教育经历，再写一段项目。'
  const movedBefore = sent.length
  await inRequest(() => chat.chat({ message: '帮我看看简历怎么写', sessionId, channel: 'kiosk' }))
  const movedBody = JSON.stringify(sent[movedBefore]?.messages ?? [])
  check(movedBody.includes('帮我看看简历怎么写'), '换回正常话题：这一问送给了模型')
  check(!movedBody.includes('打印机卡纸怎么办') && !movedBody.includes('那我自己能弄吗') && !movedBody.includes('不要自己打开机器'), '换回正常话题：历史里没有那两问和固定的话')

  modelReply = '这句已经换话题了。'
  const laterBefore = sent.length
  const later = await inRequest(async () => {
    const out = await chat.chat({ message: '那我自己能弄吗', sessionId, channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund() }
  })
  check(sent.length === laterBefore + 1 && later.out.reply === '这句已经换话题了。' && later.out.fixedNotice !== true && later.refund === false, '换回正常话题后，同一句追问交给模型')

  const prefixBefore = sent.length
  const prefix = await inRequest(async () => {
    const out = await chat.chat({ message: '当前咨询主题：简历与求职材料\n用户问题：没纸了', channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund() }
  })
  check(sent.length === prefixBefore && prefix.out.reply === KIOSK_REPLY && prefix.refund === true, '去掉咨询主题前缀后，没纸了仍然拦')

  const mini = await inRequest(async () => chat.chat({ message: '一体机卡纸了', channel: 'miniapp' }))
  check(mini.reply === MINIAPP_REPLY && mini.fixedNotice === true, '小程序渠道拿到小程序那段')

  fetchThrows = true
  let normalThrew = false
  try {
    await inRequest(() => chat.chat({ message: '怎么打印文件', channel: 'kiosk' }))
  } catch {
    normalThrew = true
  }
  const down = await inRequest(async () => {
    const out = await chat.chat({ message: '机器冒烟了', channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund() }
  })
  fetchThrows = false
  check(normalThrew, '模型连不上：正常咨询照样失败')
  check(down.out.reply === KIOSK_REPLY && down.out.fixedNotice === true && down.refund === true, '模型连不上：故障求助照样能答并退次数')

  modelReply = HANDS_ON
  const outBefore = sent.length
  const outLogs: string[] = []
  const replaced = await captureWrites(outLogs, () => inRequest(async () => {
    const out = await chat.chat({ message: '卡住了怎么办', channel: 'kiosk' })
    return { out, refund: consumeSafetyRefund() }
  }))
  const outLogText = outLogs.join('')
  check(sent.length === outBefore + 1, '输出侧：确实发了请求')
  check(replaced.out.reply === KIOSK_REPLY && replaced.out.fixedNotice === true, '输出侧：换成固定的话，fixedNotice')
  check((replaced.out.actions ?? []).length === 0, '输出侧：不带跳转')
  check(replaced.refund === false, '输出侧命中不退次数')
  check(outLogText.includes('模型回答含动手指导，已换成固定回答 channel=kiosk'), '输出侧：只记一行不含内容的日志')
  check(!outLogText.includes(HANDS_ON) && !outLogText.includes('打开前盖') && !outLogText.includes('卡住了怎么办'), '输出侧：日志里没有动手指导和用户原话')
  modelReply = '下一轮正常回答。'
  const nextBefore = sent.length
  await inRequest(() => chat.chat({ message: '好的，先看简历', sessionId: replaced.out.sessionId, channel: 'kiosk' }))
  const nextBody = JSON.stringify(sent[nextBefore]?.messages ?? [])
  check(nextBody.includes(KIOSK_REPLY) && !nextBody.includes('打开前盖') && !nextBody.includes(HANDS_ON), '输出侧：下一轮历史里是固定的话，不是教人开盖的话')
  check(!nextBody.includes(HANDS_ON), '输出侧：会话历史没有假模型的动手指导')

  for (const message of ['面试官问我怎么处理打印机卡纸，我该怎么答', '面试官问我打印机卡纸怎么处理，我该怎么答']) {
    modelReply = HANDS_ON
    const jobBefore = sent.length
    const job = await inRequest(async () => {
      const out = await chat.chat({ message, channel: 'kiosk' })
      return { out, refund: consumeSafetyRefund() }
    })
    const jobBody = JSON.stringify(sent[jobBefore]?.messages ?? [])
    check(sent.length === jobBefore + 1, `求职内容仍调模型：${message}`)
    check(jobBody.includes(DEVICE_FAULT_PROMPT_RULE), `求职内容的请求里仍有约束句：${message}`)
    check(job.out.reply === HANDS_ON && job.out.fixedNotice !== true && job.refund === false, `求职内容两头都不拦：${message}`)
  }
}

async function advisorRuntime(): Promise<void> {
  if (process.env['DATABASE_URL']) assertIsolatedVerificationDatabase()
  const fallbackDbDir = process.env['DATABASE_URL'] ? null : mkdtempSync(join(tmpdir(), 'verify-device-fault-'))
  if (fallbackDbDir) process.env['DATABASE_URL'] = `file:${join(fallbackDbDir, 'verify.db')}`
  if (fallbackDbDir) {
    const client = createClient({ url: process.env['DATABASE_URL']! })
    try {
      await client.batch([
        `CREATE TABLE "EndUser" ("id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "wxOpenId" TEXT, "nickname" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'active', "statusChangedAt" DATETIME, "closingRequestedAt" DATETIME, "anonymizedAt" DATETIME, "lastLoginAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
        `CREATE TABLE "AuditLog" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT, "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE "AiServiceLog" ("id" TEXT NOT NULL PRIMARY KEY, "operation" TEXT NOT NULL, "provider" TEXT, "status" TEXT NOT NULL, "latencyMs" INTEGER, "errorCode" TEXT, "tokenUsageJson" TEXT NOT NULL DEFAULT '{}', "estimatedCostCny" REAL, "terminalId" TEXT, "endUserId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE "AdvisorSession" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT, "accessTokenHash" TEXT, "skill" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'collecting', "topic" TEXT NOT NULL, "skillReason" TEXT, "skillSource" TEXT NOT NULL DEFAULT 'llm', "slotsJson" TEXT NOT NULL DEFAULT '{}', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL)`,
        `CREATE INDEX "AdvisorSession_endUserId_createdAt_idx" ON "AdvisorSession"("endUserId","createdAt")`,
        `CREATE TABLE "AdvisorPin" ("id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "idx" INTEGER NOT NULL, "content" TEXT NOT NULL, "evidenceLevel" TEXT NOT NULL, "sourceNote" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE "AdvisorArtifact" ("id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'completed', "payloadJson" TEXT NOT NULL, "provider" TEXT NOT NULL, "fileId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL)`,
      ])
    } finally {
      client.close()
    }
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const aiLog = new AiLogService(prisma)
  const advisorLlm = new LlmAdvisorService(configStub as never)
  const artifacts = {
    listForSession: async () => [],
    save: async () => ({ artifactId: 'art_device_fault' }),
    print: async () => {
      const error = new Error('font') as Error & { getResponse: () => { error: { code: string } } }
      error.getResponse = () => ({ error: { code: 'ADVISOR_PDF_FONT_NOT_FOUND' } })
      throw error
    },
  }
  const advisor = new AdvisorService(prisma, advisorLlm, artifacts as never, audit, aiLog)
  const memoryOf = (sessionId: string) =>
    (advisor as unknown as { qaMemory: { read: (id: string) => Array<{ role: string; content: string }> } }).qaMemory.read(sessionId)
  const createdIds: string[] = []
  let createdEndUserId: string | undefined
  const aiLogIdsBefore = new Set((await prisma.aiServiceLog.findMany({ select: { id: true } })).map((row) => row.id))
  const classifyJson = JSON.stringify({ skill: 'qa', reason: '你在问一个拿不准的判断。' })
  const normalJson = JSON.stringify({
    answer: '空窗期可以在简历里用一两句话说明当时在做什么。',
    evidenceLevel: 'E3',
    sourceNote: '这是通行做法，算参考。',
  })
  const handsJson = JSON.stringify({
    answer: HANDS_ON,
    evidenceLevel: 'E1',
    sourceNote: '这是通行做法，算参考。',
  })

  async function openQa(): Promise<{ sessionId: string; accessToken: string }> {
    replyQueue.push(classifyJson)
    const created = await advisor.createSession('要不要解释空窗期', { endUserId: null, accessToken: null })
    createdIds.push(created.sessionId)
    await aiLog.flush()
    check(created.skill === 'qa' && typeof created.accessToken === 'string', '作业面：建出问答型会话')
    return { sessionId: created.sessionId, accessToken: created.accessToken! }
  }

  try {
    const first = await openQa()
    const requester = { endUserId: null, accessToken: first.accessToken }
    const logsBefore = (await prisma.aiServiceLog.findMany({ select: { id: true } })).map((row) => row.id)
    const askBefore = sent.length
    modelReply = normalJson
    const blocked = await advisor.ask(first.sessionId, '打印机卡纸怎么办', requester)
    await aiLog.flush()
    const logsAfter = await prisma.aiServiceLog.findMany({ select: { id: true } })
    check(sent.length === askBefore, '作业面输入侧：没有调模型')
    check(blocked.answer === KIOSK_REPLY && blocked.evidenceLevel === 'E3', '作业面输入侧：回答是一体机固定的话，证据等级 E3')
    check(blocked.sourceNote === SOURCE_NOTE && blocked.sourceNote === DEVICE_FAULT_SOURCE_NOTE && blocked.disclaimer === ADVISOR_DISCLAIMER, '作业面输入侧：出处说明和免责声明')
    check(blocked.canPin === false && blocked.fixedNotice === true && blocked.persistence === 'not_saved', '作业面输入侧：不能钉住，fixedNotice')
    check(typeof blocked.providerLabel === 'string' && blocked.providerLabel.startsWith('llm:'), '作业面输入侧：其余字段仍有 providerLabel')
    check(memoryOf(first.sessionId).length === 0, '作业面输入侧：内存里没留')
    check(logsAfter.every((row) => logsBefore.includes(row.id)), '作业面输入侧：不落 AI 日志')

    const second = await openQa()
    const outBefore = sent.length
    const logsMid = (await prisma.aiServiceLog.findMany({ select: { id: true } })).map((row) => row.id)
    replyQueue.push(handsJson)
    const replaced = await advisor.ask(second.sessionId, '卡住了怎么办', { endUserId: null, accessToken: second.accessToken })
    await aiLog.flush()
    const added = (await prisma.aiServiceLog.findMany()).filter((row) => !logsMid.includes(row.id))
    check(sent.length === outBefore + 1, '作业面输出侧：调了模型')
    check(replaced.answer === KIOSK_REPLY && replaced.sourceNote === SOURCE_NOTE, '作业面输出侧：回答换成固定的话')
    check(replaced.evidenceLevel === 'E3', '作业面输出侧：动手指导换成固定的话时，证据等级是 E3')
    check(replaced.canPin === false && replaced.fixedNotice === true, '作业面输出侧：不能钉住，fixedNotice')
    const remembered = memoryOf(second.sessionId)
    const rememberedText = JSON.stringify(remembered)
    check(remembered.length === 2 && remembered[1]?.content === KIOSK_REPLY && !rememberedText.includes(HANDS_ON) && !rememberedText.includes('打开前盖'), '作业面输出侧：内存里留的是固定的话，没有动手指导')
    const addedText = JSON.stringify(added)
    check(added.length === 1 && added[0]?.status === 'success', '作业面输出侧：AI 日志照常记成功')
    check(!addedText.includes(HANDS_ON) && !addedText.includes('打开前盖') && !addedText.includes('卡住了怎么办'), '作业面输出侧：AI 日志没有动手指导和用户原话')
    const audits = await prisma.auditLog.findMany({ where: { targetId: second.sessionId } })
    const auditText = JSON.stringify(audits)
    check(!auditText.includes(HANDS_ON) && !auditText.includes('卡住了怎么办'), '作业面输出侧：审计里没有动手指导和用户原话')

    const third = await openQa()
    const normalBefore = sent.length
    replyQueue.push(normalJson)
    const normal = await advisor.ask(third.sessionId, '要不要解释空窗期', { endUserId: null, accessToken: third.accessToken })
    check(sent.length === normalBefore + 1, '作业面正常问答：调了模型')
    check(normal.answer === '空窗期可以在简历里用一两句话说明当时在做什么。' && normal.canPin === true && normal.fixedNotice !== true, '作业面正常问答：原样返回，可以钉住，没有 fixedNotice')
    check(memoryOf(third.sessionId).some((turn) => turn.content.includes('空窗期')), '作业面正常问答：内存里留的是模型的话')

    const jobAsk = '面试官问我怎么处理打印机卡纸，我该怎么答'
    const fourth = await openQa()
    const jobAskBefore = sent.length
    replyQueue.push(handsJson)
    const jobAnswer = await advisor.ask(fourth.sessionId, jobAsk, { endUserId: null, accessToken: fourth.accessToken })
    const jobAskBody = JSON.stringify(sent[jobAskBefore]?.messages ?? [])
    check(sent.length === jobAskBefore + 1, '作业面求职内容：调了模型')
    check(jobAskBody.includes(DEVICE_FAULT_PROMPT_RULE), '作业面求职内容：请求里仍有约束句')
    check(jobAnswer.answer === HANDS_ON && jobAnswer.fixedNotice !== true && jobAnswer.canPin === true, '作业面求职内容：两头都不拦，没有 fixedNotice')

    const chat = new LlmChatService(configStub as never)
    createdEndUserId = `eu_fault_${Date.now()}`
    const endUserId = createdEndUserId
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: endUserId, phoneEnc: endUserId, nickname: 'verify' } })
    modelReply = '先看教育经历，再写一段项目。'
    const chatted = await inRequest(() => chat.chat({ message: '帮我看看简历怎么写', channel: 'kiosk' }, undefined, assistantOwnerKey(endUserId, null)))
    const summary = new AssistantSummaryService(prisma, chat, configStub as never, artifacts as never, audit, aiLog)
    modelReply = JSON.stringify({
      highlights: ['先把教育经历放在前面。', '您可以先打开前盖，看一下里面。', '面试时用一两句话介绍自己。'],
      todos: ['把项目经历补上结果。', '请重启打印机再试。'],
    })
    const summaryBefore = sent.length
    const view = await summary.summarize(chatted.sessionId, endUserId, null)
    createdIds.push(view.advisorSessionId)
    const summaryBody = JSON.stringify(sent[summaryBefore]?.messages ?? [])
    check(summaryBody.includes(DEVICE_FAULT_PROMPT_RULE), '本次要点：发给模型的提示词里有约束句')
    check(ASSISTANT_SUMMARY_SYSTEM_PROMPT.includes(DEVICE_FAULT_PROMPT_RULE), '本次要点：提示词常量里有约束句')
    check(ASSISTANT_SUMMARY_SYSTEM_PROMPT.indexOf(DEVICE_FAULT_PROMPT_RULE) < ASSISTANT_SUMMARY_SYSTEM_PROMPT.indexOf('只输出 JSON'), '本次要点：约束句排在输出格式要求前面')
    check(view.highlights.includes('先把教育经历放在前面。') && view.highlights.includes('面试时用一两句话介绍自己。'), '本次要点：没教人动手的要点还在')
    check(!view.highlights.some((line) => line.includes('打开前盖')), '本次要点：教人开盖的那一条没了')
    check(view.todos.includes('把项目经历补上结果。') && !view.todos.some((line) => line.includes('重启打印机')), '本次要点：待办里教人重启的那一条没了，别的还在')
  } finally {
    if (createdIds.length > 0) {
      await prisma.advisorArtifact.deleteMany({ where: { sessionId: { in: createdIds } } })
      await prisma.advisorSession.deleteMany({ where: { id: { in: createdIds } } })
      await prisma.auditLog.deleteMany({ where: { targetId: { in: createdIds } } })
    }
    const leftoverLogs = (await prisma.aiServiceLog.findMany({ select: { id: true } }))
      .map((row) => row.id)
      .filter((id) => !aiLogIdsBefore.has(id))
    if (leftoverLogs.length > 0) {
      await prisma.aiServiceLog.deleteMany({ where: { id: { in: leftoverLogs } } })
    }
    if (createdEndUserId) await prisma.endUser.deleteMany({ where: { id: createdEndUserId } })
    await prisma.onModuleDestroy()
    if (fallbackDbDir) rmSync(fallbackDbDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  console.log('\n=== 小青设备故障：输入侧收窄、输出侧兜底 ===')
  wordingChecks()
  tableChecks()
  followUpChecks()
  const savedFetch = globalThis.fetch
  installFetch()
  try {
    const chat = new LlmChatService(configStub as never)
    await chatRuntime(chat)
    await advisorRuntime()
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = savedFetch
  }
  console.log(`\nverify:assistant-device-fault-intercept ${failCount === 0 ? '通过' : '未通过'}：PASS ${passCount} / FAIL ${failCount}`)
  if (failCount > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
