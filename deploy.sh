#!/bin/bash

# 命批系统一键部署脚本
# 使用方法: curl -fsSL https://raw.githubusercontent.com/klkanglang911/mingpi-system/main/deploy.sh | bash

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的信息
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 检查 Docker 是否安装
check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装，请先安装 Docker: https://docs.docker.com/get-docker/"
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        error "Docker Compose 未安装，请先安装 Docker Compose"
    fi

    info "Docker 环境检查通过"
}

# 检查端口是否被占用
check_port() {
    if lsof -Pi :666 -sTCP:LISTEN -t >/dev/null 2>&1; then
        warn "端口 666 已被占用，请先释放该端口或修改 docker-compose.yml"
        read -p "是否继续部署？(y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# 主部署流程
main() {
    echo "================================================"
    echo "         命批系统 一键部署脚本"
    echo "================================================"
    echo ""

    # 检查环境
    check_docker

    # 设置部署目录
    DEPLOY_DIR="${DEPLOY_DIR:-/opt/mingpi-system}"

    info "部署目录: $DEPLOY_DIR"

    # 克隆或更新代码
    if [ -d "$DEPLOY_DIR" ]; then
        info "检测到已有安装，正在更新..."
        cd "$DEPLOY_DIR"
        git pull origin main
    else
        info "正在克隆仓库..."
        git clone https://github.com/klkanglang911/mingpi-system.git "$DEPLOY_DIR"
        cd "$DEPLOY_DIR"
    fi

    # 检查端口
    check_port

    # 创建 .env 文件（如果不存在）
    if [ ! -f "docker/.env" ]; then
        info "创建环境配置文件..."
        cat > docker/.env << EOF
# JWT 密钥（请修改为随机字符串）
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "please-change-this-secret-key-$(date +%s)")

# 管理员账号
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF
        warn "已创建 docker/.env 文件，建议修改 JWT_SECRET 为更安全的值"
    fi

    # 进入 docker 目录并部署
    cd docker

    info "正在构建并启动容器..."

    # 判断使用 docker-compose 还是 docker compose
    if command -v docker-compose &> /dev/null; then
        docker-compose down 2>/dev/null || true
        docker-compose up -d --build
    else
        docker compose down 2>/dev/null || true
        docker compose up -d --build
    fi

    # 等待服务启动
    info "等待服务启动..."
    sleep 3

    # 检查服务状态
    if command -v docker-compose &> /dev/null; then
        docker-compose ps
    else
        docker compose ps
    fi

    echo ""
    echo "================================================"
    echo -e "${GREEN}部署完成！${NC}"
    echo "================================================"
    echo ""
    echo "访问地址:"
    echo "  用户端:    http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'your-server'):666"
    echo "  管理后台:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'your-server'):666/admin/"
    echo ""
    echo "默认管理员账号: admin / admin123"
    echo "（首次登录需修改密码）"
    echo ""
    echo "常用命令:"
    echo "  查看日志:  cd $DEPLOY_DIR/docker && docker-compose logs -f"
    echo "  重启服务:  cd $DEPLOY_DIR/docker && docker-compose restart"
    echo "  停止服务:  cd $DEPLOY_DIR/docker && docker-compose down"
    echo ""
}

main "$@"
