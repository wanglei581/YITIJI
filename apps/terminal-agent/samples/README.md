# 测试样本文件

Phase 8.0 本地打印 Spike 使用这些文件验证打印能力。

## 需要准备的测试文件

将以下文件放在本目录或任意绝对路径，运行时用 `--file` 指定：

| 文件 | 格式 | 用途 |
|------|------|------|
| sample.pdf | PDF | 验证 Method A + B |
| sample.jpg | JPEG | 验证 Method A（图片） |
| sample.png | PNG | 验证 Method A（图片） |

## 快速生成测试 PDF

Windows 系统上，可以用以下 PowerShell 命令快速生成一个最小测试 PDF（需要 Word 或 Notepad++ 的 PDF 导出插件），
或者直接从浏览器打印任意网页到 PDF 文件另存为。

最简单方式：用 Windows 记事本写一行字，另存为 .txt，
然后用 PowerShell 打印到 "Microsoft Print to PDF" 输出到 samples/sample.pdf：

```powershell
"Test print - Phase 8.0 Spike" | Set-Content samples\test.txt
Start-Process -FilePath samples\test.txt -Verb PrintTo -ArgumentList "Microsoft Print to PDF" -Wait
# 在弹出的保存对话框里选择 samples\ 目录保存为 sample.pdf
```

## 运行方式

```powershell
# 在项目根目录

# 1. 列出所有打印机（确认奔图已识别）
pnpm --filter terminal-agent list-printers

# 2. 打印 PDF（同时测试两种方法）
pnpm --filter terminal-agent print --file "C:\path\to\samples\sample.pdf" --printer "Pantum CM2800ADN Series"

# 3. 只用 Method A
pnpm --filter terminal-agent print --file "C:\path\to\samples\sample.jpg" --printer "Pantum CM2800ADN Series" --method a

# 4. 只用 Method B
pnpm --filter terminal-agent print --file "C:\path\to\samples\sample.pdf" --printer "Pantum CM2800ADN Series" --method b
```

## 验收检查

运行每个命令后，对照以下验证清单记录结果：

- [ ] `list-printers` 输出中能看到 `Pantum CM2800ADN Series`
- [ ] Method A 打印 PDF — 纸张正常出纸
- [ ] Method A 打印 JPG — 纸张正常出纸
- [ ] Method B 打印 PDF — 纸张正常出纸
- [ ] 打印不存在的文件 — 输出 `FILE_NOT_FOUND`
- [ ] 打印不支持的扩展名 — 输出 `UNSUPPORTED_FILE_TYPE`
- [ ] 指定不存在的打印机 — 输出 `PRINTER_NOT_FOUND`
- [ ] 完成后 `samples/` 目录无残留文件（仅有此 README）

## 注意

- 测试 PDF/图片文件不要放进 git（已在 .gitignore 中排除 `*.pdf`、`*.jpg`、`*.png`）
- 敏感文件（简历、证件）严禁放在此目录测试
