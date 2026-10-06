#!/usr/bin/env python3
"""思源宋体 / 思源黑体子集生成（一体机网页字体）。

只在本机重新生成时运行，CI 不跑；CI 用 verify-kiosk-font-subset.mjs 检查站内用字都在子集里。

用法（需要 fonttools + brotli，以及 Adobe 官方发布的 CN 子集 OTF）：
  python3 apps/kiosk/scripts/fonts/build_source_han_subset.py <放 OTF 的目录>
OTF 来源：github.com/adobe-fonts/source-han-serif 发布页 14_SourceHanSerifCN.zip、
          github.com/adobe-fonts/source-han-sans 发布页 19_SourceHanSansCN.zip（SIL OFL 1.1）。

改名：思源字体的保留字体名是「Source」（OFL 1.1 第 3 条），子集化即修改版，修改版不得沿用。
所以生成时把字体内部名改成 Qingxu Serif / Qingxu Sans，版权（name 0）、许可证（name 13/14）原样保留；
CSS 字族名同样用 Qingxu Serif / Qingxu Sans。

字集 = GB2312 全部 6763 字 + 一体机与共享包源码里出现过的字 + ASCII + 常用标点与全角符号。
每个字重按码位切成三块（unicode-range），单文件不超过仓库 1MB 上限，浏览器只下载页面用到的块。
"""
import subprocess
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[4]
OUT_DIR = ROOT / 'apps/kiosk/public/fonts/source-han'
CSS_PATH = ROOT / 'apps/kiosk/src/styles/fonts/source-han.css'
CHARS_PATH = OUT_DIR / 'chars.txt'
SCAN_ROOTS = ['apps/kiosk/src', 'apps/kiosk/index.html', 'packages/shared/src']
SCAN_EXT = ('.ts', '.tsx', '.css', '.html', '.json', '.mjs')

# (字族名, 字重名, 文件名前缀, OTF 文件名, CSS 字重)
FACES = [
    ('Qingxu Serif', 'Regular', 'serif-400', 'SourceHanSerifCN-Regular.otf', 400),
    ('Qingxu Serif', 'Bold', 'serif-700', 'SourceHanSerifCN-Bold.otf', 700),
    ('Qingxu Serif', 'Heavy', 'serif-900', 'SourceHanSerifCN-Heavy.otf', 900),
    ('Qingxu Sans', 'Regular', 'sans-400', 'SourceHanSansCN-Regular.otf', 400),
    ('Qingxu Sans', 'Medium', 'sans-500', 'SourceHanSansCN-Medium.otf', 500),
    ('Qingxu Sans', 'Bold', 'sans-700', 'SourceHanSansCN-Bold.otf', 700),
]
# 保留：0 版权、13 许可证说明、14 许可证网址；其余带名字的条目一律改成新名
KEEP_NAME_IDS = {0, 7, 13, 14}

# 三块：符号与扩展 A（含全角）/ 4E00–6FFF / 7000–9FFF
CHUNKS = [
    ('a', [(0x0000, 0x4DFF), (0xA000, 0xFFFF)]),
    ('b', [(0x4E00, 0x6FFF)]),
    ('c', [(0x7000, 0x9FFF)]),
]


def git_files():
    out = subprocess.run(['git', 'ls-files', *SCAN_ROOTS], cwd=ROOT, capture_output=True, text=True, check=True)
    return [f for f in out.stdout.split() if f.endswith(SCAN_EXT)]


def wanted_chars():
    chars = set(chr(c) for c in range(0x20, 0x7F))
    chars.update(chr(c) for c in range(0x2000, 0x2070))   # 通用标点
    chars.update(chr(c) for c in range(0x3000, 0x3040))   # 中文标点
    chars.update(chr(c) for c in range(0xFF01, 0xFF5F))   # 全角 ASCII
    for hi in range(0xB0, 0xF8):                          # GB2312 一二级汉字
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    for rel in git_files():
        text = (ROOT / rel).read_text(encoding='utf-8', errors='ignore')
        chars.update(ch for ch in text if ord(ch) >= 0x2000 and ord(ch) <= 0xFFFF)
    return chars


def in_chunk(ch, ranges):
    return any(lo <= ord(ch) <= hi for lo, hi in ranges)


def css_ranges(ranges):
    return ', '.join(f'U+{lo:04X}-{hi:04X}' for lo, hi in ranges)


def rename(font, family, style):
    ps = f"{family.replace(' ', '')}-{style}"
    values = {1: family, 2: 'Regular', 3: f'{ps};subset', 4: f'{family} {style}', 6: ps, 16: family, 17: style}
    if style == 'Regular':
        values[1] = family
    else:
        values[1] = f'{family} {style}'
        values[2] = 'Regular'
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in KEEP_NAME_IDS:
            continue
        if rec.nameID in values:
            rec.string = values[rec.nameID]
        elif rec.nameID in (5,):
            continue
        else:
            name.removeNames(nameID=rec.nameID)
    if 'CFF ' in font:
        cff = font['CFF '].cff
        cff.fontNames = [ps]
        top = cff.topDictIndex[0]
        for attr in ('FullName', 'FamilyName'):
            if hasattr(top, attr):
                setattr(top, attr, values[4] if attr == 'FullName' else family)


def build_face(src, text, family, style, out):
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.hinting = False
    opts.desubroutinize = True
    opts.flavor = 'woff2'
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    font = TTFont(src)
    sub_ = subset.Subsetter(options=opts)
    sub_.populate(text=text)
    sub_.subset(font)
    rename(font, family, style)
    font.flavor = 'woff2'
    font.save(out)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src_dir = Path(sys.argv[1])
    otf = {p.name: p for p in src_dir.rglob('*.otf')}
    chars = wanted_chars()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CSS_PATH.parent.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob('*.woff2'):
        old.unlink()
    rules = []
    for family, style, prefix, otf_name, weight in FACES:
        for key, ranges in CHUNKS:
            text = ''.join(sorted(ch for ch in chars if in_chunk(ch, ranges)))
            out = OUT_DIR / f'{prefix}-{key}.woff2'
            build_face(otf[otf_name], text, family, style, out)
            rules.append(
                '@font-face {\n'
                f"  font-family: '{family}';\n"
                f'  font-weight: {weight};\n'
                '  font-style: normal;\n'
                '  font-display: swap;\n'
                f"  src: url('/fonts/source-han/{prefix}-{key}.woff2') format('woff2');\n"
                f'  unicode-range: {css_ranges(ranges)};\n'
                '}\n'
            )
            print(f'{out.name}: {out.stat().st_size // 1024} KB')
    CHARS_PATH.write_text(''.join(sorted(chars)), encoding='utf-8')
    CSS_PATH.write_text(
        '/* 由 apps/kiosk/scripts/fonts/build_source_han_subset.py 生成，不要手改。\n'
        '   思源宋体 / 思源黑体（SIL OFL 1.1，许可证见 public/fonts/source-han/LICENSE-*.txt）。\n'
        '   OFL 保留字体名「Source」：子集是修改版，故字族名改为 Qingxu Serif / Qingxu Sans；各页字体栈引用这两个名字。 */\n\n'
        + '\n'.join(rules),
        encoding='utf-8',
    )
    print(f'{len(chars)} 个字符；CSS 写入 {CSS_PATH.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
