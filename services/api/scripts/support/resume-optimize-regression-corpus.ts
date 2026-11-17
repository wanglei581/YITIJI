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
  { id: 'agy3z', source: 'r17-1114/r1j/agy/agy-verify-3ver.log agy3（75b603a1f 对、e3f630a43 剥成「0架构…」并丢模型项）', lines: ['1.0架构重构与微服务拆分', '2.高并发接口性能调优'], model: ['1.0架构重构与微服务拆分', '高并发接口性能调优'], expected: ['1.0架构重构与微服务拆分', '高并发接口性能调优'] },
  { id: 'agy3zb', source: 'r17-1114/r1j/agy/agy-verify-3ver.log agy3b（模型漏交第一项）', lines: ['1.0架构重构与微服务拆分', '2.高并发接口性能调优'], model: ['高并发接口性能调优'], expected: ['1.0架构重构与微服务拆分', '高并发接口性能调优'] },
  { id: 'set3d', source: '本包第2条；r1i 的 1.3D 成套才剥', lines: ['1.3D角色建模', '2.贴图绘制', '3.场景搭建'], model: ['3D角色建模', '贴图绘制', '场景搭建'], expected: ['3D角色建模', '贴图绘制', '场景搭建'] },
  { id: 'r1l15', source: '第十二段口径：1.5倍模型原样交回（其余行已去编号，这一行留着「1.5」）', lines: ['1.5倍并发性能提升', '2.系统可用性达99.9%'], model: ['1.5倍并发性能提升', '系统可用性达99.9%'], expected: ['1.5倍并发性能提升', '系统可用性达99.9%'] },
  { id: 'r1l15b', source: '第十二段口径：1.5倍同一栏模型漏交首行，原样补回', lines: ['1.5倍并发性能提升', '2.系统可用性达99.9%'], model: ['系统可用性达99.9%'], expected: ['1.5倍并发性能提升', '系统可用性达99.9%'] },
  { id: 'r1l13', source: '第十二段口径：1.3年以上模型交回去编号，用模型的', lines: ['1.3年以上Java开发经验', '2.熟悉Spring Boot'], model: ['3年以上Java开发经验', '熟悉Spring Boot'], expected: ['3年以上Java开发经验', '熟悉Spring Boot'] },
  { id: 'r1l13b', source: '第十二段口径：1.3年以上模型漏交首行，原样补回', lines: ['1.3年以上Java开发经验', '2.熟悉Spring Boot'], model: ['熟悉Spring Boot'], expected: ['1.3年以上Java开发经验', '熟悉Spring Boot'] },
  { id: 'k3z3', source: 'r17-1114/r1kl/k3-paths-3ver.log Z3（部分漏交；e3f630a43 补回「0架构重构」；24f39af82 上只有「点号后 0 打头不当编号」守着）', lines: ['1.0架构重构、微服务拆分', '2.高并发接口性能调优'], model: ['微服务拆分', '高并发接口性能调优'], expected: ['1.0架构重构', '微服务拆分', '高并发接口性能调优'] },
  { id: 'k3z4', source: 'r17-1114/r1kl/k3-paths-3ver.log Z4（模型照抄整栏带编号；e3f630a43 成品「0架构…」；24f39af82 上只有「点号后 0 打头不当编号」守着）', lines: ['1.0架构重构与微服务拆分', '2.高并发接口性能调优'], model: ['1.0架构重构与微服务拆分', '2.高并发接口性能调优'], expected: ['1.0架构重构与微服务拆分', '高并发接口性能调优'] },
  { id: 'renum3d', source: 'r17-1114/r1kl/renum-probe-4ver.log R1；e2e-renum-4ver.log R1（模型调换顺序并重新编号；24f39af82 成品出原稿没有的「2.3D角色建模」，516a38883 为「3D角色建模」）', lines: ['1.3D角色建模', '2.贴图绘制', '3.场景搭建'], model: ['1.贴图绘制', '2.3D角色建模', '3.场景搭建'], expected: ['1.3D角色建模', '贴图绘制', '场景搭建'] },
  { id: 'renum3y', source: 'r17-1114/r1kl/renum-probe-4ver.log R2；e2e-renum-4ver.log R2（模型调换顺序并重新编号；24f39af82 成品出原稿没有的「2.3年以上…」，e3f630a43 与 516a38883 为原样「1.3年以上…」）', lines: ['1.3年以上Java开发经验', '2.熟悉Spring Boot'], model: ['1.熟悉Spring Boot', '2.3年以上Java开发经验'], expected: ['1.3年以上Java开发经验', '熟悉Spring Boot'] },
  { id: 'renum10', source: 'r17-1114/r1kl/renum-probe-4ver.log R4（模型把「1.0架构…」调到后面并改成「2.0」；24f39af82 成品出原稿没有的「2.0架构…」，75b603a1f 为原样「1.0架构…」）', lines: ['1.0架构重构与微服务拆分', '2.高并发接口性能调优'], model: ['1.高并发接口性能调优', '2.0架构重构与微服务拆分'], expected: ['1.0架构重构与微服务拆分', '高并发接口性能调优'] },
  { id: 'renum15', source: 'r17-1114/r1kl/renum-probe-4ver.log R3（模型把「1.5倍…」调到后面并改成「2.5倍」；24f39af82 成品出原稿没有的「2.5倍…」，75b603a1f 为原样「1.5倍…」）', lines: ['1.5倍并发性能提升', '2.系统可用性达99.9%'], model: ['1.系统可用性达99.9%', '2.5倍并发性能提升'], expected: ['1.5倍并发性能提升', '系统可用性达99.9%'] },
  { id: 'renumAdd', source: '本包背景：模型在最前面加一项再顺延编号（「1.需求沟通 / 2.3D角色建模 / …」）；成品不得出现原稿没有的「2.3D」，也不得收下凭空加的「需求沟通」）', lines: ['1.3D角色建模', '2.贴图绘制', '3.场景搭建'], model: ['1.需求沟通', '2.3D角色建模', '3.贴图绘制', '4.场景搭建'], expected: ['1.3D角色建模', '贴图绘制', '场景搭建'] },
  { id: 'r1nDunKeep', source: '第十四段 prop-renum 原编号跟内容走（「1、05亿…与…」乱序后被拆成「05亿级数据迁移」「校验」）', lines: ['1、05亿级数据迁移与校验', '2、贴图绘制', '3、场景搭建'], model: ['3、场景搭建', '1、05亿级数据迁移与校验', '2、贴图绘制'], expected: ['05亿级数据迁移与校验', '贴图绘制', '场景搭建'] },
  { id: 'r1nDunHalf', source: '第十四段 prop-renum 只交一半调序（只交「1、05亿…与…」时拆成两段）', lines: ['1、系统可用性达99.9%', '2、05亿级数据迁移与校验'], model: ['1、05亿级数据迁移与校验'], expected: ['系统可用性达99.9%', '05亿级数据迁移与校验'] },
  { id: 'r1nDunDropLast', source: '第十四段 prop-renum 漏最后一项重编号（「1、0架构…与…」只剩一行时拆成两段）', lines: ['1、0架构重构与微服务拆分', '2、主导支付模块研发'], model: ['1、0架构重构与微服务拆分'], expected: ['0架构重构与微服务拆分', '主导支付模块研发'] },
  { id: 'r1nDunDropFirst', source: '第十四段 prop-renum 漏一项重编号（漏掉第一项后「1、3D建模与渲染」被拆成两段）', lines: ['1、贴图绘制', '2、3D建模与渲染'], model: ['1、3D建模与渲染'], expected: ['贴图绘制', '3D建模与渲染'] },
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
  { id: 'agy8', source: 'r1i/agy/agy-verify-3ver.log agy8；r17-1114/r1j/r1i-probes/agy-verify-r1i-3ver.log（75b603a1f 对、e3f630a43 名称带出「（时间」半截）', lines: ['智慧商城系统（时间：2023.01 - 2023.06） | 全栈开发', '· 负责端到端全栈开发'], project: { name: '智慧商城系统', role: '全栈开发', description: '负责端到端全栈开发' }, name: '智慧商城系统', role: '全栈开发', description: '负责端到端全栈开发' },
  { id: 'E6',source: 'r17-1114/r1j/own-probe-r1j-3ver.log E6；e2e-r1j-3ver.log E6（描述「1、」成套、改写说明 before 带编号、全交）', lines: ['2023.05 - 2023.11 智慧电商平台 后端开发', '1、负责订单模块核心开发', '2、负责支付模块核心开发'], project: { name: '智慧电商平台', role: '后端开发', description: '主导订单模块研发\n负责支付模块核心开发' }, modules: [{ before: '1、负责订单模块核心开发', after: '主导订单模块研发' }], name: '智慧电商平台', role: '后端开发', description: '主导订单模块研发\n负责支付模块核心开发' },
  { id: 'E6a', source: 'r17-1114/r1j/e2e-r1j-3ver.log E6a（描述「1.」成套、改写说明 before 带编号、全交）', lines: ['2023.05 - 2023.11 智慧电商平台 后端开发', '1.负责订单模块核心开发', '2.负责支付模块核心开发'], project: { name: '智慧电商平台', role: '后端开发', description: '主导订单模块研发\n负责支付模块核心开发' }, modules: [{ before: '1.负责订单模块核心开发', after: '主导订单模块研发' }], name: '智慧电商平台', role: '后端开发', description: '主导订单模块研发\n负责支付模块核心开发' },
  { id: 'E3', source: 'r17-1114/r1j/own-probe-r1j-3ver.log E3（跨行改写说明 before 带编号、第三行漏交）', lines: ['2023.05 - 2023.11 智慧电商平台 后端开发', '1.负责订单模块核心开发', '2.负责支付模块核心开发', '3.负责系统日常监控与维护'], project: { name: '智慧电商平台', role: '后端开发', description: '主导订单与支付核心模块研发' }, modules: [{ before: '1.负责订单模块核心开发\n2.负责支付模块核心开发', after: '主导订单与支付核心模块研发' }], name: '智慧电商平台', role: '后端开发', description: '主导订单与支付核心模块研发\n负责系统日常监控与维护' },
  { id: 'E4', source: 'r17-1114/r1j/own-probe-r1j-3ver.log E4（单行改写说明 before 带编号、第三行漏交）', lines: ['2023.05 - 2023.11 智慧电商平台 后端开发', '1.负责订单模块核心开发', '2.负责支付模块核心开发', '3.负责系统日常监控与维护'], project: { name: '智慧电商平台', role: '后端开发', description: '主导订单模块研发\n负责支付模块核心开发' }, modules: [{ before: '1.负责订单模块核心开发', after: '主导订单模块研发' }], name: '智慧电商平台', role: '后端开发', description: '主导订单模块研发\n负责支付模块核心开发\n负责系统日常监控与维护' },
  { id: 'descNum', source: '本包第2条 描述栏成套编号', lines: ['智慧园区管理系统 | 2023.03 - 2023.09 | 前端开发', '1.负责前端架构与页面开发', '2.负责首屏性能优化，加载时间缩短40%'], project: { name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发' }, name: '智慧园区管理系统', role: '前端开发', description: '负责前端架构与页面开发\n负责首屏性能优化，加载时间缩短40%' },
  { id: 'r1l15p', source: '第十二段口径：项目描述「1.5倍」模型漏交首句，原样补回', lines: ['智慧园区管理系统 | 2023.03 - 2023.09 | 前端开发', '1.5倍核心接口并发吞吐量提升', '2. 线上系统零故障稳定运行'], project: { name: '智慧园区管理系统', role: '前端开发', description: '线上系统零故障稳定运行' }, name: '智慧园区管理系统', role: '前端开发', description: '1.5倍核心接口并发吞吐量提升\n线上系统零故障稳定运行' },
  { id: 'o2z', source: 'r17-1114/r1kl/own-probe-r1kl-4ver.log ②z（「名称【周期：日期】 | 角色」；e3f630a43 名称出「门店巡检小程序【周期」半截；24f39af82 上只有 bracketsPaired 的【】判断守着）', lines: ['门店巡检小程序【周期：2024.03 - 2024.08】 | 测试工程师', '· 编写巡检打卡用例'], project: { name: '门店巡检小程序', role: '', description: '编写巡检打卡用例' }, name: '门店巡检小程序', role: '测试工程师', description: '编写巡检打卡用例' },
  { id: 'keep10m', source: 'r17-1114/r1kl/agy-verify-r1kl-5ver.log A1（agy 问题 1：描述首行「1.0…」、module.before 不带编号；e3f630a43 用改写，516a38883 起改写被丢、换回「2.负责…」）', lines: ['智慧电商平台 | 2023.05 - 2023.11 | 后端开发', '1.0架构重构与微服务拆分', '2.负责支付模块核心开发'], project: { name: '智慧电商平台', role: '后端开发', description: '1.0架构重构与微服务拆分\n主导支付模块核心研发' }, modules: [{ before: '负责支付模块核心开发', after: '主导支付模块核心研发' }], name: '智慧电商平台', role: '后端开发', description: '1.0架构重构与微服务拆分\n主导支付模块核心研发' },
  { id: 'keep10o', source: 'r17-1114/r1kl/agy-verify-r1kl-5ver.log A2（agy 问题 2：描述首行「1.0…」、模型漏交第二行；e3f630a43 补回不带编号，516a38883 起补回「2.负责…」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1.0微服务架构升级', '2.负责高并发接口性能调优'], project: { name: '智慧商城系统', role: '后端开发', description: '1.0微服务架构升级' }, name: '智慧商城系统', role: '后端开发', description: '1.0微服务架构升级\n负责高并发接口性能调优' },
  { id: 'k3z5', source: 'r17-1114/r1kl/k3-paths-3ver.log Z5（项目描述照抄整栏「1.0… / 2.」；删掉「点号后 0 打头」后成品变成「0架构…」，24f39af82 上「2.」不剥）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1.0架构重构与微服务拆分', '2.高并发接口性能调优'], project: { name: '智慧商城系统', role: '后端开发', description: '1.0架构重构与微服务拆分\n2.高并发接口性能调优' }, name: '智慧商城系统', role: '后端开发', description: '1.0架构重构与微服务拆分\n高并发接口性能调优' },
  { id: 'kBracket', source: '本包：【】没配对的半截名称（「智慧商城系统【时间：2023.01 - 2023.06】 | 全栈开发」切开后是「智慧商城系统【时间」）；只查圆括号时会把这半截补进名称', lines: ['智慧商城系统【时间：2023.01 - 2023.06】 | 全栈开发', '· 负责端到端全栈开发'], project: { name: '智慧商城系统', role: '', description: '负责端到端全栈开发' }, name: '智慧商城系统', role: '全栈开发', description: '负责端到端全栈开发' },
  { id: 'r1nProj05', source: '第十四段 prop-renum-proj 调序重编号(换写法)（首行「1．05亿…」被当成套编号后，模型自己的「1.」「3.」直通成品）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．05亿级数据迁移与校验', '2．负责订单模块核心开发', '3．推动团队代码评审与知识分享', '4．设计缓存与限流方案'], project: { name: '智慧商城系统', role: '后端开发', description: '1.推动团队代码评审与知识分享\n2.设计缓存与限流方案\n3.负责订单模块核心开发\n4.05亿级数据迁移与校验' }, name: '智慧商城系统', role: '后端开发', description: '1．05亿级数据迁移与校验\n负责订单模块核心开发\n推动团队代码评审与知识分享\n设计缓存与限流方案' },
  { id: 'r1nProj00', source: '第十四段 prop-renum-proj 只交一半调序（首行「1.00后…」，模型只交改写并带上自己的「1.」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1.00后用户增长运营', '2.搭建持续集成流水线'], project: { name: '智慧商城系统', role: '后端开发', description: '1.主导搭建持续集成流水线' }, modules: [{ before: '搭建持续集成流水线', after: '主导搭建持续集成流水线' }], name: '智慧商城系统', role: '后端开发', description: '1.00后用户增长运营\n主导搭建持续集成流水线' },
  { id: 'r1nProj0arch', source: '第十四段 prop-renum-proj 调序重编号(换写法)（首行「1．0架构…」，模型改成「（1）」「（3）」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．0架构重构与微服务拆分', '2．搭建持续集成流水线', '3．完成数据库读写分离改造'], project: { name: '智慧商城系统', role: '后端开发', description: '（1）搭建持续集成流水线\n（2）0架构重构与微服务拆分\n（3）主导完成数据库读写分离改造' }, modules: [{ before: '完成数据库读写分离改造', after: '主导完成数据库读写分离改造' }], name: '智慧商城系统', role: '后端开发', description: '1．0架构重构与微服务拆分\n搭建持续集成流水线\n主导完成数据库读写分离改造' },
  { id: 'r1nProjAdd', source: '第十四段 prop-renum-proj 最前加一句重编号（模型在前面加上「需求沟通与评审」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．0版本从零搭建与上线', '2．负责系统日常监控与维护'], project: { name: '智慧商城系统', role: '后端开发', description: '1．需求沟通与评审\n2．主导0版本从零搭建与上线\n3．负责系统日常监控与维护' }, modules: [{ before: '1．0版本从零搭建与上线', after: '主导0版本从零搭建与上线' }], name: '智慧商城系统', role: '后端开发', description: '主导0版本从零搭建与上线\n负责系统日常监控与维护' },
  { id: 'r1nProjMid', source: '第十四段 prop-renum-proj 中间加一句重编号（模型在中间加上「组织技术分享」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．05亿级数据迁移与校验', '2．负责系统日常监控与维护'], project: { name: '智慧商城系统', role: '后端开发', description: '1．主导05亿级数据迁移与校验\n2．组织技术分享\n3．负责系统日常监控与维护' }, modules: [{ before: '1．05亿级数据迁移与校验', after: '主导05亿级数据迁移与校验' }], name: '智慧商城系统', role: '后端开发', description: '主导05亿级数据迁移与校验\n负责系统日常监控与维护' },
  { id: 'r1nProjTail', source: '第十四段 prop-renum-proj 末尾加一句重编号（模型在末尾加上「持续学习新技术」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．00后用户增长运营', '2．搭建持续集成流水线'], project: { name: '智慧商城系统', role: '后端开发', description: '1．主导00后用户增长运营\n2．搭建持续集成流水线\n3．持续学习新技术' }, modules: [{ before: '1．00后用户增长运营', after: '主导00后用户增长运营' }], name: '智慧商城系统', role: '后端开发', description: '主导00后用户增长运营\n搭建持续集成流水线' },
  { id: 'r1nProjDrop', source: '第十四段 prop-renum-proj 漏第一条重编号（首行「1．0架构…」没交，改写仍带「1.」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．0架构重构与微服务拆分', '2．推动团队代码评审与知识分享'], project: { name: '智慧商城系统', role: '后端开发', description: '1.主导推动团队代码评审与知识分享' }, modules: [{ before: '推动团队代码评审与知识分享', after: '主导推动团队代码评审与知识分享' }], name: '智慧商城系统', role: '后端开发', description: '1．0架构重构与微服务拆分\n主导推动团队代码评审与知识分享' },
  { id: 'r1nProjHalf', source: '第十四段 prop-renum-proj 只交一半调序（首行「1．05亿…」没交，改写仍带「1．」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．05亿级数据迁移与校验', '2．完成数据库读写分离改造'], project: { name: '智慧商城系统', role: '后端开发', description: '1．主导完成数据库读写分离改造' }, modules: [{ before: '完成数据库读写分离改造', after: '主导完成数据库读写分离改造' }], name: '智慧商城系统', role: '后端开发', description: '1．05亿级数据迁移与校验\n主导完成数据库读写分离改造' },
  { id: 'r1nProjReorder', source: '第十四段 prop-renum-proj 调序重编号(换写法)（首行「1．00后…」调到最后并改成「3.00后」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．00后用户增长运营', '2．设计缓存与限流方案', '3．主导支付模块研发'], project: { name: '智慧商城系统', role: '后端开发', description: '1.设计缓存与限流方案\n2.主导支付模块研发\n3.00后用户增长运营' }, name: '智慧商城系统', role: '后端开发', description: '1．00后用户增长运营\n设计缓存与限流方案\n主导支付模块研发' },
  { id: 'r1nProjMaybe', source: '第十四段 prop-renum-proj 最前加一句重编号（「1．5倍…」被模型写成「2．5倍…」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '1．5倍核心接口并发吞吐量提升', '2．设计缓存与限流方案'], project: { name: '智慧商城系统', role: '后端开发', description: '1．需求沟通与评审\n2．5倍核心接口并发吞吐量提升\n3．设计缓存与限流方案' }, name: '智慧商城系统', role: '后端开发', description: '1．5倍核心接口并发吞吐量提升\n设计缓存与限流方案' },
  { id: 'r1nProjBracket', source: '第十四段 prop-renum-proj 调序重编号(换写法)（原稿「（1）0版本…」，模型写成「1.0版本…」）', lines: ['智慧商城系统 | 2023.01 - 2023.06 | 后端开发', '（1）0版本从零搭建与上线', '（2）负责订单模块核心开发', '（3）主导支付模块研发', '（4）完成数据库读写分离改造'], project: { name: '智慧商城系统', role: '后端开发', description: '1.0版本从零搭建与上线\n2.负责订单模块核心开发\n3.主导支付模块研发\n4.完成数据库读写分离改造' }, name: '智慧商城系统', role: '后端开发', description: '（1）0版本从零搭建与上线\n负责订单模块核心开发\n主导支付模块研发\n完成数据库读写分离改造' },
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
