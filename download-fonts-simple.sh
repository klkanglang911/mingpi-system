#!/bin/bash
# 简化版字体下载脚本
# 下载包含常用中文字符的字体子集
# 在服务器上运行: cd /path/to/mingpi-system && bash download-fonts-simple.sh

FONT_DIR="public/fonts"
mkdir -p $FONT_DIR
cd $FONT_DIR

echo "========================================"
echo "字体下载脚本 (简化版)"
echo "========================================"
echo ""

# 方案1: 从 GitHub 下载霞鹜文楷 (优秀的开源中文字体，可替代思源宋体)
# 如果你喜欢这个字体风格，可以取消下面的注释

# echo "下载霞鹜文楷..."
# curl -L -o "LXGWWenKai-Regular.woff2" \
#     "https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai/fonts/LXGWWenKai-Regular.woff2"

# 方案2: 从 Google Fonts 下载基础字符集 (约 50-100KB 每个)
echo "[1/4] 下载 Ma Shan Zheng 基础字符..."
curl -sL -o "MaShanZheng-Regular.woff2" \
    "https://fonts.gstatic.com/s/mashanzheng/v14/NaPecZTRCLxvwo41b4gvzkXadMTmDQ.woff2" && echo "  成功" || echo "  失败"

echo "[2/4] 下载 Noto Serif SC Light..."
curl -sL -o "NotoSerifSC-Light.woff2" \
    "https://fonts.gstatic.com/s/notoserifsc/v34/H4c8BXePl9DZ0Xe7gG9cyOj7kqGWbg.woff2" && echo "  成功" || echo "  失败"

echo "[3/4] 下载 Noto Serif SC Regular..."
curl -sL -o "NotoSerifSC-Regular.woff2" \
    "https://fonts.gstatic.com/s/notoserifsc/v34/H4chBXePl9DZ0Xe7gG9cyOj7kqGWbg.woff2" && echo "  成功" || echo "  失败"

echo "[4/4] 下载 Noto Serif SC SemiBold..."
curl -sL -o "NotoSerifSC-SemiBold.woff2" \
    "https://fonts.gstatic.com/s/notoserifsc/v34/H4c8BXePl9DZ0Xe7gG9cyOj7kqG-bQ.woff2" && echo "  成功" || echo "  失败"

echo ""
echo "========================================"
echo "下载完成！"
echo "========================================"
ls -lh *.woff2 2>/dev/null || echo "没有找到字体文件，下载可能失败"
echo ""
echo "注意: 这些是基础字符集，主要支持拉丁字符和部分中文。"
echo "如果某些中文字符显示为系统字体，属于正常现象。"
echo ""
echo "如需完整中文支持，可考虑:"
echo "1. 使用 VPN 环境运行完整下载脚本"
echo "2. 或使用霞鹜文楷等开源字体替代"
