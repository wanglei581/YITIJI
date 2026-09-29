#!/usr/bin/env node
/**
 * 数据集 v2 素材生成。只写 ~/.cache/walk0929/dataset/files/，不写数据库。
 *
 * .wps / .et 说明：本机没有 WPS，仓库也没有 OLE 写入库。
 * 官方 .wps 抽查是 OLE（含 WpsCustomData）。这里的 .wps 是 OOXML，
 * 只把 Application 改成 WPS Office；.et 是 ExcelJS 的 xlsx 改扩展名。
 * manifest.formatFidelity = not-native-ole，不伪装成原生 OLE。
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const OUT = path.join(os.homedir(), ".cache/walk0929/dataset/files");
const FONT_DIR = path.join(os.homedir(), ".cache/walk0929/dataset/fonts");
const OPEN_PASSWORD = "memo0922";
const OWNER_PASSWORD = "owner-walk0929";
const SIBLING = path.resolve(here, "../../../..", "youthful-jang-8df61d");

const CO = {
  logistics: "青岛海湾某物流有限公司",
  property: "青岛小麦岛某物业服务有限公司",
  catering: "青岛栈桥某餐饮管理有限公司",
  seafood: "青岛红岛某水产有限公司",
  trade: "青岛金沙滩某商贸有限公司",
  fitout: "青岛浮山某装修工程有限公司",
  house: "青岛麦岛某家政服务有限公司",
  ecom: "青岛黄岛某电商有限公司",
  elec: "青岛城阳某电子有限公司",
  delivery: "青岛崂山某配送服务有限公司",
};
const SCHOOL = "示例·黄岛某高校";
const VOCATIONAL = "示例·黄岛某职校";
const MOJIBAKE = String.fromCodePoint(0x00e7, 0x00ae, 0x20ac, 0x00e5, 0x017d, 0x2020);

const NEED_MESS = [
  "空白期",
  "错别字",
  "中英混排",
  "表格排版",
  "页眉页脚",
  "页码错乱",
  "扫描歪斜",
  "空白页",
  "加密",
  "乱码文件名",
  "超长文件名",
  "同名不同版本",
];

function utf8Sanity() {
  if (Buffer.from("青岛").toString("hex") !== "e99d92e5b29b") {
    throw new Error("gen-files.mjs 读出来不是 UTF-8，中文素材会坏");
  }
}

function findPkg(pkgName) {
  const direct = [
    process.env.DATASET_NODE_MODULES && path.join(process.env.DATASET_NODE_MODULES, pkgName),
    path.join(SIBLING, "services/api/node_modules", pkgName),
    path.join(SIBLING, "node_modules", pkgName),
    path.resolve(here, "../../../node_modules", pkgName),
  ].filter(Boolean);
  for (const dir of direct) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  const needle = `${pkgName.replace("/", "+")}@`;
  for (const dir of [
    path.join(SIBLING, "node_modules/.pnpm"),
    path.join(SIBLING, "services/api/node_modules/.pnpm"),
  ]) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((name) => name.startsWith(needle));
    if (!hit) continue;
    const resolved = path.join(dir, hit, "node_modules", pkgName);
    if (fs.existsSync(path.join(resolved, "package.json"))) return resolved;
  }
  throw new Error(`找不到依赖 ${pkgName}。已查 ${SIBLING}`);
}

function loadMain(pkgName) {
  const dir = findPkg(pkgName);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const entry = pkg.main || "index.js";
  const mod = require(path.resolve(dir, entry));
  return mod.default || mod;
}

function loadLibs() {
  const PDFDocument = loadMain("pdfkit");
  const docx = loadMain("docx");
  const ExcelJS = loadMain("exceljs");
  const JSZip = loadMain("jszip");
  const pdfLib = loadMain("pdf-lib");
  const canvas = loadMain("@napi-rs/canvas");
  for (const [name, value] of [
    ["pdfkit", PDFDocument],
    ["docx", docx.Document],
    ["exceljs", ExcelJS.Workbook],
    ["jszip", JSZip],
    ["pdf-lib", pdfLib.PDFDocument],
    ["canvas", canvas.createCanvas],
  ]) {
    if (!value) throw new Error(`依赖 ${name} 没有预期的导出`);
  }
  return { PDFDocument, docx, ExcelJS, JSZip, pdfLib, canvas };
}

function walkFind(dir, pred, depth = 0) {
  if (depth > 7) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const hit = walkFind(full, pred, depth + 1);
      if (hit) return hit;
    } else if (pred(ent.name, full)) return full;
  }
  return null;
}

function fcFile(query) {
  try {
    const out = execFileSync("fc-list", [query, "file"], { encoding: "utf8" });
    const files = [...new Set(out.split("\n").map((line) => line.split(":")[0].trim()).filter(Boolean))];
    return files.find((file) => fs.existsSync(file)) || null;
  } catch {
    return null;
  }
}

function decodeUtf16be(buf) {
  const swapped = Buffer.alloc(buf.length - (buf.length % 2));
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return swapped.toString("utf16le");
}

function readFaceNames(ttc, faceIndex) {
  const numFonts = ttc.readUInt32BE(8);
  if (faceIndex >= numFonts) throw new Error("字体面超出范围");
  const faceOff = ttc.readUInt32BE(12 + faceIndex * 4);
  const numTables = ttc.readUInt16BE(faceOff + 4);
  let nameOffset = 0;
  let nameLength = 0;
  for (let i = 0; i < numTables; i += 1) {
    const rec = faceOff + 12 + i * 16;
    const tag = ttc.toString("latin1", rec, rec + 4);
    if (tag === "name") {
      nameOffset = ttc.readUInt32BE(rec + 8);
      nameLength = ttc.readUInt32BE(rec + 12);
    }
  }
  if (!nameLength) return {};
  const table = ttc.subarray(nameOffset, nameOffset + nameLength);
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  const names = {};
  for (let i = 0; i < count; i += 1) {
    const rec = 6 + i * 12;
    const platform = table.readUInt16BE(rec);
    const nameId = table.readUInt16BE(rec + 6);
    const length = table.readUInt16BE(rec + 8);
    const offset = table.readUInt16BE(rec + 10);
    if (![1, 2, 4, 16].includes(nameId)) continue;
    const raw = table.subarray(stringOffset + offset, stringOffset + offset + length);
    const text = platform === 3 || platform === 0 ? decodeUtf16be(raw) : raw.toString("latin1");
    if (!names[nameId]) names[nameId] = text;
  }
  return {
    family: names[1] || "",
    subFamily: names[2] || "",
    full: names[4] || "",
    typoFamily: names[16] || "",
  };
}

function extractFace(ttc, faceIndex) {
  const faceOff = ttc.readUInt32BE(12 + faceIndex * 4);
  const numTables = ttc.readUInt16BE(faceOff + 4);
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = faceOff + 12 + i * 16;
    tables.push({
      tag: ttc.toString("latin1", rec, rec + 4),
      checksum: ttc.readUInt32BE(rec + 4),
      offset: ttc.readUInt32BE(rec + 8),
      length: ttc.readUInt32BE(rec + 12),
    });
  }
  let cursor = 12 + numTables * 16;
  const placed = tables.map((table) => {
    cursor += (4 - (cursor % 4)) % 4;
    const next = { ...table, newOffset: cursor };
    cursor += table.length;
    return next;
  });
  const out = Buffer.alloc(cursor);
  ttc.copy(out, 0, faceOff, faceOff + 4);
  out.writeUInt16BE(numTables, 4);
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) {
    searchRange *= 2;
    entrySelector += 1;
  }
  searchRange *= 16;
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);
  for (let i = 0; i < placed.length; i += 1) {
    const table = placed[i];
    const rec = 12 + i * 16;
    out.write(table.tag, rec, 4, "latin1");
    out.writeUInt32BE(table.checksum >>> 0, rec + 4);
    out.writeUInt32BE(table.newOffset, rec + 8);
    out.writeUInt32BE(table.length, rec + 12);
    ttc.copy(out, table.newOffset, table.offset, table.offset + table.length);
  }
  return out;
}

function bufferHasAscii(buf, needle) {
  if (buf.includes(Buffer.from(needle))) return true;
  let from = 0;
  while (from < buf.length) {
    const start = buf.indexOf("stream", from);
    if (start < 0) return false;
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d) dataStart += 1;
    if (buf[dataStart] === 0x0a) dataStart += 1;
    const end = buf.indexOf("endstream", dataStart);
    if (end < 0) return false;
    let dataEnd = end;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0d) dataEnd -= 1;
    try {
      const inflated = zlib.inflateSync(buf.subarray(dataStart, dataEnd));
      if (inflated.includes(Buffer.from(needle))) return true;
    } catch {
      // 不是 flate，或这段不是字体 cmap。
    }
    from = end + 9;
  }
  return false;
}

function assertFontRendersQing(PDFDocument, fontPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => {
      const buf = Buffer.concat(chunks);
      if (!bufferHasAscii(buf, "9752")) {
        reject(new Error(`字体没有把「青」写进 ToUnicode：${fontPath}`));
        return;
      }
      resolve(buf);
    });
    doc.font(fontPath).fontSize(24).text("青岛");
    doc.end();
  });
}

async function prepareFont(PDFDocument) {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const cached = path.join(FONT_DIR, "PingFangSC-Regular.ttf");
  const sidecar = path.join(FONT_DIR, "PingFangSC-Regular.json");
  const ttcPath = fcFile("PingFang SC") || walkFind("/System/Library", (name) => name === "PingFang.ttc");
  if (ttcPath && fs.existsSync(cached) && fs.existsSync(sidecar)) {
    const meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    const stat = fs.statSync(ttcPath);
    if (meta.source === ttcPath && meta.size === stat.size) {
      await assertFontRendersQing(PDFDocument, cached);
      return { fontPath: cached, note: meta.note };
    }
  }
  if (ttcPath) {
    const ttc = fs.readFileSync(ttcPath);
    if (ttc.toString("latin1", 0, 4) !== "ttcf") throw new Error(`不是 TTC：${ttcPath}`);
    const numFonts = ttc.readUInt32BE(8);
    let chosen = -1;
    const seen = [];
    for (let i = 0; i < numFonts; i += 1) {
      const names = readFaceNames(ttc, i);
      seen.push(names.full || names.family || `face-${i}`);
      const full = names.full;
      const isScRegular = full === "PingFang SC Regular"
        || (full.startsWith("PingFang SC") && names.subFamily === "Regular" && !/Semi|Medium|Light|Thin|Bold|Heavy|Black|Italic|Ultralight/i.test(full));
      if (isScRegular) {
        chosen = i;
        break;
      }
    }
    if (chosen < 0) {
      throw new Error(`PingFang.ttc 里没有 PingFang SC Regular。看到：${seen.join(" | ")}`);
    }
    const ttf = extractFace(ttc, chosen);
    fs.writeFileSync(cached, ttf);
    const names = readFaceNames(ttc, chosen);
    const note = `从 ${ttcPath} 第 ${chosen} 面抽出 ${names.full || "PingFang SC Regular"}。pdfkit 不能直接用 TTC。`;
    fs.writeFileSync(sidecar, JSON.stringify({ source: ttcPath, size: fs.statSync(ttcPath).size, face: chosen, note }, null, 2));
    await assertFontRendersQing(PDFDocument, cached);
    return { fontPath: cached, note };
  }
  const fallback = fcFile("STHeiti") || walkFind("/System/Library", (name) => name === "STHEITI.ttf");
  if (!fallback || fallback.endsWith(".ttc")) {
    throw new Error("没有可用的 PingFang SC Regular，也没有单文件 STHEITI.ttf");
  }
  await assertFontRendersQing(PDFDocument, fallback);
  return { fontPath: fallback, note: `回退到 ${fallback}` };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapChars(text, size) {
  const chars = Array.from(text);
  const lines = [];
  for (let i = 0; i < chars.length; i += size) lines.push(chars.slice(i, i + size).join(""));
  return lines.length ? lines : [""];
}

function wrapPreferSpaces(text, size) {
  const parts = text.split(/(\s+)/).filter((part) => part.length > 0);
  const lines = [];
  let current = "";
  for (const part of parts) {
    const next = current + part;
    if (Array.from(next).length > size && current.trim()) {
      lines.push(current.trimEnd());
      current = part.trimStart();
    } else {
      current = next;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  const out = [];
  for (const line of lines) {
    if (Array.from(line).length <= size + 6) out.push(line);
    else out.push(...wrapChars(line, size));
  }
  return out.length ? out : [""];
}

function longFileName(stem, ext) {
  let name = stem;
  while (Array.from(name).length < 104) {
    const next = `${name}x`;
    if (Buffer.byteLength(next + ext) > 245) break;
    name = next;
  }
  const full = name + ext;
  if (Array.from(full).length < 100) {
    throw new Error(`超长文件名只有 ${Array.from(full).length} 字 / ${Buffer.byteLength(full)} 字节`);
  }
  if (Buffer.byteLength(full) > 255) throw new Error("文件名超过 255 字节");
  return full;
}

function dirOf(persona) {
  return path.join(OUT, `${persona.phone}-${persona.name}`);
}

function pushEntry(ctx, persona, filename, bytes, meta) {
  if (filename.includes("测试") || persona.name.includes("测试")) {
    throw new Error(`文件名或姓名含有禁止字样：${persona.name}/${filename}`);
  }
  const rel = `${persona.phone}-${persona.name}/${filename}`;
  ctx.entries.push({
    path: rel,
    ownerId: persona.id,
    owner: persona.name,
    uploadedBy: meta.uploadedBy || null,
    format: meta.format,
    pages: meta.pages,
    mess: meta.mess,
    formatNotes: meta.formatNotes || "",
    formatFidelity: meta.formatFidelity,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    versionGroup: meta.versionGroup || null,
    idCardSide: meta.idCardSide || null,
    ...(meta.openPassword ? { openPassword: meta.openPassword, ownerPassword: OWNER_PASSWORD } : {}),
  });
}

function writeBytes(ctx, persona, filename, bytes, meta) {
  const dir = dirOf(persona);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  pushEntry(ctx, persona, filename, bytes, meta);
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function buildTextPdf(ctx, persona, filename, pages, meta) {
  const doc = new ctx.libs.PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: { Title: filename, Author: persona.name, Producer: "dataset-v2-d1" },
    ...(meta.openPassword ? { userPassword: meta.openPassword, ownerPassword: OWNER_PASSWORD } : {}),
  });
  const done = collectPdf(doc);
  pages.forEach((paragraphs, index) => {
    if (index > 0) doc.addPage();
    paragraphs.forEach((paragraph, paragraphIndex) => {
      doc.font(ctx.fontPath).fontSize(paragraphIndex === 0 ? 16 : 11).fillColor("#222222");
      doc.text(paragraph, { lineGap: 4 });
      doc.moveDown(paragraphIndex === 0 ? 0.7 : 0.35);
    });
    doc.font(ctx.fontPath).fontSize(9).fillColor("#666666").text("现居青岛市，本文件为虚构示例。");
  });
  doc.end();
  const bytes = await done;
  writeBytes(ctx, persona, filename, bytes, {
    ...meta,
    format: "pdf",
    pages: pages.length,
    formatFidelity: "text-pdf",
  });
}

async function buildImagePdf(ctx, persona, filename, specs, meta) {
  const images = [];
  specs.forEach((spec, index) => {
    if (spec.copyOf != null) images.push(images[spec.copyOf]);
    else images.push(renderPaper(ctx, spec, index + 1));
  });
  const doc = new ctx.libs.PDFDocument({
    autoFirstPage: false,
    info: { Title: "scan", Producer: "dataset-v2-d1" },
  });
  const done = collectPdf(doc);
  for (const image of images) {
    doc.addPage({ size: "A4", margin: 0 });
    doc.image(image, 0, 0, { width: doc.page.width, height: doc.page.height });
  }
  doc.end();
  writeBytes(ctx, persona, filename, await done, {
    ...meta,
    format: "pdf",
    pages: images.length,
    formatFidelity: "image-only-pdf",
    formatNotes: meta.formatNotes || "页面先画成 JPEG，再嵌入 PDF，没有文字层。",
  });
}

function renderPaper(ctx, spec) {
  const { createCanvas } = ctx.libs.canvas;
  const w = 900;
  const h = 1273;
  const canvas = createCanvas(w, h);
  const g = canvas.getContext("2d");
  const rand = mulberry32(spec.seed || 1);
  g.fillStyle = spec.blank ? "#f3efe6" : "#f7f4ee";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#d5cfc3";
  g.lineWidth = 10;
  g.strokeRect(16, 16, w - 32, h - 32);
  if (!spec.blank) {
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(((spec.skew || -1.4) * Math.PI) / 180);
    g.translate(-w / 2, -h / 2);
    g.fillStyle = "#222222";
    g.font = "bold 34px WalkCJK";
    g.fillText(spec.title || "", 150, 150);
    g.font = "24px WalkCJK";
    let y = 210;
    for (const line of spec.lines || []) {
      for (const piece of wrapPreferSpaces(line, 26)) {
        g.fillText(piece, 150 + Math.floor(rand() * 6), y);
        y += 40;
        if (y > h - 180) break;
      }
    }
    g.restore();
  }
  for (let i = 0; i < 140; i += 1) {
    g.fillStyle = `rgba(70,60,40,${0.03 + rand() * 0.08})`;
    g.fillRect(rand() * w, rand() * h, 2 + rand() * 3, 2);
  }
  g.fillStyle = "#9d1c1c";
  g.font = "bold 28px WalkCJK";
  g.fillText(spec.stamp || "示例材料 非真实档案", 56, h - 64);
  return canvas.toBuffer("image/jpeg", 68);
}

function drawSilhouette(g, x, y, w, h, color) {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x + w / 2, y + h * 0.32, w * 0.28, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(x + w / 2, y + h * 0.92, w * 0.42, h * 0.28, 0, Math.PI, 0, true);
  g.fill();
  g.restore();
}

function idCard(ctx, persona, side, mime = "image/png") {
  const { createCanvas } = ctx.libs.canvas;
  const w = 1012;
  const h = 638;
  const canvas = createCanvas(w, h);
  const g = canvas.getContext("2d");
  g.fillStyle = side === "front" ? "#d7e6f5" : "#e7eef2";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#8fb4d6";
  g.fillRect(0, 0, w, 74);
  g.fillStyle = "#ffffff";
  g.font = "bold 36px WalkCJK";
  g.fillText(side === "front" ? "示例证件样张 · 正面" : "示例证件样张 · 反面", 32, 48);
  g.fillStyle = "#1c1c1c";
  g.font = "30px WalkCJK";
  const lines = side === "front"
    ? [
      `姓名  ${persona.name}`,
      `性别  ${persona.gender}     出生  ${persona.birthDate}`,
      `住址  青岛市示例路${persona.phone.slice(-3)}号（虚构）`,
      `公民身份号码  ${persona.idNumber}`,
    ]
    : [
      "签发机关  示例市公安局（虚构）",
      "有效期限  2020.01.01-2040.01.01（示例）",
      "没有国徽，没有防伪纹。",
      "不能当成真实身份证使用。",
    ];
  lines.forEach((line, index) => g.fillText(line, 36, 140 + index * 58));
  if (side === "front") {
    g.fillStyle = "#f4f7fb";
    g.fillRect(760, 110, 210, 280);
    drawSilhouette(g, 760, 120, 210, 250, "#5d7384");
    g.fillStyle = "#9d1c1c";
    g.font = "bold 24px WalkCJK";
    g.fillText("示例剪影", 786, 430);
  } else {
    g.fillStyle = "#c5ced6";
    g.fillRect(48, 390, 220, 70);
    g.fillStyle = "#333333";
    g.font = "22px WalkCJK";
    g.fillText("示例标记", 96, 434);
  }
  g.fillStyle = "#9d1c1c";
  g.fillRect(0, h - 92, w, 92);
  g.fillStyle = "#ffffff";
  g.font = "bold 52px WalkCJK";
  g.textAlign = "center";
  g.fillText("示例 非真实证件", w / 2, h - 30);
  if (mime === "image/jpeg") return canvas.toBuffer("image/jpeg", 82);
  return canvas.toBuffer("image/png");
}

function avatarPng(ctx, persona) {
  const { createCanvas } = ctx.libs.canvas;
  const canvas = createCanvas(480, 480);
  const g = canvas.getContext("2d");
  const hue = Array.from(persona.name).reduce((sum, ch) => sum + ch.codePointAt(0), 0) % 40;
  g.fillStyle = `hsl(${190 + hue}, 28%, 90%)`;
  g.fillRect(0, 0, 480, 480);
  drawSilhouette(g, 90, 40, 300, 340, `hsl(${200 + hue}, 18%, 42%)`);
  g.fillStyle = "#9d1c1c";
  g.fillRect(0, 400, 480, 80);
  g.fillStyle = "#ffffff";
  g.font = "bold 40px WalkCJK";
  g.textAlign = "center";
  g.fillText("示例", 240, 452);
  return canvas.toBuffer("image/png");
}

function portraitPng(ctx, persona) {
  const { createCanvas } = ctx.libs.canvas;
  const canvas = createCanvas(300, 400);
  const g = canvas.getContext("2d");
  g.fillStyle = "#d5dde3";
  g.fillRect(0, 0, 300, 400);
  drawSilhouette(g, 40, 30, 220, 300, "#5c6e7c");
  g.fillStyle = "#9d1c1c";
  g.fillRect(0, 348, 300, 52);
  g.fillStyle = "#ffffff";
  g.font = "bold 28px WalkCJK";
  g.textAlign = "center";
  g.fillText("示例", 150, 384);
  return canvas.toBuffer("image/png");
}

async function buildDocx(ctx, persona, filename, spec) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
    Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
    VerticalAlign, PageNumber,
  } = ctx.libs.docx;
  const font = { eastAsia: "宋体", ascii: "Times New Roman", hAnsi: "Times New Roman" };
  const run = (text, extra = {}) => new TextRun({
    text,
    bold: extra.bold,
    size: extra.size || 21,
    font,
    color: extra.color || "222222",
  });
  const border = { style: BorderStyle.SINGLE, size: 4, color: "888888" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const children = [];
  spec.blocks.forEach((block) => {
    if (block.kind === "break") {
      children.push(new Paragraph({ children: [run("")], pageBreakBefore: true }));
      return;
    }
    if (block.kind === "h") {
      children.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [run(block.text, { bold: true, size: 28 })] }));
      return;
    }
    if (block.kind === "p") {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [run(block.text, { size: block.size || 21 })] }));
      return;
    }
    if (block.kind === "mix") {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: block.runs.map((item) => run(item.text, item)),
      }));
      return;
    }
    if (block.kind === "image") {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
          type: "png",
          data: block.data,
          transformation: { width: block.width, height: block.height },
          altText: { name: "示例剪影", description: "几何剪影，不是真人照片", title: "示例" },
        })],
      }));
      return;
    }
    if (block.kind === "table") {
      const labelW = 2400;
      const valueW = block.photo ? 5866 : 8066;
      const photoW = 2200;
      const total = labelW + valueW + (block.photo ? photoW : 0);
      const span = Math.min(block.rows.length, 6);
      const rows = block.rows.map((row, index) => {
        const cells = [0, 1].map((col) => new TableCell({
          borders,
          width: { size: col === 0 ? labelW : valueW, type: WidthType.DXA },
          shading: col === 0 ? { fill: "F3F4F6", type: ShadingType.CLEAR } : undefined,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({ children: [run(row[col], { bold: col === 0, size: 20 })] })],
        }));
        if (block.photo && index === 0) {
          cells.push(new TableCell({
            borders,
            width: { size: photoW, type: WidthType.DXA },
            rowSpan: span,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 60, right: 60 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({
                  type: "png",
                  data: block.photo,
                  transformation: { width: 90, height: 120 },
                  altText: { name: "示例剪影", description: "表格里的几何剪影，不是真人证件照", title: "示例" },
                })],
              }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [run("示例", { size: 16 })] }),
            ],
          }));
        }
        return new TableRow({ cantSplit: true, children: cells });
      });
      children.push(new Table({
        width: { size: total, type: WidthType.DXA },
        columnWidths: block.photo ? [labelW, valueW, photoW] : [labelW, valueW],
        rows,
      }));
    }
  });
  const header = spec.header
    ? {
      default: new Header({
        children: [new Paragraph({ children: [run(spec.header, { size: 18, color: "555555" })] })],
      }),
    }
    : undefined;
  const footer = spec.footerLie
    ? {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            run("第 ", { size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], font, size: 18 }),
            run(` 页 / 共 ${spec.footerLie} 页`, { size: 18 }),
          ],
        })],
      }),
    }
    : undefined;
  const doc = new Document({
    styles: { default: { document: { run: { font: "宋体", size: 21 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 720, bottom: 860, left: 720, header: 360, footer: 360 },
          ...(spec.pageStart ? { pageNumbers: { start: spec.pageStart } } : {}),
        },
      },
      headers: header,
      footers: footer,
      children,
    }],
  });
  const bytes = await Packer.toBuffer(doc);
  writeBytes(ctx, persona, filename, bytes, {
    ...spec.meta,
    format: spec.meta.format || "docx",
    pages: spec.blocks.filter((block) => block.kind === "break").length + 1,
    formatFidelity: spec.meta.formatFidelity || "ooxml-docx",
  });
  return bytes;
}

async function buildWps(ctx, persona, filename, docxBytes, meta) {
  const zip = await ctx.libs.JSZip.loadAsync(docxBytes);
  const appFile = zip.file("docProps/app.xml");
  if (!appFile) throw new Error("docx 缺少 docProps/app.xml，不能改成 .wps");
  let app = await appFile.async("string");
  if (/<Application>[\s\S]*?<\/Application>/.test(app)) {
    app = app.replace(/<Application>[\s\S]*?<\/Application>/, "<Application>WPS Office</Application>");
  } else if (app.includes("</Properties>")) {
    app = app.replace("</Properties>", "<Application>WPS Office</Application></Properties>");
  } else if (/<Properties\b[^>]*\/>/.test(app)) {
    app = app.replace(/<Properties\b([^>]*)\/>/, "<Properties$1><Application>WPS Office</Application></Properties>");
  } else {
    throw new Error("docProps/app.xml 无法写入 Application");
  }
  zip.file("docProps/app.xml", app);
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  writeBytes(ctx, persona, filename, bytes, {
    ...meta,
    format: "wps",
    formatFidelity: "not-native-ole",
    formatNotes: "OOXML。Application 改成 WPS Office。不是带 WpsCustomData 的原生 OLE .wps。",
  });
}

async function buildEt(ctx, persona, filename, sheetName, rows, meta) {
  const wb = new ctx.libs.ExcelJS.Workbook();
  wb.creator = "WPS Office";
  wb.lastModifiedBy = "WPS Office";
  const sheet = wb.addWorksheet(sheetName);
  rows.forEach((row) => sheet.addRow(row));
  sheet.columns.forEach((column) => {
    column.width = 28;
  });
  const raw = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(raw);
  writeBytes(ctx, persona, filename, bytes, {
    ...meta,
    format: "et",
    pages: 1,
    formatFidelity: "not-native-ole",
    formatNotes: "ExcelJS 写出的 xlsx，扩展名改成 .et，creator 为 WPS Office。不是 WPS 原生 OLE .et。",
  });
}

function buildDoc(ctx, persona, filename, text, meta) {
  const txt = path.join(ctx.tmp, `${persona.id}-doc.txt`);
  const out = path.join(ctx.tmp, `${persona.id}-doc.doc`);
  fs.writeFileSync(txt, text, "utf8");
  try {
    execFileSync("textutil", ["-convert", "doc", txt, "-output", out], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`textutil 不能生成 .doc：${error.message}`);
  }
  const bytes = fs.readFileSync(out);
  if (bytes.subarray(0, 4).toString("hex") !== "d0cf11e0") {
    throw new Error("textutil 产物不是 OLE .doc");
  }
  writeBytes(ctx, persona, filename, bytes, {
    ...meta,
    format: "doc",
    pages: 1,
    formatFidelity: "ole-doc",
    formatNotes: "macOS textutil 从 UTF-8 文本转成的 OLE .doc。",
  });
}

function emitPng(ctx, persona, filename, bytes, meta) {
  writeBytes(ctx, persona, filename, bytes, { ...meta, format: "png", pages: 1, formatFidelity: "canvas-png" });
}

function emitJpeg(ctx, persona, filename, bytes, meta) {
  writeBytes(ctx, persona, filename, bytes, { ...meta, format: "jpg", pages: 1, formatFidelity: "canvas-jpeg" });
}

function emitHeic(ctx, persona, jpgName, heicName, meta) {
  const dir = dirOf(persona);
  const jpg = path.join(dir, jpgName);
  const heic = path.join(dir, heicName);
  fs.rmSync(heic, { force: true });
  try {
    execFileSync("sips", ["-s", "format", "heic", jpg, "--out", heic], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`sips 不能把 jpg 转成 HEIC：${error.message}`);
  }
  const bytes = fs.readFileSync(heic);
  if (!bytes.includes(Buffer.from("ftyp"))) throw new Error(`${heicName} 没有 ftyp，不像 HEIC`);
  pushEntry(ctx, persona, heicName, bytes, {
    ...meta,
    format: "heic",
    pages: 1,
    formatFidelity: "heic",
    formatNotes: "macOS sips 从同目录 jpg 转出。",
  });
}

function handwritten(ctx, persona, lines) {
  const { createCanvas } = ctx.libs.canvas;
  const canvas = createCanvas(900, 1273);
  const g = canvas.getContext("2d");
  const rand = mulberry32(Array.from(persona.name).reduce((sum, ch) => sum + ch.codePointAt(0), 17));
  g.fillStyle = "#f4f0e4";
  g.fillRect(0, 0, 900, 1273);
  g.strokeStyle = "#e2d3d3";
  for (let y = 150; y < 1200; y += 48) {
    g.beginPath();
    g.moveTo(60, y);
    g.lineTo(850, y);
    g.stroke();
  }
  g.fillStyle = "#243044";
  const pen = ctx.penFont || "WalkCJK";
  lines.forEach((line, index) => {
    let x = 64 + rand() * 16;
    const y = 148 + index * 56;
    g.font = `34px ${pen}`;
    for (const ch of Array.from(line)) {
      g.save();
      g.translate(x, y + (rand() - 0.5) * 7);
      g.rotate((rand() - 0.5) * 0.09);
      g.fillText(ch, 0, 0);
      g.restore();
      x += 32 + rand() * 5;
    }
  });
  g.fillStyle = "#9d1c1c";
  g.font = "bold 36px WalkCJK";
  g.fillText("示例材料 非真实档案", 70, 1210);
  return canvas.toBuffer("image/jpeg", 78);
}

function photoOfPaper(ctx, persona, lines) {
  const { createCanvas } = ctx.libs.canvas;
  const canvas = createCanvas(1000, 1400);
  const g = canvas.getContext("2d");
  g.fillStyle = "#8a6a45";
  g.fillRect(0, 0, 1000, 1400);
  g.save();
  g.translate(540, 720);
  g.rotate(-0.08);
  g.fillStyle = "#f7f4ee";
  g.fillRect(-360, -520, 720, 1040);
  g.fillStyle = "#222222";
  g.font = "bold 32px WalkCJK";
  g.fillText(lines[0], -320, -460);
  g.font = "24px WalkCJK";
  lines.slice(1).forEach((line, index) => g.fillText(line, -320, -390 + index * 40));
  g.restore();
  g.fillStyle = "#9d1c1c";
  g.font = "bold 36px WalkCJK";
  g.fillText("示例 拍照件", 40, 80);
  return canvas.toBuffer("image/jpeg", 76);
}

function slip(ctx, lines, banner) {
  const { createCanvas } = ctx.libs.canvas;
  const canvas = createCanvas(900, 640);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff8dc";
  g.fillRect(0, 0, 900, 640);
  g.strokeStyle = "#c4a15a";
  g.lineWidth = 8;
  g.strokeRect(16, 16, 868, 608);
  g.fillStyle = "#9d1c1c";
  g.font = "bold 42px WalkCJK";
  g.textAlign = "center";
  g.fillText(banner, 450, 90);
  g.fillStyle = "#222222";
  g.font = "30px WalkCJK";
  lines.forEach((line, index) => g.fillText(line, 450, 180 + index * 52));
  return canvas.toBuffer("image/jpeg", 80);
}

function mustQing(pages) {
  const text = pages.flat().join("\n");
  if (!text.includes("青岛")) throw new Error("文字稿缺少「青岛」");
  return pages;
}

async function buildAll(ctx) {
  const P = (name) => {
    const persona = ctx.byName[name];
    if (!persona) throw new Error(`人设缺少 ${name}`);
    return persona;
  };

  const zhang = P("张建国");
  emitPng(ctx, zhang, "身份证正面.png", idCard(ctx, zhang, "front"), {
    mess: ["示例证件"],
    idCardSide: "front",
    formatNotes: "大字「示例 非真实证件」。几何剪影，没有国徽。",
  });
  emitPng(ctx, zhang, "身份证反面.png", idCard(ctx, zhang, "back"), {
    mess: ["示例证件"],
    idCardSide: "back",
    formatNotes: "签发机关写的是虚构的示例市公安局。",
  });
  await buildImagePdf(ctx, zhang, "纸质简历扫描.pdf", [
    {
      seed: 6011,
      skew: -7.4,
      title: "张建国 个人简历",
      lines: [
        "男，1979年3月生。想找仓库或物流现场的活。",
        `${CO.logistics}  2012.04—2019.11  司机`,
        `${CO.seafood}  2019.12—2024.02  跟车`,
        "2024.03 之后空着，没有再上班。",
        "电话原先印的是 1380000601，少一位，",
        `后来用圆珠笔改成 ${zhang.phone}。`,
        "字小，折过四折，边角发毛。",
      ],
    },
    {
      seed: 6012,
      skew: 5.6,
      title: "能干什么",
      lines: [
        "会开厢货，夜路也跑过。不指望坐办公室。",
        "证件都在身上，扫描完还要打 3 份黑白。",
        "屏幕上的小字看不清，不会在机器上打字。",
        "青岛市示例路601号（虚构）。",
      ],
    },
  ], { mess: ["扫描歪斜", "空白期", "错别字", "电话用笔改过"] });

  const ouyang = P("欧阳春梅");
  await buildTextPdf(ctx, ouyang, "女儿发来的简历.pdf", mustQing([
    [
      "欧阳春梅",
      "女，54 岁。超市理货做了十几年，现在想转成仓管或收货。",
      `${CO.trade}，2011 年到 2025 年，理货、收货都干过。`,
      "2025 年 8 月岗位没了。",
      "照片见附件。女儿说微信里有证件照，这个 PDF 里没嵌进去。",
      `手机 ${ouyang.phone}。青岛市示例路602号（虚构）。`,
    ],
    [
      "想打印的东西",
      "黑白 2 份就行。彩色不会弄。",
      "文件是女儿前天夜里发到微信的，她自己不大会从手机往外导。",
    ],
  ]), {
    mess: ["照片未嵌入", "微信文件"],
    formatNotes: "正文写了有照片，文件里没有图片。",
  });

  const sun = P("孙伟");
  const sunBase = [
    { kind: "h", text: "孙伟" },
    { kind: "p", text: `男，41 岁。${CO.elec} 品质员，2026 年 3 月被裁。` },
    { kind: "p", text: "电话写的是 1380000603，少了一位，投之前没核对。" },
    { kind: "p", text: "期望：还做品质，或者现场班长。青岛市示例路603号（虚构）。" },
    { kind: "p", text: "自我评价：做事仔细。这一版是 U 盘里最早的那份。" },
  ];
  await buildDocx(ctx, sun, "新建 Microsoft Word 文档.docx", {
    blocks: sunBase,
    meta: { mess: ["同名不同版本", "错别字"], versionGroup: "sunwei", formatNotes: "电话少写一位，不是另一位人设的号码。" },
  });
  await buildDocx(ctx, sun, "新建 Microsoft Word 文档(1).docx", {
    blocks: [
      { kind: "h", text: "孙伟" },
      { kind: "p", text: `男，41 岁。${CO.elec} 品质员，2026 年 3 月被裁。` },
      { kind: "p", text: "电话仍是 1380000603，少了一位。" },
      { kind: "p", text: "期望改成：仓库主管也行，不限品质。" },
      { kind: "p", text: "这一版是另存时 Word 自动加的 (1)，内容改过期望岗位。" },
    ],
    meta: { mess: ["同名不同版本"], versionGroup: "sunwei" },
  });
  await buildDocx(ctx, sun, "简历最新(2).docx", {
    blocks: [
      { kind: "h", text: "孙伟 简历最新" },
      { kind: "p", text: `手机 ${sun.phone}。这一版把少写的那一位补上了。` },
      { kind: "p", text: `2016—2026 ${CO.elec}。青岛市示例路603号（虚构）。` },
      { kind: "p", text: "自我评价多写了一句：能上夜班，接受倒班。" },
    ],
    meta: { mess: ["同名不同版本"], versionGroup: "sunwei", formatNotes: "文件名像网盘里叠出来的第三份。" },
  });
  buildDoc(ctx, sun, "个人简历.doc", [
    "孙伟",
    `男，41岁。${CO.elec}。`,
    "电话 1380000603，少写了一位。",
    "这一份是 U 盘里用老版本 Word 存的，正文还是第一版。",
    "现居青岛市（虚构）。",
  ].join("\n"), { mess: ["同名不同版本", "错别字"] });

  const han = P("韩冰");
  const hanPhoto = portraitPng(ctx, han);
  const hanDocx = await buildDocx(ctx, han, "表格简历.docx", {
    blocks: [
      { kind: "h", text: "表格简历" },
      { kind: "p", text: "原岗位写成了「会记」，保存前没改回来。" },
      {
        kind: "table",
        photo: hanPhoto,
        rows: [
          ["姓名", han.name],
          ["性别 / 出生", `${han.gender} / ${han.birthDate}`],
          ["手机", han.phone],
          ["原岗位", "会记"],
          ["最近单位", CO.trade],
          ["现居", "青岛市示例路604号（虚构）"],
          ["想做的事", "出纳、统计、仓库对账都行"],
          ["说明", "证件照用的是示例剪影，不是本人照片。"],
        ],
      },
      { kind: "break" },
      { kind: "h", text: "工作" },
      { kind: "p", text: `${CO.trade}  2014.07—2026.05  会记` },
      { kind: "p", text: "负责进销存表格。Excel 用得熟，凭证装订也干。英文几乎不用。" },
      { kind: "break" },
      { kind: "h", text: "备注" },
      { kind: "p", text: "U 盘里还有一份个人情况表，扩展名是 .et。" },
    ],
    meta: { mess: ["错别字", "表格排版"], formatNotes: "三页。表格右上是剪影。" },
  });
  void hanDocx;
  emitPng(ctx, han, "示例头像.png", avatarPng(ctx, han), {
    mess: ["示例头像"],
    formatNotes: "几何剪影，不是真人。",
  });
  await buildEt(ctx, han, "个人情况表.et", "个人情况", [
    ["项目", "内容"],
    ["姓名", han.name],
    ["手机", han.phone],
    ["原岗位", "会记"],
    ["单位", CO.trade],
    ["说明", "示例表，错别字故意留着。"],
  ], { mess: ["错别字", "表格排版"] });

  const zheng = P("郑大山");
  emitPng(ctx, zheng, "身份证正面.png", idCard(ctx, zheng, "front"), { mess: ["示例证件"], idCardSide: "front" });
  emitPng(ctx, zheng, "身份证反面.png", idCard(ctx, zheng, "back"), { mess: ["示例证件"], idCardSide: "back" });
  emitJpeg(ctx, zheng, "求职登记一页.jpg", handwritten(ctx, zheng, [
    "求职登记（一页）",
    `姓名 ${zheng.name}  男  1967年5月`,
    `电话 ${zheng.phone}`,
    "想找门卫、看车、半天的零活。",
    `${CO.property} 干过保安，2024 年合同到期。`,
    "要复印身份证。原件带来了。",
    "青岛市示例路605号（虚构）。",
  ]), { mess: ["手写", "一页"] });

  const lin = P("林晓燕");
  await buildTextPdf(ctx, lin, `${MOJIBAKE}(1).pdf`, mustQing([
    [
      "林晓燕",
      "女，33 岁。随家人来青岛，之前在外地做门店陈列。",
      `${CO.trade} 的岗位看过，还没定。`,
      `手机 ${lin.phone}。`,
      "这个文件名是微信再转发一次后变成的乱码，后面还带 (1)。",
    ],
  ]), { mess: ["乱码文件名"], formatNotes: "文件名按 UTF-8「简历」被当成 Windows-1252 之后的样子，并加 (1)。" });

  const ma = P("马犇");
  await buildTextPdf(ctx, ma, `${MOJIBAKE}.pdf`, mustQing([
    [
      "马犇",
      "男，34 岁。返乡后来青岛跑配送。不注册会员。",
      `${CO.delivery}  2023—2025  分拣、跟车。`,
      "简厉是朋友用手机 WPS 存的，错字没改。",
      `电话 ${ma.phone}。`,
    ],
    [
      "备注",
      "文件名在微信里已经变成乱码。他不打算改名，打印店认内容就行。",
      "青岛市示例路608号（虚构）。",
    ],
  ]), { mess: ["乱码文件名", "错别字"], formatNotes: "错字「简厉」。文件名不是正常中文。" });

  const mai = P("买买提·吐尔逊");
  emitJpeg(ctx, mai, "身份证正面.jpg", idCard(ctx, mai, "front", "image/jpeg"), {
    mess: ["示例证件"],
    idCardSide: "front",
    formatNotes: "JPEG 供 sips 转 HEIC。大字「示例 非真实证件」仍在。",
  });
  emitJpeg(ctx, mai, "身份证反面.jpg", idCard(ctx, mai, "back", "image/jpeg"), {
    mess: ["示例证件"],
    idCardSide: "back",
  });
  emitHeic(ctx, mai, "身份证正面.jpg", "身份证正面.heic", { mess: ["iPhone HEIC", "示例证件"], idCardSide: "front" });
  emitHeic(ctx, mai, "身份证反面.jpg", "身份证反面.heic", { mess: ["iPhone HEIC", "示例证件"], idCardSide: "back" });
  await buildTextPdf(ctx, mai, "一页简历.pdf", mustQing([
    [
      "买买提·吐尔逊",
      "男，29 岁。外卖和餐饮后厨都做过。",
      `${CO.catering}  2021—2024  后厨帮工。`,
      `${CO.delivery}  2024 至今  配送。`,
      `手机 ${mai.phone}。身份证复印一起带走。`,
      "相册里的证件是 iPhone 拍的 HEIC。青岛市示例路609号（虚构）。",
    ],
  ]), { mess: ["一页"] });

  const li = P("李秀兰");
  emitPng(ctx, li, "身份证正面.png", idCard(ctx, li, "front"), { mess: ["示例证件"], idCardSide: "front" });
  emitPng(ctx, li, "身份证反面.png", idCard(ctx, li, "back"), { mess: ["示例证件"], idCardSide: "back" });
  emitJpeg(ctx, li, "手写简历.jpg", handwritten(ctx, li, [
    "李秀兰  女  52岁",
    "干家政。没有智能手机，不登录。",
    `${CO.house}`,
    "擦玻璃、做饭、接送小孩都不接。",
    "只做白班钟点工。",
    `电话让邻居代接 ${li.phone}`,
    "这页是服务站帮着照的手写稿。",
    "青岛市示例路610号（虚构）。",
  ]), { mess: ["手写", "无智能手机"] });

  const chen = P("陈磊");
  const chenName = longFileName(
    "陈磊-装修零工个人简历-青岛浮山某装修工程有限公司学徒半年-微信文件传输助手-二零二六年九月二十七日夜里保存-请打印两份黑白单面-不要用文件夹里的旧版本-",
    ".pdf",
  );
  await buildTextPdf(ctx, chen, chenName, mustQing([
    [
      "陈磊",
      `男，26 岁。${CO.fitout} 学徒半年，现在自己接零活。`,
      "责人心还行，这词写错了，懒得改。",
      `手机 ${chen.phone}。文件名被手机拉得很长。`,
      "青岛市示例路611号（虚构）。",
    ],
  ]), { mess: ["超长文件名", "错别字"] });

  const yang = P("杨秀珍");
  await buildTextPdf(ctx, yang, "自我介绍.pdf", mustQing([
    [
      "杨秀珍",
      "女，45 岁。小区保洁。材料是儿子从微信发来的。",
      `${CO.property}  2019 至今  楼道和院落。`,
      `手机 ${yang.phone}。`,
      "另外一张是健康证明示例，不能当体检报告。",
    ],
  ]), { mess: ["微信文件"] });
  emitJpeg(ctx, yang, "健康证明示例.jpg", slip(ctx, [
    "这不是体检报告。",
    "不写病情，不写金额。",
    "只用来走查打印和复印。",
    yang.name,
  ], "示例 非真实证件"), { mess: ["示例证件"], formatNotes: "大字示例。没有病情，没有金额。" });

  const guo = P("郭鹏");
  emitJpeg(ctx, guo, "拍照的简历.jpg", photoOfPaper(ctx, guo, [
    "郭鹏  男  31岁",
    "搬家、装卸。",
    CO.delivery,
    `电话 ${guo.phone}`,
    "纸是斜着拍的，左边被切掉一截。",
    "青岛市示例路613号（虚构）。",
    "没有第二页。",
  ]), { mess: ["扫描歪斜", "拍照歪斜"] });

  const zhouMin = P("周敏");
  await buildTextPdf(ctx, zhouMin, "简历.pdf", mustQing([
    [
      "周敏",
      "女，23 岁。快递分拣。已经是会员，想把一页简历打出来。",
      `${CO.delivery}  2024.07 至今  夜班分拣。`,
      `手机 ${zhouMin.phone}。青岛市示例路614号（虚构）。`,
    ],
  ]), { mess: ["一页"] });

  const wang = P("王堃");
  const wangBlocks = (changed) => [
    { kind: "h", text: "王堃  Personal Resum" },
    { kind: "mix", runs: [{ text: "教育背景  ", bold: true }, { text: `${SCHOOL}  物流管理  2022—2026，English name left blank。` }] },
    { kind: "p", text: "1. 教育背景写在上面了。" },
    { kind: "p", text: "1. 实习又从 1 开始编号。" },
    { kind: "p", text: `4. 技能跳过了 2 和 3。熟悉 Office 与 Photoshop，CET-4 426。` },
    { kind: "break" },
    { kind: "h", text: "实习" },
    { kind: "p", text: changed
      ? `${CO.ecom}  2025.07—2025.09  客服实习。这一句在 (1) 里改成了客服兼仓库对单。`
      : `${CO.ecom}  2025.07—2025.09  客服实习。` },
    { kind: "p", text: "页眉是 Personal Resum，少了一个 e。页脚写共 9 页，正文只有 3 页，页码从 3 起。" },
    { kind: "break" },
    { kind: "h", text: "技能" },
    { kind: "p", text: `手机 ${wang.phone}。青岛市示例路615号（虚构）。` },
    { kind: "p", text: "同内容另存了一份 .wps，给只用 WPS 的同学。" },
  ];
  const wangDocx = await buildDocx(ctx, wang, "王堃-个人简历.docx", {
    blocks: wangBlocks(false),
    header: `Personal Resum    ${wang.name}    ${SCHOOL}`,
    footerLie: "9",
    pageStart: 3,
    meta: { mess: ["错别字", "中英混排", "页眉页脚", "页码错乱", "同名不同版本"], versionGroup: "wangkun" },
  });
  await buildWps(ctx, wang, "王堃-个人简历.wps", wangDocx, {
    mess: ["同名不同版本", "中英混排"],
    pages: 3,
    versionGroup: "wangkun",
  });
  await buildDocx(ctx, wang, "个人简历(1).docx", {
    blocks: wangBlocks(true),
    header: `Personal Resum    ${wang.name}    ${SCHOOL}`,
    footerLie: "9",
    pageStart: 3,
    meta: { mess: ["同名不同版本", "页眉页脚", "页码错乱"], versionGroup: "wangkun", formatNotes: "只改了实习那一句。" },
  });
  emitPng(ctx, wang, "示例头像.png", avatarPng(ctx, wang), { mess: ["示例头像"] });

  const zhuge = P("诸葛小雨");
  await buildDocx(ctx, zhuge, "诸葛小雨-中文简历.docx", {
    blocks: [
      { kind: "h", text: "诸葛小雨" },
      { kind: "p", text: `女，23 岁。${SCHOOL} 行政管理，2026 年应届。` },
      { kind: "p", text: `${CO.trade}  2025 暑假  前台实习两个月。` },
      { kind: "p", text: `手机 ${zhuge.phone}。青岛市示例路616号（虚构）。` },
      { kind: "break" },
      { kind: "p", text: "学生会干事。中文这一版有两页，英文版和一页版是另外两个文件。" },
    ],
    meta: { mess: ["同名不同版本"], versionGroup: "zhuge" },
  });
  await buildDocx(ctx, zhuge, "诸葛小雨-英文简历.docx", {
    blocks: [
      { kind: "h", text: "ZHUGE Xiaoyu  /  诸葛小雨" },
      { kind: "p", text: "Educaton: sample college in Huangdao, administration, class of 2026." },
      { kind: "p", text: "Internship: front desk, two months. Available for 实习 after July." },
      { kind: "p", text: `Mobile ${zhuge.phone}. This file mixes English and 中文 on purpose.` },
    ],
    meta: { mess: ["中英混排", "错别字", "同名不同版本"], versionGroup: "zhuge", formatNotes: "Educaton 少了一个 a。" },
  });
  await buildDocx(ctx, zhuge, "诸葛小雨-一页简历.docx", {
    blocks: [
      { kind: "h", text: "诸葛小雨 · 一页" },
      { kind: "p", text: `${SCHOOL} / 行政管理 / 2026应届 / ${zhuge.phone}` },
      { kind: "p", text: "实习只留了一句：前台。技能：Office。青岛市示例路616号（虚构）。" },
    ],
    meta: { mess: ["同名不同版本", "一页"], versionGroup: "zhuge" },
  });
  emitPng(ctx, zhuge, "示例头像.png", avatarPng(ctx, zhuge), { mess: ["示例头像"] });

  const wu = P("吴迪");
  await buildDocx(ctx, wu, "招聘网站导出.docx", {
    blocks: [
      { kind: "p", text: "简历编号：EXP-示例-000617" },
      { kind: "p", text: "来源：示例招聘页面导出（虚构，不是真实招聘网站）" },
      { kind: "p", text: `姓名：${wu.name}` },
      { kind: "p", text: `手机：${wu.phone}` },
      { kind: "p", text: "期望职位：|" },
      { kind: "p", text: "自我评价：" },
      { kind: "p", text: "能适应倒班。这段在导出时重复了两遍。能适应倒班。这段在导出时重复了两遍。" },
      { kind: "p", text: `${SCHOOL} 2026 应届。青岛市示例路617号（虚构）。` },
    ],
    meta: { mess: ["错别字", "导出残留"], formatNotes: "期望职位是一根竖线，自我评价重复。" },
  });

  const xu = P("徐梦洁");
  await buildDocx(ctx, xu, "简历.docx", {
    blocks: [
      { kind: "h", text: "徐梦洁" },
      { kind: "p", text: `女，24 岁。${SCHOOL} 研究生应届，方向是公共管理。` },
      { kind: "p", text: "科研成果另表，扩展名 .et。" },
      { kind: "p", text: `手机 ${xu.phone}。青岛市示例路618号（虚构）。` },
    ],
    meta: { mess: ["表格排版"] },
  });
  await buildEt(ctx, xu, "科研成果清单.et", "科研成果", [
    ["成果名称", "年份", "本人角色", "备注"],
    ["示例·社区就业服务流程观察", "2025", "第一作者", "课程论文，虚构题目"],
    ["示例·窗口排队时间记录", "2026", "参与整理", "没有刊号，没有金额"],
  ], { mess: ["表格排版"], formatNotes: "没有真实论文题名，没有金额。" });
  emitPng(ctx, xu, "示例头像.png", avatarPng(ctx, xu), { mess: ["示例头像"] });

  const he = P("何俊");
  const heDocx = await buildDocx(ctx, he, "何俊-半页简历.wps.docx-temp", {
    blocks: [
      { kind: "h", text: "何俊" },
      { kind: "p", text: `男，21 岁。${VOCATIONAL} 机电，2026 年毕业。还不是会员。` },
      { kind: "p", text: "半页就写完了，下面空着。没有实习。" },
      { kind: "p", text: `手机 ${he.phone}。青岛市示例路619号（虚构）。` },
    ],
    meta: { mess: ["半页"], format: "docx" },
  });
  await buildWps(ctx, he, "何俊-半页简历.wps", heDocx, { mess: ["半页"], pages: 1 });
  fs.rmSync(path.join(dirOf(he), "何俊-半页简历.wps.docx-temp"));
  ctx.entries = ctx.entries.filter((entry) => !entry.path.endsWith("何俊-半页简历.wps.docx-temp"));

  const sima = P("司马晴");
  await buildTextPdf(ctx, sima, "简历.pdf", mustQing([
    [
      "司马晴",
      `女，22 岁。${SCHOOL} 视觉传达应届。`,
      "作品集是加密 PDF，密码写在旁边的备忘录纸条上，简历本身不加密。",
      `手机 ${sima.phone}。青岛市示例路620号（虚构）。`,
    ],
  ]), { mess: ["加密"] });
  await buildTextPdf(ctx, sima, "作品集.pdf", mustQing([
    ["作品集 1 / 4", `${CO.catering} 菜单草稿。虚构练习，不是真实客户。`],
    ["作品集 2 / 4", "海报只留了标题和色块说明，没有别人的照片。"],
    ["作品集 3 / 4", "延展：杯套、桌牌。页数故意做成 4 页。"],
    ["作品集 4 / 4", "打开密码不印在这一页。看同目录的备忘录纸条。"],
  ]), {
    mess: ["加密"],
    openPassword: OPEN_PASSWORD,
    formatNotes: "需要打开密码。所有者口令另存，终端输出不打印。",
  });
  const memo = [
    "司马晴作品集打开密码备忘。",
    `打开密码：${OPEN_PASSWORD}`,
    "这是走查示例，不是真实账号密码。",
    "作品集 4 页。简历那份没有加密。",
    "现居青岛市（虚构）。",
  ].join("\n");
  writeBytes(ctx, sima, "备忘录-密码.txt", Buffer.from(memo, "utf8"), {
    format: "txt",
    pages: 1,
    mess: ["加密"],
    formatFidelity: "plain-text",
    formatNotes: "密码只出现在这个纸条和 manifest 的对应字段。",
  });
  emitPng(ctx, sima, "示例头像.png", avatarPng(ctx, sima), { mess: ["示例头像"] });

  const ding = P("丁一鸣");
  await buildDocx(ctx, ding, "简历.docx", {
    blocks: [
      { kind: "h", text: "丁一鸣" },
      { kind: "p", text: `${SCHOOL}  2024.06 本科毕业。` },
      { kind: "p", text: "2024.7—2026.6 考研空白期，两次都没往下走，期间没有工作。不写录取学校。" },
      { kind: "p", text: `手机 ${ding.phone}。青岛市示例路621号（虚构）。至今未就业。` },
    ],
    meta: { mess: ["空白期"] },
  });

  const liu = P("刘喆");
  await buildDocx(ctx, liu, "表格简历.docx", {
    blocks: [
      { kind: "h", text: "刘喆  表格简历" },
      {
        kind: "table",
        photo: portraitPng(ctx, liu),
        rows: [
          ["姓名", liu.name],
          ["性别 / 出生", `${liu.gender} / ${liu.birthDate}`],
          ["手机", liu.phone],
          ["最近工作", `${CO.elec} 文员，2016.03—2021.06`],
          ["2021.6 至今", "空白期，在家带孩子，大约五年没有上班。"],
          ["现居", "青岛市示例路622号（虚构）"],
          ["说明", "照片是示例剪影。人可能会中途去接孩子。"],
        ],
      },
      { kind: "break" },
      { kind: "p", text: "第二页是空的，她说想再补一段，当天没写完。" },
      { kind: "break" },
      { kind: "p", text: "第三页只留了打印要求：黑白 2 份，不要彩打。" },
    ],
    meta: { mess: ["空白期", "表格排版"], formatNotes: "约五年空白写在表格里。" },
  });

  const zhao = P("赵卫东");
  const veteran = [];
  for (let i = 1; i <= 48; i += 1) {
    const spec = {
      seed: 62300 + i,
      skew: i % 5 === 0 ? -7.5 : (i % 2 === 0 ? 4.2 : -3.6),
      title: `示例·某部材料  第 ${i} 页`,
      lines: [
        `赵卫东，1998 年生。2018-09 入伍，2026-03 退役。单位只写示例·某部。`,
        `本页是虚构扫描摘录 ${i}，不是真实档案，也不写补贴金额。`,
        i === 1 ? "退役后打算回青岛找一份现场管理或仓储的工作。" : "训练、鉴定、安置意愿都是示例句子。",
        `手机 ${zhao.phone}。`,
      ],
    };
    if (i === 8 || i === 27 || i === 41) {
      spec.blank = true;
      spec.title = "";
      spec.lines = [];
    }
    if (i === 12) spec.title = "示例·某部材料  第 13 页";
    if (i === 13) spec.title = "示例·某部材料  第 12 页";
    if (i === 16) spec.title = "示例·某部材料  第 19 页";
    if (i === 20) {
      veteran.push({ copyOf: 18, seed: spec.seed });
      continue;
    }
    if (i === 36) {
      veteran.push({ copyOf: 34, seed: spec.seed });
      continue;
    }
    veteran.push(spec);
  }
  await buildImagePdf(ctx, zhao, "退役材料扫描件.pdf", veteran, {
    mess: ["扫描歪斜", "空白页", "页码错乱", "重复页", "大扫描"],
    formatNotes: "48 页，全部是图片。第 8/27/41 页几乎空白；12 与 13 页码对调；16 页标成第 19 页；20 页复制 19 页，36 页复制 35 页。",
  });

  const gui = P("周桂芳");
  const guiName = longFileName(
    "周博上传-给妈妈周桂芳打印的说明-城阳社区服务站-二零二六年九月二十八日晚上用手机微信发出-明天上午来取-文件名被聊天记录拉得很长-",
    ".docx",
  );
  await buildDocx(ctx, gui, guiName, {
    blocks: [
      { kind: "h", text: "给妈妈打印的说明" },
      { kind: "p", text: "上传的人是儿子周博。这份材料算在周桂芳名下，她自己没有智能手机。" },
      { kind: "p", text: "请打黑白 1 份。她看不懂屏幕，可能让工作人员代点。" },
      { kind: "p", text: "取件纸条上的号码是道具，不是系统生成的取件码。" },
      { kind: "p", text: "青岛市示例路624号（虚构）。" },
    ],
    meta: {
      mess: ["超长文件名"],
      uploadedBy: "周博",
      formatNotes: "周博是虚构的儿子，不是独立人设。",
    },
  });
  emitJpeg(ctx, gui, "取件纸条.jpg", slip(ctx, [
    "号码 QX-样例-0929",
    "不是系统取件码。",
    "明天来拿儿子周博上传的材料。",
    "过期了就重新问工作人员。",
  ], "示例纸条"), { mess: ["取件道具"], formatNotes: "纸条上的号码不能当系统取件码。" });

  const qian = P("钱芳");
  await buildDocx(ctx, qian, "兼职简历.docx", {
    blocks: [
      { kind: "h", text: "钱芳" },
      { kind: "p", text: "女。1994年9月29日出生，走查当天过生日。孩子在旁边，容易点错。" },
      { kind: "p", text: `想找上午的兼职。${CO.house} 做过钟点工，${CO.catering} 也问过传菜。` },
      { kind: "p", text: `手机 ${qian.phone}。青岛市示例路625号（虚构）。` },
    ],
    meta: { mess: ["错别字"], formatNotes: "生日就是 asOf 当天。" },
  });

  const feng = P("冯国华");
  await buildImagePdf(ctx, feng, "两页说明扫描.pdf", [
    {
      seed: 6261,
      skew: -6.8,
      title: "冯国华要打印的东西",
      lines: [
        "男，63 岁。退休后找点零活，门卫或者发传单都行。",
        "第一页是说明，第二页是材料名单的手写底。",
        "金额不要写。份数和页数在另一份 .et 里。",
        `电话 ${feng.phone}。青岛市示例路626号（虚构）。`,
      ],
    },
    {
      seed: 6262,
      skew: 5.2,
      title: "手写底",
      lines: [
        "1 两页说明 打 1 份",
        "2 个人情况 打 2 份",
        "3 不要彩打",
        "纸有点斜，边上一行被阴影吃掉了。",
      ],
    },
  ], { mess: ["扫描歪斜"] });
  await buildEt(ctx, feng, "要打印的材料.et", "打印清单", [
    ["材料名", "页数", "份数"],
    ["两页说明扫描", "2", "1"],
    ["个人情况口头说明", "1", "2"],
    ["不要写金额", "", ""],
  ], { mess: ["表格排版"], formatNotes: "只有材料名、页数、份数，没有补贴金额。" });

  const shangguan = P("上官燕");
  await buildTextPdf(ctx, shangguan, "简历.pdf", mustQing([
    [
      "上官燕",
      "女，29 岁。灵活就业，做过物业客服和活动执行。",
      `${CO.property}  2022—2025  客服。`,
      `手机 ${shangguan.phone}。青岛市示例路627号（虚构）。`,
    ],
  ]), { mess: ["一页"] });

  const luo = P("罗小军");
  const luoName = longFileName(
    "罗小军-职校实习鉴定扫描说明-微信文件传输助手转发-示例黄岛某职校-二零二六届-请按这个超长文件名的版本打印-旧的个人简历不要用-",
    ".pdf",
  );
  await buildTextPdf(ctx, luo, luoName, mustQing([
    [
      "罗小军",
      `男，19 岁。${VOCATIONAL} 实习。`,
      `${CO.fitout}  2026.03 起  现场记录，每周三天。`,
      `手机 ${luo.phone}。这个 PDF 的文件名是微信转发拉长的。`,
      "青岛市示例路628号（虚构）。",
    ],
  ]), { mess: ["超长文件名"] });
  await buildDocx(ctx, luo, "个人简历.docx", {
    blocks: [
      { kind: "h", text: "罗小军" },
      { kind: "p", text: `${VOCATIONAL}。实习从 2026 年 3 月开始，单位是 ${CO.fitout}。` },
      { kind: "p", text: `手机 ${luo.phone}。青岛市示例路628号（虚构）。` },
    ],
    meta: { mess: ["同名不同版本"], versionGroup: "luo" },
  });
  await buildDocx(ctx, luo, "个人简历(1).docx", {
    blocks: [
      { kind: "h", text: "罗小军" },
      { kind: "p", text: `${VOCATIONAL}。实习改成 2026 年 4 月才到岗，单位仍是 ${CO.fitout}。` },
      { kind: "p", text: `手机 ${luo.phone}。这一份是 (1)，和没有序号的那份不是同一句。` },
    ],
    meta: { mess: ["同名不同版本"], versionGroup: "luo" },
  });

  const huang = P("黄志强");
  fs.mkdirSync(dirOf(huang), { recursive: true });
  ctx.withoutFiles.push({
    id: huang.id,
    name: huang.name,
    phone: huang.phone,
    reason: "人设把 U 盘忘在家里，这次不带文件。目录留空。",
  });
}

function walkFiles(dir, rel = "") {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) out.push(...walkFiles(abs, relPath));
    else out.push(relPath);
  }
  return out;
}

async function zipText(JSZip, abs, inner) {
  const zip = await JSZip.loadAsync(fs.readFileSync(abs));
  const file = zip.file(inner);
  return file ? file.async("string") : "";
}

async function selfCheck(ctx) {
  const problems = [];
  const disk = walkFiles(OUT).filter((rel) => rel !== "manifest.json").sort();
  const listed = ctx.entries.map((entry) => entry.path).sort();
  if (disk.join("\n") !== listed.join("\n")) {
    const missing = listed.filter((rel) => !disk.includes(rel));
    const extra = disk.filter((rel) => !listed.includes(rel));
    if (missing.length) problems.push(`manifest 有但磁盘没有：${missing.join("，")}`);
    if (extra.length) problems.push(`磁盘有但 manifest 没有：${extra.join("，")}`);
  }
  const dirs = fs.readdirSync(OUT).filter((name) => fs.statSync(path.join(OUT, name)).isDirectory());
  if (dirs.length !== 28) problems.push(`人设目录 ${dirs.length} 个，应为 28`);
  for (const persona of ctx.personas.personas) {
    const dir = `${persona.phone}-${persona.name}`;
    if (!dirs.includes(dir)) problems.push(`缺少目录 ${dir}`);
    if (persona.name.includes("测试")) problems.push(`姓名含测试：${persona.name}`);
  }
  const empty = ctx.withoutFiles.map((item) => item.name);
  if (empty.join(",") !== "黄志强") problems.push(`无文件的人设应为黄志强，实际 ${empty.join(",")}`);
  const huangDir = path.join(OUT, `${ctx.byName["黄志强"].phone}-黄志强`);
  if (fs.readdirSync(huangDir).length !== 0) problems.push("黄志强目录不是空的");

  const tags = new Set(ctx.entries.flatMap((entry) => entry.mess));
  for (const tag of NEED_MESS) {
    if (!tags.has(tag)) problems.push(`乱点没有覆盖：${tag}`);
  }
  const groups = new Map();
  for (const entry of ctx.entries) {
    if (!entry.versionGroup) continue;
    const list = groups.get(entry.versionGroup) || [];
    list.push(entry);
    groups.set(entry.versionGroup, list);
  }
  for (const [group, list] of groups) {
    const hashes = new Set(list.map((entry) => entry.sha256));
    if (hashes.size !== list.length) problems.push(`同名版本哈希重复：${group}`);
  }
  const longOnes = ctx.entries.filter((entry) => Array.from(path.basename(entry.path)).length >= 100);
  if (longOnes.length < 3) problems.push(`超长文件名只有 ${longOnes.length} 个`);
  for (const entry of longOnes) {
    const base = path.basename(entry.path);
    if (Buffer.byteLength(base) > 255) problems.push(`文件名超过 255 字节：${entry.path}`);
    if (Buffer.byteLength(base) < 80) problems.push(`超长文件名字节过短：${entry.path}`);
  }
  const bases = disk.map((rel) => rel.split("/").pop());
  if (!bases.includes(`${MOJIBAKE}.pdf`)) problems.push("缺少微信乱码文件名");
  if (!bases.includes(`${MOJIBAKE}(1).pdf`)) problems.push("缺少微信乱码 (1) 文件名");

  const cardOwners = new Map();
  for (const entry of ctx.entries) {
    if (!entry.idCardSide) continue;
    const set = cardOwners.get(entry.owner) || new Set();
    set.add(entry.idCardSide);
    cardOwners.set(entry.owner, set);
  }
  let xCards = 0;
  for (const [name, sides] of cardOwners) {
    if (!sides.has("front") || !sides.has("back")) problems.push(`${name} 证件正反不齐`);
    const persona = ctx.byName[name];
    if (persona.idNumber.endsWith("X")) xCards += 1;
    else problems.push(`${name} 有证件样张但号码末位不是 X`);
  }
  if (xCards < 3) problems.push(`末位 X 的证件样张只有 ${xCards} 人`);

  let pdftotext = false;
  try {
    execFileSync("which", ["pdftotext"], { stdio: "pipe" });
    pdftotext = true;
  } catch {
    pdftotext = false;
  }

  for (const entry of ctx.entries) {
    const abs = path.join(OUT, entry.path);
    const buf = fs.readFileSync(abs);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha !== entry.sha256) problems.push(`哈希不一致：${entry.path}`);
    if (entry.format === "pdf") {
      if (buf.subarray(0, 4).toString() !== "%PDF") problems.push(`PDF 魔数不对：${entry.path}`);
      if (entry.openPassword) {
        if (!buf.includes(Buffer.from("/Encrypt"))) problems.push(`加密 PDF 没有 /Encrypt：${entry.path}`);
      } else if (entry.formatFidelity === "text-pdf" && !bufferHasAscii(buf, "9752")) {
        problems.push(`文字 PDF 的 ToUnicode 没有「青」：${entry.path}`);
      }
      if (entry.formatFidelity === "image-only-pdf") {
        if (!buf.includes(Buffer.from("/Image"))) problems.push(`扫描 PDF 没有图片：${entry.path}`);
        if (buf.includes(Buffer.from("/ToUnicode"))) problems.push(`扫描 PDF 带了文字层：${entry.path}`);
      }
      try {
        const pdf = await ctx.libs.pdfLib.PDFDocument.load(buf, { ignoreEncryption: true });
        if (pdf.getPageCount() !== entry.pages) {
          problems.push(`${entry.path} 页数 ${pdf.getPageCount()}，清单写 ${entry.pages}`);
        }
      } catch (error) {
        problems.push(`pdf-lib 打不开 ${entry.path}：${error.message}`);
      }
      if (pdftotext && entry.formatFidelity === "image-only-pdf") {
        const text = execFileSync("pdftotext", [abs, "-"], { encoding: "utf8" });
        if (text.trim().length > 40) problems.push(`扫描 PDF 抽出了文字：${entry.path}`);
      }
    }
    if (entry.format === "docx" || entry.format === "wps" || entry.format === "et") {
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) problems.push(`压缩包魔数不对：${entry.path}`);
    }
    if (entry.format === "doc") {
      if (buf.subarray(0, 4).toString("hex") !== "d0cf11e0") problems.push(`DOC 不是 OLE：${entry.path}`);
      const round = path.join(ctx.tmp, "doc-roundtrip.txt");
      execFileSync("textutil", ["-convert", "txt", abs, "-output", round]);
      if (!fs.readFileSync(round, "utf8").includes("青岛")) problems.push("个人简历.doc 转回文本后没有「青岛」");
    }
    if (entry.format === "heic") {
      const kind = execFileSync("file", ["-b", abs], { encoding: "utf8" });
      if (!/heif|heic|hevc/i.test(kind)) problems.push(`HEIC 识别失败：${kind}`);
    }
    if (entry.format === "wps") {
      const app = await zipText(ctx.libs.JSZip, abs, "docProps/app.xml");
      if (!app.includes("WPS Office")) problems.push(`wps 的 Application 不是 WPS Office：${entry.path}`);
    }
    if ((entry.format === "docx" || entry.format === "wps") && entry.pages > 1) {
      const xml = await zipText(ctx.libs.JSZip, abs, "word/document.xml");
      const breaks = (xml.match(/w:type="page"/g) || []).length + (xml.match(/w:pageBreakBefore/g) || []).length;
      if (breaks + 1 !== entry.pages) problems.push(`${entry.path} 分页符 ${breaks}，页数 ${entry.pages}`);
      if (!xml.includes(entry.owner)) problems.push(`${entry.path} 正文没有姓名`);
    }
    if (entry.format === "et") {
      const zip = await ctx.libs.JSZip.loadAsync(buf);
      const names = Object.keys(zip.files).join("\n");
      if (!names.includes("xl/")) problems.push(`et 不像 xlsx：${entry.path}`);
    }
  }
  const veteran = ctx.entries.find((entry) => entry.owner === "赵卫东" && entry.format === "pdf");
  if (!veteran || veteran.pages !== 48) problems.push("赵卫东扫描件不是 48 页");
  return problems;
}

async function main() {
  utf8Sanity();
  execFileSync(process.execPath, [path.join(here, "check-personas.mjs")], { stdio: "inherit" });
  const personas = JSON.parse(fs.readFileSync(path.join(here, "personas.json"), "utf8"));
  const libs = loadLibs();
  const font = await prepareFont(libs.PDFDocument);
  if (!libs.canvas.GlobalFonts.registerFromPath(font.fontPath, "WalkCJK")) {
    throw new Error("画布注册中文字体失败");
  }
  const penPath = fcFile("HanziPen SC");
  const penFont = penPath && libs.canvas.GlobalFonts.registerFromPath(penPath, "WalkPen") ? "WalkPen" : "WalkCJK";
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = {
    personas,
    byName: Object.fromEntries(personas.personas.map((persona) => [persona.name, persona])),
    libs,
    fontPath: font.fontPath,
    fontNote: font.note,
    penFont,
    entries: [],
    withoutFiles: [],
    tmp: fs.mkdtempSync(path.join(os.tmpdir(), "walk-d1-gen-")),
  };
  try {
    await buildAll(ctx);
    const problems = await selfCheck(ctx);
    if (problems.length) {
      console.error(problems.map((item) => `- ${item}`).join("\n"));
      throw new Error(`自检失败 ${problems.length} 条`);
    }
    const byFormat = {};
    for (const entry of ctx.entries) byFormat[entry.format] = (byFormat[entry.format] || 0) + 1;
    const manifest = {
      schemaVersion: 2,
      asOf: "2026-09-29",
      generatedBy: "scripts/walkthrough/dataset/gen-files.mjs",
      font: font.note,
      formatLimits: [
        ".wps 是 OOXML，Application 写成 WPS Office。本机没有 WPS / LibreOffice，不能生成带 WpsCustomData 的原生 OLE。",
        ".et 是 xlsx 改扩展名，不是 WPS 原生 OLE。",
        "超长文件名按字符数不少于 100。中文每个字 3 字节，macOS 单文件名上限 255 字节，所以用 ASCII 补到 100 字以上。",
      ],
      personasWithoutFiles: ctx.withoutFiles,
      counts: { files: ctx.entries.length, directories: 28, byFormat },
      files: ctx.entries,
    };
    fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`生成完成：${ctx.entries.length} 个文件，28 个目录。`);
    console.log(`格式：${JSON.stringify(byFormat)}`);
    console.log(`字体：${font.note}`);
    console.log(`目录：${OUT}`);
  } finally {
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
