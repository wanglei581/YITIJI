#!/usr/bin/env node
/**
 * 校验 scripts/walkthrough/dataset/personas.json。
 * 号码段、证件号校验位、年龄与出生日期、姓名不含「测试」。
 * 退出码 0 为通过。问题一次列完。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "personas.json");
const AS_OF = "2026-09-29";
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_MAP = "10X98765432";
const SKILLS = new Set(["高", "中", "低", "不会触屏"]);
const CARRIED = new Set(["纸质", "U盘", "微信文件", "手机相册", "没带"]);
const FORBIDDEN = ["一键投递", "立即投递", "平台投递", "企业收简历", "候选人管理", "测试"];
const SITES = {
  "service-hall": { terminal: "WALK-001", org: "示例·市南区公共就业服务中心", name: "服务大厅" },
  "gig-home": { terminal: "WALK-002", org: "示例·崂山区零工之家", name: "零工之家" },
  campus: { terminal: "WALK-003", org: "示例·某高校就业指导中心（黄岛）", name: "高校就业中心" },
  community: { terminal: "WALK-004", org: "示例·城阳区某社区服务站", name: "社区服务站" },
};

const problems = [];
function bad(message) {
  problems.push(message);
}

function ageOn(birth, asOf) {
  const [y, m, d] = birth.split("-").map(Number);
  const [Y, M, D] = asOf.split("-").map(Number);
  let age = Y - y;
  if (M < m || (M === m && D < d)) age -= 1;
  return age;
}

function checkDigit(body17) {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(body17[i]) * WEIGHTS[i];
  return CHECK_MAP[sum % 11];
}

function isRealDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const raw = fs.readFileSync(file, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error("personas.json 不是合法 JSON：" + error.message);
  process.exit(1);
}

if (data.asOf !== AS_OF) bad(`asOf 应为 ${AS_OF}，实际 ${data.asOf}`);
if (!Array.isArray(data.personas)) bad("缺少 personas 数组");
const people = data.personas ?? [];
if (people.length !== 28) bad(`人设应为 28 个，实际 ${people.length}`);

const siteCounts = new Map();
const phones = new Set();
const ids = new Set();
const names = new Set();
let xCount = 0;
let dotted = 0;
let rare = 0;
let compound = 0;

for (const [index, person] of people.entries()) {
  const label = person?.name ? `${person.name}` : `第 ${index + 1} 个`;
  const required = [
    "id", "name", "age", "gender", "phone", "birthDate", "idNumber", "siteId",
    "cohort", "deviceSkill", "hasSmartphone", "carried", "goal", "habits",
    "isMember", "features",
  ];
  for (const key of required) {
    if (person?.[key] === undefined || person[key] === null || person[key] === "") {
      bad(`${label} 缺少字段 ${key}`);
    }
  }
  if (!person?.name) continue;

  if (person.name.includes("测试") || /test/i.test(person.name)) bad(`${label} 姓名含「测试」或 test`);
  if (names.has(person.name)) bad(`姓名重复：${person.name}`);
  names.add(person.name);
  if (person.name.includes("·")) dotted += 1;
  if (/[堃犇喆]/.test(person.name)) rare += 1;
  if (/^(欧阳|诸葛|司马|上官|皇甫|令狐|宇文)/.test(person.name)) compound += 1;

  if (person.gender !== "男" && person.gender !== "女") bad(`${label} 性别不是男或女`);
  if (!SKILLS.has(person.deviceSkill)) bad(`${label} 设备熟练度不在 高/中/低/不会触屏`);
  if (typeof person.hasSmartphone !== "boolean") bad(`${label} hasSmartphone 不是布尔值`);
  if (typeof person.isMember !== "boolean") bad(`${label} isMember 不是布尔值`);
  if (!Array.isArray(person.features) || person.features.length === 0) bad(`${label} 功能清单为空`);
  for (const feature of person.features ?? []) {
    for (const word of FORBIDDEN) {
      if (String(feature).includes(word)) bad(`${label} 功能清单含禁用词「${word}」：${feature}`);
    }
  }
  if (typeof person.goal === "string") {
    for (const word of FORBIDDEN) {
      if (person.goal.includes(word)) bad(`${label} 目标含禁用词「${word}」`);
    }
  }

  const site = SITES[person.siteId];
  if (!site) bad(`${label} 网点 siteId 无法识别：${person.siteId}`);
  else siteCounts.set(person.siteId, (siteCounts.get(person.siteId) ?? 0) + 1);

  if (!/^13800000\d{3}$/.test(person.phone ?? "")) bad(`${label} 手机号不在 13800000xxx：${person.phone}`);
  else {
    const n = Number(person.phone);
    if (n < 13800000601 || n > 13800000628) bad(`${label} 手机号不在 13800000601–13800000628：${person.phone}`);
    if (phones.has(person.phone)) bad(`手机号重复：${person.phone}`);
    phones.add(person.phone);
  }

  if (!isRealDate(person.birthDate ?? "")) bad(`${label} 出生日期不合法：${person.birthDate}`);
  else if (ageOn(person.birthDate, data.asOf || AS_OF) !== person.age) {
    bad(`${label} 年龄 ${person.age} 与出生日期 ${person.birthDate} 在 ${data.asOf || AS_OF} 不一致，应为 ${ageOn(person.birthDate, data.asOf || AS_OF)}`);
  }

  const id = String(person.idNumber ?? "");
  if (!/^370200\d{8}\d{3}[\dX]$/.test(id)) bad(`${label} 证件号格式不对：${id}`);
  else {
    if (id.slice(6, 14) !== String(person.birthDate).replaceAll("-", "")) {
      bad(`${label} 证件号出生日期与 birthDate 不一致`);
    }
    const expected = checkDigit(id.slice(0, 17));
    if (id[17] !== expected) bad(`${label} 校验位应为 ${expected}，实际 ${id[17]}（${id}）`);
    const odd = Number(id.slice(14, 17)) % 2 === 1;
    if (person.gender === "男" && !odd) bad(`${label} 顺序码应为奇数（男）`);
    if (person.gender === "女" && odd) bad(`${label} 顺序码应为偶数（女）`);
    if (id.endsWith("X")) xCount += 1;
    if (ids.has(id)) bad(`证件号重复：${id}`);
    ids.add(id);
  }

  const kinds = person.carried?.kinds;
  if (!Array.isArray(kinds) || kinds.length === 0) bad(`${label} 携带物 kinds 为空`);
  for (const kind of kinds ?? []) {
    if (!CARRIED.has(kind)) bad(`${label} 携带物不在允许列表：${kind}`);
  }
  if (!person.carried?.detail) bad(`${label} 携带物缺少 detail`);

  const habits = person.habits ?? {};
  for (const key of ["misclickRate", "leaveMidwayProbability"]) {
    const value = habits[key];
    if (typeof value !== "number" || value < 0 || value > 1) bad(`${label} 操作习惯 ${key} 应在 0 到 1 之间`);
  }
  if (typeof habits.whenConfused !== "string" || !habits.whenConfused.trim()) {
    bad(`${label} 缺少看不懂提示时的反应`);
  }
  if (typeof habits.patienceMinutes !== "number" || habits.patienceMinutes <= 0) {
    bad(`${label} patienceMinutes 应是正数`);
  }
  if (typeof habits.asksStaff !== "boolean") bad(`${label} asksStaff 不是布尔值`);
}

for (const [id, expect] of Object.entries(SITES)) {
  const count = siteCounts.get(id) ?? 0;
  if (count < 6 || count > 8) bad(`网点 ${expect.name} 应有 7 个左右（6–8），实际 ${count}`);
}
if (phones.size === 28) {
  for (let n = 13800000601; n <= 13800000628; n += 1) {
    if (!phones.has(String(n))) bad(`号段缺 ${n}`);
  }
}
if (xCount < 3) bad(`末位 X 的证件号只有 ${xCount} 个，至少要 3 个`);
if (dotted < 1) bad("缺少带「·」的姓名");
if (rare < 1) bad("缺少生僻字姓名（堃 / 犇 / 喆）");
if (compound < 1) bad("缺少复姓");

const listed = new Map((data.sites ?? []).map((site) => [site.id, site]));
for (const [id, expect] of Object.entries(SITES)) {
  const site = listed.get(id);
  if (!site) {
    bad(`sites 缺少 ${id}`);
    continue;
  }
  if (site.name !== expect.name) bad(`${id} 网点名应为 ${expect.name}`);
  if (site.org !== expect.org) bad(`${id} 机构名应为 ${expect.org}`);
  if (!String(site.org).includes("示例")) bad(`${id} 机构名未带「示例」`);
  if (site.terminal !== expect.terminal) bad(`${id} 终端应为 ${expect.terminal}`);
}

if (problems.length) {
  console.error(`personas.json 未通过，${problems.length} 个问题：`);
  for (const item of problems) console.error(" - " + item);
  process.exit(1);
}

console.log(`通过：${people.length} 人，4 个网点各 ${[...siteCounts.values()].join("/")} 人，末位 X ${xCount} 个，号段 13800000601–13800000628。`);
