#!/bin/sh
# 用法：scripts/walkthrough/journeys/k3/run.sh <步骤文件>  —— 让常驻驱动跑一个步骤文件
f=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
curl -s --max-time 900 -X POST http://127.0.0.1:4393/run -d "{\"file\":\"$f\"}"
