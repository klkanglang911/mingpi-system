#!/bin/bash

# 命批系统一键部署脚本
# 使用方法: curl -fsSL https://raw.githubusercontent.com/klkanglang911/mingpi-system/main/deploy.sh | bash

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "${BLUE}[STEP]${NC} $1"; }

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

# Docker Compose 命令兼容
docker_compose() {
    if command -v docker-compose &> /dev/null; then
        docker-compose "$@"
    else
        docker compose "$@"
    fi
}

# 主部署流程
main() {
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}         命批系统 一键部署脚本${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""

    check_docker

    DEPLOY_DIR="${DEPLOY_DIR:-/opt/mingpi-system}"
    info "部署目录: $DEPLOY_DIR"

    # 判断是新安装还是更新
    if [ -d "$DEPLOY_DIR/.git" ]; then
        step "检测到已有安装，正在更新..."
        cd "$DEPLOY_DIR"

        # 先停止现有容器
        if [ -f "docker/docker-compose.yml" ]; then
            info "停止现有服务..."
            cd docker
            docker_compose down 2>/dev/null || true
            cd ..
        fi

        # 拉取最新代码
        info "拉取最新代码..."
        git fetch origin main
        git reset --hard origin/main
    else
        step "全新安装..."

        # 如果目录存在但不是 git 仓库，先备份
        if [ -d "$DEPLOY_DIR" ]; then
            warn "目录已存在但非有效安装，备份后重新安装..."
            mv "$DEPLOY_DIR" "${DEPLOY_DIR}.bak.$(date +%s)"
        fi

        info "克隆仓库..."
        git clone https://github.com/klkanglang911/mingpi-system.git "$DEPLOY_DIR"
        cd "$DEPLOY_DIR"
    fi

    # 创建 .env 文件
    if [ ! -f "docker/.env" ]; then
        info "创建环境配置..."
        JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "mingpi-secret-$(date +%s)-$RANDOM")
        cat > docker/.env << EOF
JWT_SECRET=${JWT_SECRET}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF
        info "已生成安全的 JWT 密钥"
    fi

    # 构建并启动
    step "构建镜像（不使用缓存）..."
    cd docker
    docker_compose build --no-cache

    step "启动服务..."
    docker_compose up -d

    # 等待启动
    info "等待服务启动..."
    sleep 3

    # 健康检查
    for i in {1..10}; do
        if curl -s http://localhost:666/health > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    # 获取服务器 IP
    SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server")

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}              部署完成！${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "访问地址:"
    echo -e "  用户端:    ${BLUE}http://${SERVER_IP}:666${NC}"
    echo -e "  管理后台:  ${BLUE}http://${SERVER_IP}:666/admin/${NC}"
    echo ""
    echo -e "默认管理员: ${YELLOW}admin${NC} / ${YELLOW}admin123${NC}"
    echo -e "${RED}（首次登录请立即修改密码）${NC}"
    echo ""
    echo "常用命令:"
    echo "  查看日志:  cd $DEPLOY_DIR/docker && docker-compose logs -f"
    echo "  重启服务:  cd $DEPLOY_DIR/docker && docker-compose restart"
    echo "  停止服务:  cd $DEPLOY_DIR/docker && docker-compose down"
    echo "  更新部署:  curl -fsSL https://raw.githubusercontent.com/klkanglang911/mingpi-system/main/deploy.sh | bash"
    echo ""
}

main "$@"
