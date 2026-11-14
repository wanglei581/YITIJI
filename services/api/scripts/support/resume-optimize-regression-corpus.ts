import type { GeneratedResume } from '../../src/ai/interfaces/ai-provider.interface'
import { alignOriginalList } from '../../src/ai/resume/resume-optimize-list-align'
import { ensureProjectOriginalLines } from '../../src/ai/resume/resume-optimize-project-align'

/**
 * 历轮收货里「该修且已修好」的最小复现。每条注明出自哪一轮哪个日志。
 * 观察项和另立项（日期在角色前、短句被长句吞、期次当角色、岗位栏名、MCU 碎片、负责人并进版本括号）不收。
 * 由 verify:resume-optimize 调起。
 */

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

type Mod = { before: string; after: string }

type ListCase = {
  id: string
  source: string
  lines: string[]
  model: string[]
  expected: string[]
  coveredElsewhere?: string[]
  modules?: Mod[]
}

type ProjectCase = {
  id: string
  source: string
  lines: string[]
  project: { name: string; role?: string; description: string }
  modules?: Mod[]
  name: string
  role: string
  description?: string
}

const LIST: ListCase[] = [
  { id: 'R-1', source: 'r1/exp-own17/min-repro（和只交一部分，丢项已修）', lines: ['熟练使用Excel、Word和PPT'], model: ['熟练使用Excel', 'Word'], expected: ['熟练使用Excel', 'Word和PPT'] },
  { id: 'R-2', source: 'r1/exp-own17/min-repro（证书 Adobe Photoshop 吞掉技能，已修）', lines: ['Photoshop', 'Illustrator'], model: ['Photoshop', 'Illustrator'], expected: ['Photoshop', 'Illustrator'], coveredElsewhere: ['Adobe Photoshop 认证'] },
  { id: 'N1', source: 'r1/exp-own17/numbered-semicolon-3ver.log N1', lines: ['1. 初级会计职称; 2. 全国计算机等级考试二级'], model: ['初级会计职称', '全国计算机等级考试二级'], expected: ['初级会计职称', '全国计算机等级考试二级'] },
  { id: 'N2', source: 'r1/exp-own17/numbered-semicolon-3ver.log N2', lines: ['1. 初级会计职称；2. 全国计算机等级考试二级'], model: ['初级会计职称', '全国计算机等级考试二级'], expected: ['初级会计职称', '全国计算机等级考试二级'] },
  { id: 'N3', source: 'r1/exp-own17/numbered-semicolon-3ver.log N3', lines: ['1. 初级会计职称 2. 全国计算机等级考试二级'], model: ['初级会计职称', '全国计算机等级考试二级'], expected: ['初级会计职称', '全国计算机等级考试二级'] },
  { id: 'N4', source: 'r1/exp-own17/numbered-semicolon-3ver.log N4', lines: ['1. 初级会计职称 / 2. 全国计算机等级考试二级'], model: ['初级会计职称', '全国计算机等级考试二级'], expected: ['初级会计职称', '全国计算机等级考试二级'] },
  { id: 'N5', source: 'r1/exp-own17/numbered-semicolon-3ver.log N5', lines: ['初级会计职称; 全国计算机等级考试二级'], model: ['初级会计职称', '全国计算机等级考试二级'], expected: ['初级会计职称', '全国计算机等级考试二级'] },
  { id: 'G1', source: 'r1/exp-own17/agy17-verify-3ver.log G1', lines: ['Java', 'Spring Boot'], model: ['Java', 'Spring Boot'], expected: ['Java', 'Spring Boot'], coveredElsewhere: ['全国计算机等级考试 二级 Java'] },
  { id: 'G6', source: 'r1/exp-own17/agy17-verify-3ver.log G6', lines: ['1. 熟练掌握SQL，2. 熟悉Linux操作'], model: ['熟练掌握SQL'], expected: ['熟练掌握SQL', '熟悉Linux操作'] },
  { id: 'G7', source: 'r1/exp-own17/agy17-verify-3ver.log G7', lines: ['掌握前端开发，熟悉React与Angular'], model: ['掌握前端开发', '熟悉React'], expected: ['掌握前端开发', '熟悉React与Angular'] },
  { id: 'G8', source: 'r1/exp-own17/agy17-verify-3ver.log G8', lines: ['1）熟练掌握Java开发'], model: ['精通Java核心架构研发'], expected: ['精通Java核心架构研发'], modules: [{ before: '熟练掌握Java开发', after: '精通Java核心架构研发' }] },
  { id: 'G10', source: 'r1/exp-own17/agy17-verify-3ver.log G10', lines: ['初级会计职称; 全国计算机等级考试二级'], model: ['全国计算机等级考试二级'], expected: ['初级会计职称; 全国计算机等级考试二级'] },
  { id: 'C1', source: 'r1h/own-probe2-3ver.log C1；r1h/num-dun-3ver.log 全交', lines: ['1、Excel，2、Word'], model: ['Excel', 'Word'], expected: ['Excel', 'Word'] },
  { id: 'C1b', source: 'r1h/num-dun-3ver.log 只交前一项', lines: ['1、Excel，2、Word'], model: ['Excel'], expected: ['Excel', 'Word'] },
  { id: 'C2', source: 'r1h/own-probe2-3ver.log C2；r1h/num-dun-3ver.log 分号漏中间', lines: ['1、Excel；2、Word；3、PPT'], model: ['Excel', 'PPT'], expected: ['Excel', 'Word', 'PPT'] },
  { id: 'C3', source: 'r1h/num-dun-3ver.log 分号全交', lines: ['1、Excel；2、Word；3、PPT'], model: ['Excel', 'Word', 'PPT'], expected: ['Excel', 'Word', 'PPT'] },
  { id: 'C4', source: 'r1h/num-dun-3ver.log 全不交', lines: ['1、Excel；2、Word', 'SQL'], model: ['SQL'], expected: ['Excel；2、Word', 'SQL'] },
  { id: 'C5', source: 'r1h/num-dun-3ver.log 句子', lines: ['1、熟练使用Excel数据透视表；2、熟悉SQL查询'], model: ['熟练使用Excel数据透视表', '熟悉SQL查询'], expected: ['熟练使用Excel数据透视表', '熟悉SQL查询'] },
  { id: 'S1', source: 'r1i/own-probe-r1i-3ver.log S1；r1h/agy/agy-verify-3ver.log agy1b', lines: ['熟悉CI/CD与Docker'], model: ['CI/CD', 'Docker'], expected: ['CI/CD', 'Docker'] },
  { id: 'S2', source: 'r1i/own-probe-r1i-3ver.log S2', lines: ['熟悉TCP/IP与HTTP'], model: ['TCP/IP', 'HTTP'], expected: ['TCP/IP', 'HTTP'] },
  { id: 'S3', source: 'r1i/own-probe-r1i-3ver.log S3', lines: ['熟悉TCP/IP和HTTP协议'], model: ['TCP/IP', 'HTTP协议'], expected: ['TCP/IP', 'HTTP协议'] },
  { id: 'S4', source: 'r1i/own-probe-r1i-3ver.log S4', lines: ['掌握HTML/CSS/JavaScript'], model: ['HTML/CSS', 'JavaScript'], expected: ['HTML/CSS', 'JavaScript'] },
  { id: 'S6', source: 'r1i/own-probe-r1i-3ver.log S6', lines: ['熟悉Linux/Unix与Shell脚本'], model: ['Linux/Unix', 'Shell脚本'], expected: ['Linux/Unix', 'Shell脚本'] },
  { id: 'S7', source: 'r1i/own-probe-r1i-3ver.log S7', lines: ['熟悉 CI/CD 与 Docker'], model: ['CI/CD', 'Docker'], expected: ['CI/CD', 'Docker'] },
  { id: 'S10', source: 'r1i/own-probe-r1i-3ver.log S10', lines: ['熟悉CI/CD与Docker'], model: ['熟悉CI/CD', 'Docker'], expected: ['熟悉CI/CD', 'Docker'] },
  { id: 'S11', source: 'r1i/own-probe-r1i-3ver.log S11', lines: ['CI/CD、Docker'], model: ['CI/CD', 'Docker'], expected: ['CI/CD', 'Docker'] },
  { id: 'S15', source: 'r1i/own-probe-r1i-3ver.log S15', lines: ['UI/UX设计与Figma'], model: ['UI/UX设计', 'Figma'], expected: ['UI/UX设计', 'Figma'] },
  { id: 'S16', source: 'r1i/own-probe-r1i-3ver.log S16；r1h/agy/agy-verify-3ver.log agy2', lines: ['沟通能力与亲和力'], model: ['沟通能力', '亲和力'], expected: ['沟通能力', '亲和力'] },
  { id: 'S17', source: 'r1i/own-probe-r1i-3ver.log S17；r1h/agy/agy-verify-3ver.log agy3', lines: ['问题排查与及时响应'], model: ['问题排查', '及时响应'], expected: ['问题排查', '及时响应'] },
  { id: 'S18', source: 'r1i/own-probe-r1i-3ver.log S18', lines: ['Photoshop/Illustrator'], model: ['Photoshop', 'Illustrator'], expected: ['Photoshop', 'Illustrator'] },
  { id: 'S20', source: 'r1i/own-probe-r1i-3ver.log S20', lines: ['熟悉CI/CD与Docker、K8s'], model: ['CI/CD', 'Docker', 'K8s'], expected: ['CI/CD', 'Docker', 'K8s'] },
  { id: 'S21', source: 'r1i/own-probe-r1i-3ver.log S21', lines: ['熟悉CI/CD与Docker'], model: ['CI/CD', 'Docker', 'Kubernetes'], expected: ['CI/CD', 'Docker'] },
  { id: 'S23', source: 'r1i/own-probe-r1i-3ver.log S23', lines: ['CET-4/CET-6'], model: ['CET-4', 'CET-6'], expected: ['CET-4', 'CET-6'] },
  { id: 'D1', source: 'r1i/own-probe-r1i-3ver.log D1；r1h/own-probe2-3ver.log D1', lines: ['Maya、2.5D动画制作'], model: ['Maya'], expected: ['Maya', '2.5D动画制作'] },
  { id: 'D2', source: 'r1i/own-probe-r1i-3ver.log D2；r1h/own-probe2-3ver.log D2', lines: ['Unity、3.0版本迁移'], model: ['Unity'], expected: ['Unity', '3.0版本迁移'] },
  { id: 'D3', source: 'r1i/own-probe-r1i-3ver.log D3', lines: ['Office、3.5寸'], model: ['Office'], expected: ['Office', '3.5寸'] },
  { id: 'D4', source: 'r1i/own-probe-r1i-3ver.log D4', lines: ['Vue2.x、Vue3.0'], model: ['Vue2.x'], expected: ['Vue2.x', 'Vue3.0'] },
  { id: 'D5', source: 'r1i/own-probe-r1i-3ver.log D5', lines: ['Python3.8、Django2.2'], model: ['Python3.8'], expected: ['Python3.8', 'Django2.2'] },
  { id: 'D6', source: 'r1i/own-probe-r1i-3ver.log D6', lines: ['Office、3.5寸', 'Excel'], model: ['Excel'], expected: ['Office、3.5寸', 'Excel'] },
  { id: 'D7', source: 'r1i/own-probe-r1i-3ver.log D7；r1h/own-probe2-3ver.log D3 小数不剥', lines: ['2.5D动画制作', 'Maya'], model: ['Maya'], expected: ['2.5D动画制作', 'Maya'] },
  { id: 'D8', source: 'r1i/own-probe-r1i-3ver.log D8', lines: ['3.5寸软盘读写、Office'], model: ['Office'], expected: ['3.5寸软盘读写', 'Office'] },
  { id: 'D9', source: 'r1i/own-probe-r1i-3ver.log D9', lines: ['Maya、2.5D动画制作、3ds Max'], model: ['Maya', '3ds Max'], expected: ['Maya', '2.5D动画制作', '3ds Max'] },
  { id: 'D10', source: 'r1i/own-probe-r1i-3ver.log D10', lines: ['2.5D动画制作、Maya'], model: ['Maya'], expected: ['2.5D动画制作', 'Maya'] },
  { id: 'Y1', source: 'r1i/e2e-index-year-3ver.log Y1；r1i/own-probe-r1i-3ver.log D11', lines: ['1.2021年获得初级会计职称', '2.2022年通过英语六级'], model: ['2021年获得初级会计职称', '2022年通过英语六级'], expected: ['2021年获得初级会计职称', '2022年通过英语六级'] },
  { id: 'Y2', source: 'r1i/e2e-index-year-3ver.log Y2', lines: ['1.2021年获得初级会计职称', '2.2022年通过英语六级'], model: ['2021年获得初级会计职称'], expected: ['2021年获得初级会计职称', '2022年通过英语六级'] },
  { id: 'Y3', source: 'r1i/e2e-index-year-3ver.log Y3；r1i/own-probe-r1i-3ver.log D13', lines: ['1）2021年获得初级会计职称', '2）2022年通过英语六级'], model: ['2021年获得初级会计职称', '2022年通过英语六级'], expected: ['2021年获得初级会计职称', '2022年通过英语六级'] },
  { id: 'Y4', source: 'r1i/e2e-index-year-3ver.log Y4；r1i/own-probe-r1i-3ver.log D14', lines: ['1．2021年获得初级会计职称', '2．2022年通过英语六级'], model: ['2021年获得初级会计职称', '2022年通过英语六级'], expected: ['2021年获得初级会计职称', '2022年通过英语六级'] },
  { id: 'Y5', source: 'r1i/e2e-index-year-3ver.log Y5；r1i/own-probe-r1i-3ver.log D15', lines: ['1.2019.06 全国大学英语六级', '2.2020.09 初级会计职称'], model: ['2019.06 全国大学英语六级', '2020.09 初级会计职称'], expected: ['2019.06 全国大学英语六级', '2020.09 初级会计职称'] },
  { id: 'Y6', source: 'r1i/e2e-index-year-3ver.log Y6；r1i/own-probe-r1i-3ver.log D12', lines: ['1、2021年获得初级会计职称', '2、2022年通过英语六级'], model: ['2021年获得初级会计职称', '2022年通过英语六级'], expected: ['2021年获得初级会计职称', '2022年通过英语六级'] },
  { id: 'M1', source: 'r1i/module-index-year-3ver.log M1', lines: ['1.2021年获得初级会计职称', '2.2022年通过英语六级'], model: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], expected: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], modules: [{ before: '2021年获得初级会计职称', after: '2021年取得初级会计专业技术资格' }] },
  { id: 'M2', source: 'r1i/module-index-year-3ver.log M2', lines: ['1.2021年获得初级会计职称', '2.2022年通过英语六级'], model: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], expected: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], modules: [{ before: '1.2021年获得初级会计职称', after: '2021年取得初级会计专业技术资格' }] },
  { id: 'M3', source: 'r1i/module-index-year-3ver.log M3', lines: ['1、2021年获得初级会计职称', '2、2022年通过英语六级'], model: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], expected: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], modules: [{ before: '2021年获得初级会计职称', after: '2021年取得初级会计专业技术资格' }] },
  { id: 'M4', source: 'r1i/module-index-year-3ver.log M4', lines: ['1）2021年获得初级会计职称', '2）2022年通过英语六级'], model: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], expected: ['2021年取得初级会计专业技术资格', '2022年通过英语六级'], modules: [{ before: '2021年获得初级会计职称', after: '2021年取得初级会计专业技术资格' }] },
  { id: 'D17', source: 'r1i/own-probe-r1i-3ver.log D17', lines: ['1. 2021年获得初级会计职称', '2. 2022年通过英语六级'], model: ['2021年获得初级会计职称', '2022年通过英语六级'], expected: ['2021年获得初级会计职称', '2022年通过英语六级'] },
  { id: 'D18', source: 'r1i/own-probe-r1i-3ver.log D18', lines: ['1. 2.5D动画制作', '2. Maya'], model: ['2.5D动画制作', 'Maya'], expected: ['2.5D动画制作', 'Maya'] },
  { id: 'D19', source: 'r1i/own-probe-r1i-3ver.log D19', lines: ['1、Excel，2、Word'], model: ['Excel'], expected: ['Excel', 'Word'] },
  { id: 'agy2', source: 'r1i/agy/agy-verify-3ver.log agy2（不成套，编号留下）', lines: ['1、3D角色建模与渲染', 'Maya'], model: ['Maya'], expected: ['1、3D角色建模与渲染', 'Maya'] },
  { id: 'agy2b', source: 'r1i/agy/agy-verify-3ver.log agy2b（不成套，1.3D 留下）', lines: ['1.3D角色建模', 'Maya'], model: ['Maya'], expected: ['1.3D角色建模', 'Maya'] },
  { id: 'agy3', source: 'r1i/agy/agy-verify-3ver.log agy3', lines: ['精通 3、4、5 轴数控机床加工'], model: ['3轴加工', '4轴加工', '5轴加工'], expected: ['精通 3、4、5 轴数控机床加工'] },
  { id: 'agy6', source: 'r1i/agy/agy-verify-3ver.log agy6（不成套，1）留下）', lines: ['1）2D动画设计师证', '初级会计职称'], model: ['初级会计职称'], expected: ['1）2D动画设计师证', '初级会计职称'] },
  { id: 'agy8slash', source: 'r1h/agy/agy-verify-3ver.log agy8 模型交齐', lines: ['1. 初级会计职称 / 2. 全国计算机等级考试二级'], model: ['初级会计职称', '全国计算机等级考试二级'], expected: ['初级会计职称', '全国计算机等级考试二级'] },
  { id: 'agy9', source: 'r1h/agy/agy-verify-3ver.log agy9', lines: ['熟练掌握Vue以及React'], model: ['Vue', 'React'], expected: ['熟练掌握Vue以及React'] },
  { id: 'agy10', source: 'r1h/agy/agy-verify-3ver.log agy10', lines: ['参与微服务架构设计与技术选型'], model: ['微服务架构设计', '技术选型'], expected: ['参与微服务架构设计与技术选型'] },
  { id: 'agy12', source: 'r1h/agy/agy-verify-3ver.log agy12', lines: ['全国计算机等级考试二级 MS Office'], model: ['全国计算机等级考试二级', 'MS Office'], expected: ['全国计算机等级考试二级 MS Office'] },
  { id: 'set3d', source: '本包第2条；r1i 的 1.3D 成套才剥', lines: ['1.3D角色建模', '2.贴图绘制', '3.场景搭建'], model: ['3D角色建模', '贴图绘制', '场景搭建'], expected: ['3D角色建模', '贴图绘制', '场景搭建'] },
]

