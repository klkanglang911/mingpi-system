#!/bin/bash
# 完整字体下载脚本
# 下载 Google Fonts 的中文字体子集
# 在服务器上运行: bash download-fonts-full.sh

FONT_DIR="public/fonts"
mkdir -p $FONT_DIR

echo "================================================"
echo "字体下载脚本 - 中文字体完整子集"
echo "================================================"
echo ""

# 下载 Ma Shan Zheng 的所有中文子集
echo "[1/2] 下载 Ma Shan Zheng (书法字体)..."
MA_SHAN_BASE="https://fonts.gstatic.com/s/mashanzheng/v14/NaPecZTRCLxvwo41b4gvzkXaRMGEFoZJFdX0wQ5Xo5Hr21L9zCcRFhbSe5Nk0pIMuUkHEA"

# 常用中文字符子集 (unicode-range subsets)
for i in 1 2 3 5 6 7 9 10 20 22 23 24 25 26 27 28 29 30 31 32 33 34 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119; do
    curl -sL -o "$FONT_DIR/ma-shan-zheng-$i.woff2" "${MA_SHAN_BASE}.${i}.woff2" 2>/dev/null && echo "  下载子集 $i" || true
done

# 下载基础拉丁字符
curl -sL -o "$FONT_DIR/MaShanZheng-Regular.woff2" \
    "https://fonts.gstatic.com/s/mashanzheng/v14/NaPecZTRCLxvwo41b4gvzkXadMTmDQ.woff2"
echo "  下载基础字符集"

echo ""
echo "[2/2] 下载 Noto Serif SC (正文字体)..."
NOTO_BASE="https://fonts.gstatic.com/s/notoserifsc/v34/H4chBXePl9DZ0Xe7gG9cyOj7oqP0dTpxZbB9E9gjjmzKvaeKHUTtJDWv3z-us4bxD8F5og"

# 常用中文字符子集
for i in 1 2 3 5 6 7 9 10 20 22 23 24 25 26 27 28 29 30 31 32 33 34 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119; do
    curl -sL -o "$FONT_DIR/noto-serif-sc-$i.woff2" "${NOTO_BASE}.${i}.woff2" 2>/dev/null && echo "  下载子集 $i" || true
done

# 下载基础字符集
curl -sL -o "$FONT_DIR/NotoSerifSC-Regular.woff2" \
    "https://fonts.gstatic.com/s/notoserifsc/v34/H4chBXePl9DZ0Xe7gG9cyOj7kqGWbg.woff2"
echo "  下载基础字符集"

echo ""
echo "================================================"
echo "下载完成！"
echo "================================================"
echo ""
echo "字体文件统计："
ls -1 $FONT_DIR/*.woff2 2>/dev/null | wc -l
echo "个文件"
echo ""
echo "总大小："
du -sh $FONT_DIR/
echo ""
echo "注意：由于 Google Fonts 在中国可能被限制，"
echo "如果下载失败，请在可以访问 Google 的网络环境下运行此脚本。"
