// 生成 K1 走查测试文件到 ~/.cache/walk0929/fixtures/（全部是测试数据，不含真实个人信息）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as lib from './lib.mjs';

const require = createRequire(path.join(lib.W, '..', 'x.js'));
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PDFDocument = require(path.join(REPO, 'services/api/node_modules/pdfkit'));
const FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc';
const FONT_NAME = 'HiraginoSansGB-W3';
fs.mkdirSync(lib.FIX, { recursive: true });

function writePdf(file, pages) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60, autoFirstPage: false, info: { Title: path.basename(file) } });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    doc.registerFont('cn', FONT, FONT_NAME);
    pages.forEach((lines, i) => {
      doc.addPage();
      doc.font('cn');
      lines.forEach((l, j) => doc.fontSize(j === 0 ? 22 : 13).text(l, { lineGap: 6 }).moveDown(j === 0 ? 0.8 : 0.3));
      doc.fontSize(10).text(`第 ${i + 1} 页 / 共 ${pages.length} 页`, 60, 740, { lineBreak: false });
    });
    doc.end();
    out.on('finish', resolve);
  });
}

// 1. 两页中文文字 PDF（游客打印）
await writePdf(path.join(lib.FIX, 'k1-两页中文材料.pdf'), [
  ['测试·求职材料说明（第一页）', '这是 K1 走查用的测试文件，内容全部虚构。', '一、个人情况：测试·王五，从事仓储物流工作八年。', '二、求职意向：仓库管理、物流调度。', '三、证书：叉车操作证（测试）。'],
  ['测试·求职材料说明（第二页）', '四、工作经历：2018—2026 某测试物流公司 仓管员。', '五、自我评价：做事踏实，能吃苦，服从安排。', '六、说明：本页用于核对页数与份数。'],
]);
// 2. 一页简历 PDF（零工之家工友）
await writePdf(path.join(lib.FIX, 'k1-一页简历.pdf'), [
  ['测试·李四 简历', '求职意向：普工、装卸', '工作经历：2020—2026 测试建筑工地 杂工', '技能：会开电动三轮车、能上夜班', '联系方式：请到现场询问（测试样张）'],
]);
// 3. U 盘用 PDF
await writePdf(path.join(lib.FIX, 'k1-U盘材料.pdf'), [
  ['测试·U 盘导入材料', '这份文件放在模拟 U 盘里，用来测 U 盘导入打印。', '内容虚构，仅供走查。'],
]);
// 4. 扫描投递用 PDF（两页）
await writePdf(path.join(lib.FIX, 'k1-扫描件.pdf'), [
  ['测试·扫描原件第一页', '这份文件模拟打印机面板扫描回传。'],
  ['测试·扫描原件第二页', '用于核对扫描件页数。'],
]);

// 5. 最小 .docx（用 python zipfile 打包）
const docx = path.join(lib.FIX, 'k1-Word简历.docx');
execFileSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
z.writestr('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试·Word 简历（走查用）</w:t></w:r></w:p></w:body></w:document>')
z.close()
`, docx]);

// 6. 身份证测试样张图片（正、反面），用浏览器 canvas 画
const browser = await lib.chromium.launch();
const page = await browser.newPage({ viewport: { width: 856, height: 540 } });
async function card(file, side) {
  await page.setContent(`<html><body style="margin:0"><canvas id=c width=856 height=540></canvas><script>
    const c=document.getElementById('c').getContext('2d');
    c.fillStyle='#dfe9f3';c.fillRect(0,0,856,540);
    c.strokeStyle='#8aa';c.lineWidth=6;c.strokeRect(10,10,836,520);
    c.fillStyle='#c00';c.font='bold 64px "Hiragino Sans GB"';c.fillText('测试样张 非真实证件',120,110);
    c.fillStyle='#123';c.font='36px "Hiragino Sans GB"';
    ${side === 'front'
      ? `c.fillText('姓名  测试·李四',60,210);c.fillText('性别 男   民族 汉',60,270);c.fillText('出生 1990 年 1 月 1 日',60,330);c.fillText('住址 测试省测试市测试路 1 号',60,390);c.fillText('公民身份号码 110101199001011234',60,470);c.fillStyle='#aab';c.fillRect(640,170,170,220);`
      : `c.fillText('中华人民共和国（测试样张）',160,220);c.fillText('居民身份证（背面·测试）',180,290);c.fillText('签发机关 测试市公安局（虚构）',60,390);c.fillText('有效期限 2020.01.01-2040.01.01',60,450);`}
  </script></body></html>`);
  await page.locator('#c').screenshot({ path: file });
}
await card(path.join(lib.FIX, 'k1-身份证测试样张-正面.png'), 'front');
await card(path.join(lib.FIX, 'k1-身份证测试样张-反面.png'), 'back');
await browser.close();
console.log(fs.readdirSync(lib.FIX).join('\n'));