const PROJECT: ProjectCase[] = [
  { id: 'R-5', source: 'r1/exp-own17/agy17-verify-3ver.log G2', lines: ['2023.05 - 2023.11 智慧电商平台 后端开发', '负责订单模块核心开发', '负责支付模块核心开发', '负责系统日常监控与维护'], project: { name: '智慧电商平台', role: '后端开发', description: '主导订单与支付核心模块研发' }, modules: [{ before: '负责订单模块核心开发\n负责支付模块核心开发', after: '主导订单与支付核心模块研发' }], name: '智慧电商平台', role: '后端开发', description: '主导订单与支付核心模块研发\n负责系统日常监控与维护' },
  { id: 'G4', source: 'r1/exp-own17/agy17-verify-3ver.log G4', lines: ['2023.01 - 2023.06 CRM 客户管理系统 负责人', '负责业务架构设计'], project: { name: 'CRM', role: '', description: '负责业务架构设计' }, name: 'CRM 客户管理系统', role: '负责人', description: '负责业务架构设计' },
  { id: 'T1', source: 'r1/exp-own17/pipe-title-2ver.log T1', lines: ['项目名称：智慧园区管理系统 | 时间：2023.05-2023.11 | 角色：后端开发', '负责设备接入模块开发'], project: { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' }, name: '智慧园区管理系统', role: '后端开发', description: '负责设备接入模块开发' },
  { id: 'T2', source: 'r1/exp-own17/pipe-title-2ver.log T2', lines: ['智慧园区管理系统 | 2023.05 - 2023.11（实习）', '负责设备接入模块开发'], project: { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' }, name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' },
  { id: 'B1', source: 'r1/exp-own17/paren-role-3ver.log B1', lines: ['2022.09 - 2023.05 校园二手交易平台（毕业设计）', '负责商品发布与订单模块开发'], project: { name: '校园二手交易平台（毕业设计）', role: '', description: '负责商品发布与订单模块开发' }, name: '校园二手交易平台（毕业设计）', role: '', description: '负责商品发布与订单模块开发' },
  { id: 'B2', source: 'r1/exp-own17/paren-role-3ver.log B2', lines: ['2023.03 - 2023.09 门店巡检小程序（V2.0）', '重写巡检打卡与照片上传流程'], project: { name: '门店巡检小程序（V2.0）', role: '', description: '重写巡检打卡与照片上传流程' }, name: '门店巡检小程序（V2.0）', role: '', description: '重写巡检打卡与照片上传流程' },
  { id: 'B3', source: 'r1/exp-own17/paren-role-3ver.log B3', lines: ['2021.03 - 2021.06 图书管理系统（课程设计）', '完成借还书与库存查询功能'], project: { name: '图书管理系统', role: '', description: '完成借还书与库存查询功能' }, name: '图书管理系统（课程设计）', role: '', description: '完成借还书与库存查询功能' },
  { id: 'A5', source: 'r1h/own-probe2-3ver.log A5', lines: ['2023.03 - 2023.09 AI 智能客服系统', '负责对话流程开发'], project: { name: 'AI', role: '', description: '负责对话流程开发' }, name: 'AI 智能客服系统', role: '', description: '负责对话流程开发' },
  { id: 'P周期', source: 'r1h/own-probe2-3ver.log B 项目周期；r1i/own-probe-r1i-3ver.log', lines: ['项目名称：智慧园区管理系统 | 项目周期：2023.03 - 2023.09', '· 负责设备接入模块开发'], project: { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' }, name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' },
  { id: 'P起止', source: 'r1i/own-probe-r1i-3ver.log 起止时间', lines: ['项目名称：智慧园区管理系统 | 起止时间：2023.03 - 2023.09', '· 负责设备接入模块开发'], project: { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' }, name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' },
  { id: 'P阶段', source: 'r1i/own-probe-r1i-3ver.log 项目阶段', lines: ['项目名称：智慧园区管理系统 | 项目阶段：2023.03 - 2023.09', '· 负责设备接入模块开发'], project: { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' }, name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' },
  { id: 'P角色栏', source: 'r1i/own-probe-r1i-3ver.log 周期栏加角色栏', lines: ['智慧园区管理系统 | 项目周期：2023.03 - 2023.09 | 前端开发', '· 负责设备接入模块开发'], project: { name: '智慧园区管理系统', role: '', description: '负责设备接入模块开发' }, name: '智慧园区管理系统', role: '前端开发', description: '负责设备接入模块开发' },
  { id: 'colon', source: 'r1i/agy/agy1-drop-3ver.log 名称：日期 模型没写角色', lines: ['智慧园区管理系统：2023.03 - 2023.09 | 前端开发', '· 负责前端架构与页面开发', '· 负责首屏性能优化，加载时间缩短40%'], project: { name: '智慧园区管理系统', role: '', description: '负责前端架构与页面开发' }, name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发\n负责首屏性能优化，加载时间缩短40%' },
  { id: 'colonSp', source: 'r1i/agy/agy-verify-3ver.log agy1c', lines: ['智慧园区管理系统： 2023.03 - 2023.09 | 前端开发', '· 负责前端架构与页面开发'], project: { name: '智慧园区管理系统', role: '', description: '负责前端架构与页面开发' }, name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发' },
  { id: 'noPipe', source: 'r1i/agy/agy-verify-3ver.log agy1d', lines: ['智慧园区管理系统：2023.03 - 2023.09 前端开发', '· 负责前端架构与页面开发'], project: { name: '智慧园区管理系统', role: '', description: '负责前端架构与页面开发' }, name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发' },
  { id: 'agy5c', source: 'r1i/agy/agy-verify-3ver.log agy5c', lines: ['项目周期：2023.01 - 2023.06 | 智慧物流管理系统 | 前端开发', '核心模块研发'], project: { name: '智慧物流管理系统', role: '', description: '核心模块研发' }, name: '智慧物流管理系统', role: '前端开发', description: '核心模块研发' },
  { id: 'agy5', source: 'r1h/agy/agy-verify-3ver.log agy5 括号补充留在名称', lines: ['2022.03 - 2022.09 智慧商城（前端开发）', '负责页面开发'], project: { name: '智慧商城', role: '', description: '负责页面开发' }, name: '智慧商城（前端开发）', role: '', description: '负责页面开发' },
  { id: 'agy6p', source: 'r1h/agy/agy-verify-3ver.log agy6', lines: ['智慧园区系统 | 2023.05 - 2023.11（后端开发）', '负责核心模块开发'], project: { name: '智慧园区系统', role: '', description: '负责核心模块开发' }, name: '智慧园区系统', role: '', description: '负责核心模块开发' },
  { id: 'K毕', source: 'r1i/own-probe-r1i-3ver.log K （毕业设计）', lines: ['2022.09 - 2023.05 校园二手交易平台 （毕业设计）', '· 负责商品发布与订单模块开发'], project: { name: '校园二手交易平台', role: '', description: '负责商品发布与订单模块开发' }, name: '校园二手交易平台 （毕业设计）', role: '', description: '负责商品发布与订单模块开发' },
  { id: 'KV', source: 'r1i/own-probe-r1i-3ver.log K (V2.0)', lines: ['2023.03 - 2023.09 门店巡检小程序 (V2.0)', '· 重写巡检打卡流程'], project: { name: '门店巡检小程序', role: '', description: '重写巡检打卡流程' }, name: '门店巡检小程序 (V2.0)', role: '', description: '重写巡检打卡流程' },
  { id: 'K方头', source: 'r1i/own-probe-r1i-3ver.log K 【毕业设计】', lines: ['2022.09 - 2023.05 校园二手交易平台 【毕业设计】', '· 负责商品发布与订单模块开发'], project: { name: '校园二手交易平台', role: '', description: '负责商品发布与订单模块开发' }, name: '校园二手交易平台 【毕业设计】', role: '', description: '负责商品发布与订单模块开发' },
  { id: 'K方括', source: 'r1i/own-probe-r1i-3ver.log K [V2.0]', lines: ['2023.03 - 2023.09 门店巡检小程序 [V2.0]', '· 负责商品发布与订单模块开发'], project: { name: '门店巡检小程序', role: '', description: '负责商品发布与订单模块开发' }, name: '门店巡检小程序 [V2.0]', role: '', description: '负责商品发布与订单模块开发' },
  { id: 'K竖线方头', source: 'r1i/own-probe-r1i-3ver.log K 竖线【毕业设计】', lines: ['校园二手交易平台 | 【毕业设计】 | 2023.03 - 2023.09', '· 负责商品发布与订单模块开发'], project: { name: '校园二手交易平台', role: '', description: '负责商品发布与订单模块开发' }, name: '校园二手交易平台', role: '', description: '负责商品发布与订单模块开发' },
  { id: 'descNum', source: '本包第2条 描述栏成套编号', lines: ['智慧园区管理系统 | 2023.03 - 2023.09 | 前端开发', '1.负责前端架构与页面开发', '2.负责首屏性能优化，加载时间缩短40%'], project: { name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发' }, name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发\n负责首屏性能优化，加载时间缩短40%' },
]

function projectAt(item: ProjectCase) {
  const resume = { projects: [{ ...item.project }] } as GeneratedResume
  ensureProjectOriginalLines(resume, [{ key: 'projects', overflow: false, lines: item.lines }], item.modules ?? [])
  return resume.projects[0]!
}

export function verifyOptimizeRegressionCorpus(): void {
  console.log('\n=== R1 历轮回归夹具 ===')
  for (const item of LIST) {
    const got = alignOriginalList(item.lines, item.model, 60, {
      ...(item.coveredElsewhere ? { coveredElsewhere: item.coveredElsewhere } : {}),
      ...(item.modules ? { modules: item.modules } : {}),
    }).list
    if (JSON.stringify(got) !== JSON.stringify(item.expected)) {
      fail(`${item.id}（${item.source}）应为 ${JSON.stringify(item.expected)}，实际 ${JSON.stringify(got)}`)
    }
  }
  for (const item of PROJECT) {
    const got = projectAt(item)
    const description = got.description ?? ''
    if (got.name !== item.name || (got.role ?? '') !== item.role || (item.description !== undefined && description !== item.description)) {
      fail(`${item.id}（${item.source}）应为 name=${item.name} role=${item.role} description=${item.description ?? '（不限）'}，实际 ${JSON.stringify(got)}`)
    }
  }
  const total = LIST.length + PROJECT.length
  pass(`历轮回归 ${total} 条（技能证书 ${LIST.length}，项目 ${PROJECT.length}）`)
}

if (process.argv[1]?.endsWith('resume-optimize-regression-corpus.ts')) {
  try {
    verifyOptimizeRegressionCorpus()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
