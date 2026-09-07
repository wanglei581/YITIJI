# 到机码 hid 指引态 · 1080×1920 截图

对照稿：`docs/design/kiosk-redesign-2026-08/11-arrival-code.html?state=hid&capture=1&flat=1`  
运行时：`/print/pickup-claim`  
视口：1080×1920，`deviceScaleFactor=1`，`reducedMotion=reduce`。

| 文件 | 画面 |
|---|---|
| `proto-hid-1080x1920.png` | 稿 `rHid()` |
| `runtime-idle-teaching-1080x1920.png` | 运行时手输页（未扫码即可看见机身扫码区位置 + 亮度调高） |
| `runtime-hid-1080x1920.png` | 运行时 hid 指引屏 |

横向越界：三张均 `overflow=[]`（`rect.right <= 1080.5 && rect.left >= -0.5`）。  
hid 主按钮实测高度 76px（「还是手输吧」「扫不出来？求助」）。
