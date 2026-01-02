# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Version Management (版本管理规范)

**当前版本**: v1.0.0

### 版本更新规则
- **自动更新小版本**: 每次功能更新/bug修复，自动递增补丁版本号（如 1.0.0 → 1.0.1）
- **手动指定大版本**: 仅当用户明确说明"大版本更新"或"新增重要功能"时，递增次版本号（如 1.0.x → 1.1.0）
- **重大变更**: 用户明确要求时才更新主版本号（如 1.x.x → 2.0.0）

### 版本更新流程（每次代码更新后自动执行）
1. 更新 `server/package.json` 中的 `version` 字段
2. 更新 `CHANGELOG.md` 添加更新记录
3. 更新 `README.md` 中的版本徽章
4. 创建 Git 标签并推送
5. 提交所有更改并推送到 GitHub

### 版本文件位置
- `server/package.json` - 产品版本号
- `CHANGELOG.md` - 更新日志
- `README.md` - 项目说明（含版本徽章）

## Project Overview

命批系统 (Mingpi System) - A personalized lunar calendar fortune system with admin management. Built for Chinese traditional culture content delivery based on lunar months.

## Development Commands

```bash
# Install dependencies
cd server && npm install

# Development (with hot reload, requires Node 18+)
npm run dev

# Production
npm start

# Docker deployment
cd docker && docker-compose up -d
```

Server runs on port 3000 (or 666 when deployed via Docker).

Default admin credentials: `admin` / `admin123` (must change on first login)

## Architecture

### Backend (server/)
- **Express.js** app with SQLite (sql.js) database
- **JWT authentication** with 24h (default) or 30-day ("remember me") tokens
- **bcryptjs** for password hashing

Key files:
- `src/app.js` - Express entry point, serves static files from `../public`
- `src/config/database.js` - SQLite setup with auto-migration
- `src/middleware/auth.js` - JWT verification and token generation
- `src/middleware/admin.js` - Admin-only route protection
- `src/routes/` - API endpoints (auth, mingpi, admin)
- `src/utils/lunar.js` - Lunar calendar calculations (1900-2100)
- `src/utils/accessLog.js` - User activity logging with device fingerprinting

### Frontend (public/)
- Vanilla HTML/CSS/JS with Chinese traditional aesthetics
- `index.html` - Login page
- `main.html` - User dashboard with lunar calendar (月命批)
- `bazi.html` - 八字岁运 (Four Pillars and Fortune)
- `analysis.html` - 命局分析 (Destiny Analysis)
- `seasons.html` - 四季财官 (Four Seasons Fortune)
- `admin/` - Admin panel (users.html, mingpi.html, settings.html)

### Database Schema
```sql
users (id, username, password_hash, display_name, is_admin, is_locked, must_change_password, ...)
mingpi (id, user_id, lunar_year, lunar_month, content, ...)  -- 月批内容
user_profile (id, user_id, year_pillar, month_pillar, day_pillar, hour_pillar, qiyun_age, analysis, ...)  -- 固定资料
user_yearly_fortune (id, user_id, lunar_year, dayun, liunian, spring_content, summer_content, autumn_content, winter_content, ...)  -- 年度运势
access_logs (id, user_id, action, ip_address, device_type, os, browser, ...)
```

## API Routes

| Route | Description |
|-------|-------------|
| `POST /api/auth/login` | Login with username/password |
| `POST /api/auth/change-password` | Change password (no old password needed on first login) |
| `GET /api/mingpi/:year/:month` | Get fortune content for lunar year/month |
| `GET /api/mingpi/profile` | Get current user's profile (八字、起运、命局分析) |
| `GET /api/mingpi/yearly-fortune` | Get current user's yearly fortune (current year) |
| `GET /api/mingpi/yearly-fortune/:year` | Get current user's yearly fortune for specific year |
| `GET /api/admin/users` | List all users |
| `POST /api/admin/users` | Create user (returns generated password) |
| `POST /api/admin/mingpi` | Create/update fortune content |
| `POST /api/admin/mingpi/batch` | Batch import fortune content |
| `GET /api/admin/user-profile/:userId` | Get user profile |
| `POST /api/admin/user-profile` | Create/update user profile |
| `DELETE /api/admin/user-profile/:userId` | Delete user profile |
| `GET /api/admin/yearly-fortune/:userId/:year` | Get yearly fortune |
| `POST /api/admin/yearly-fortune` | Create/update yearly fortune |
| `DELETE /api/admin/yearly-fortune/:userId/:year` | Delete yearly fortune |

## Environment Variables

Copy `.env.example` to `.env`:
```
PORT=3000
JWT_SECRET=change-this-secret  # Must change in production
DATABASE_PATH=../data/mingpi.db
```

## Key Implementation Details

- **Lunar year selection** starts from 2025 (no earlier years)
- **First login** requires password change (skip old password validation when `must_change_password=1`)
- **Access logging** captures real client IP via `X-Forwarded-For` header (trust proxy enabled)
- **User search** in admin panel supports searchable dropdowns with "create new user" option
- **Batch import** supports both line-by-line format and month-prefixed format (e.g., `1:content`)
- **Data model**:
  - Fixed per user: 四柱八字 (年柱/月柱/日柱/时柱), 起运年龄, 命局分析
  - Yearly per user: 大运, 流年, 四季财官 (春/夏/秋/冬)
