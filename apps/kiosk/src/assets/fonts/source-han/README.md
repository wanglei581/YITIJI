# 一体机网页字体：Qingxu Serif / Qingxu Sans

本目录的 18 个 `.woff2` 是 Adobe 思源宋体（Source Han Serif）、思源黑体（Source Han Sans）的子集，
在 SIL Open Font License 1.1 下使用。许可证原文与原版权声明见同目录：

- `OFL-SourceHanSerif.txt`：思源宋体，© 2017-2024 Adobe
- `OFL-SourceHanSans.txt`：思源黑体，© 2014-2025 Adobe

字体文件内部也原样保留了版权（name 0）、商标声明（name 7）与许可证（name 13 / 14）条目。

## 来源

- github.com/adobe-fonts/source-han-serif 发布 2.003R：`14_SourceHanSerifCN.zip`
- github.com/adobe-fonts/source-han-sans 发布 2.005R：`19_SourceHanSansCN.zip`
- 2026-10-06 产品负责人同意下载。原始包不进仓库。

## 为什么改名

OFL 1.1 第 3 条：保留字体名（这里是「Source」）不得用于修改版。做子集就是修改，所以：

- 字体内部名改为 **Qingxu Serif** / **Qingxu Sans**（PostScript 名 `QingxuSerif-Bold` 一类）；
- CSS 里的字族名也是 Qingxu Serif / Qingxu Sans，各页字体栈引用的是这两个名字。

## 子集做法

- 字重：宋体 400 / 700 / 900（Regular / Bold / Heavy），黑体 400 / 500 / 700（Regular / Medium / Bold）。
- 字集：GB2312 全部 6763 个汉字 + 一体机与共享包源码里出现过的字 + ASCII + 常用标点与全角符号，清单在 `chars.txt`。
- 每个字重按码位切三段（`unicode-range`）：符号与扩展 A（含全角）/ U+4E00–6FFF / U+7000–9FFF。单个文件不超过仓库 1MB 上限，
  浏览器只下载页面用到的段。共 18 个文件，合计约 7.5MB。
- 去掉 hinting、展开子程序，保留全部 OpenType 特性。
- 放在 `src/assets` 下由 Vite 打包，产物文件名带内容哈希；字体没变时跨发布文件名不变。

## 重新生成

新文案里出现子集外的字时，门禁 `verify:kiosk-font-subset` 会报出来。重新生成：

```bash
python3 apps/kiosk/scripts/fonts/build_source_han_subset.py <放上面两个 zip 解压出的 OTF 的目录>
```

需要 `fonttools` 与 `brotli`。脚本会重写本目录的 woff2、`chars.txt` 和 `apps/kiosk/src/styles/fonts/source-han.css`。
