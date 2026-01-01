# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `main.html` - User dashboard with lunar calendar
- `admin/` - Admin panel (users.html, mingpi.html)

### Database Schema
```sql
users (id, username, password_hash, display_name, is_admin, is_locked, must_change_password, ...)
mingpi (id, user_id, lunar_year, lunar_month, content, ...)
access_logs (id, user_id, action, ip_address, device_type, os, browser, ...)
```

## API Routes

| Route | Description |
|-------|-------------|
| `POST /api/auth/login` | Login with username/password |
| `POST /api/auth/change-password` | Change password (no old password needed on first login) |
| `GET /api/mingpi/:year/:month` | Get fortune content for lunar year/month |
| `GET /api/admin/users` | List all users |
| `POST /api/admin/users` | Create user (returns generated password) |
| `POST /api/admin/mingpi` | Create/update fortune content |
| `POST /api/admin/mingpi/batch` | Batch import fortune content |

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
