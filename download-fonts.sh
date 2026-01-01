#!/bin/bash
# 字体下载脚本
# 在服务器上运行: bash download-fonts.sh

FONT_DIR="public/fonts"
mkdir -p $FONT_DIR

echo "正在下载字体文件..."

# Ma Shan Zheng (书法字体) - 从 Google Fonts 直接下载
echo "下载 Ma Shan Zheng..."
curl -L -o "$FONT_DIR/MaShanZheng-Regular.woff2" \
  "https://fonts.gstatic.com/s/mashanzheng/v10/NaPecZTRCLxvwo41b4gvzkXadMTmDQ.woff2"

# Noto Serif SC (正文字体) - 下载常用字符子集
echo "下载 Noto Serif SC Light..."
curl -L -o "$FONT_DIR/NotoSerifSC-Light.woff2" \
  "https://fonts.gstatic.com/s/notoserifsc/v22/H4c8BXePl9DZ0Xe7gG9cyOj7kqGWbg.woff2"

echo "下载 Noto Serif SC Regular..."
curl -L -o "$FONT_DIR/NotoSerifSC-Regular.woff2" \
  "https://fonts.gstatic.com/s/notoserifsc/v22/H4chBXePl9DZ0Xe7gG9cyOj7kqGWbg.woff2"

echo "下载 Noto Serif SC SemiBold..."
curl -L -o "$FONT_DIR/NotoSerifSC-SemiBold.woff2" \
  "https://fonts.gstatic.com/s/notoserifsc/v22/H4c8BXePl9DZ0Xe7gG9cyOj7kqG-bQ.woff2"

echo ""
echo "下载完成！字体文件位于 $FONT_DIR/"
ls -lh $FONT_DIR/*.woff2

echo ""
echo "提示：这是基础字符集，如需完整中文支持，可能需要下载更多子集文件。"
