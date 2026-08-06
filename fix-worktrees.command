#!/bin/bash
# 一键清理废弃 git worktree 元数据
# 双击即可运行，完成后按任意键关闭

set -e

cd "$(dirname "$0")"

echo "=========================================="
echo "  Git Worktree 清理工具"
echo "=========================================="
echo ""
echo "当前 worktree 数量："
git worktree list | wc -l | tr -d ' '
echo ""
echo "正在清理废弃 worktree 元数据..."
git worktree prune -v
echo ""
echo "清理完成！剩余 worktree 数量："
git worktree list | wc -l | tr -d ' '
echo ""
echo "=========================================="
echo "  完成！重启 Codex 客户端即可正常使用。"
echo "=========================================="
echo ""
echo "按任意键关闭此窗口..."
read -n 1 -s
