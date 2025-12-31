# 命批系统 (MingPi System)

个性化农历月批服务系统，支持用户登录、个性化命批展示、管理后台。

## 功能特性

- 🔐 用户登录系统（支持长期登录30天）
- 📅 农历日历展示（1900-2100年）
- 📝 个性化命批内容管理
- 👤 管理后台（用户管理、命批管理）
- 🐳 Docker 一键部署

## 快速开始

### 方式一：Docker 部署（推荐）

1. 克隆仓库

```bash
git clone https://github.com/klkanglang911/mingpi-system.git
cd mingpi-system
```

2. 配置环境变量（可选）

```bash
# 创建 .env 文件
cat > docker/.env << EOF
JWT_SECRET=your-secure-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF
```

3. 启动服务

```bash
cd docker
docker-compose up -d
```

4. 访问系统

- 用户端: http://localhost
- 管理后台: http://localhost/admin/

默认管理员账号: `admin` / `admin123`（首次登录需修改密码）

### 方式二：本地开发

1. 安装依赖

```bash
cd server
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件
```

3. 启动开发服务器

```bash
npm run dev
```

## 系统架构

```
mingpi-system/
├── server/                 # 后端代码
│   ├── src/
│   │   ├── config/        # 数据库配置
│   │   ├── middleware/    # 中间件
│   │   ├── routes/        # API 路由
│   │   ├── utils/         # 工具函数
│   │   └── app.js         # 入口文件
│   └── package.json
├── public/                 # 前端页面
│   ├── index.html         # 登录页
│   ├── main.html          # 主页（日历）
│   ├── change-password.html
│   └── admin/             # 管理后台
├── data/                   # SQLite 数据库
└── docker/                 # Docker 配置
```

## API 接口

### 认证接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 退出登录 |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/auth/me` | 获取当前用户 |

### 命批接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/mingpi/current` | 获取当前月命批 |
| GET | `/api/mingpi/:year/:month` | 获取指定月命批 |

### 管理接口（需管理员权限）

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| POST | `/api/admin/users/:id/reset-password` | 重置密码 |
| GET | `/api/admin/mingpi` | 命批列表 |
| POST | `/api/admin/mingpi` | 创建/更新命批 |
| DELETE | `/api/admin/mingpi/:id` | 删除命批 |

## 数据备份

SQLite 数据库文件位于 `data/mingpi.db`，Docker 部署时会挂载到 `mingpi-data` 卷。

备份数据：

```bash
docker cp mingpi-system:/app/data/mingpi.db ./backup/
```

## 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (sql.js)
- **认证**: JWT
- **前端**: 原生 HTML/CSS/JS
- **部署**: Docker

## License

MIT
