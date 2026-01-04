/**
 * 命批系统 - Express 应用入口
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { initDatabase, getConfig } = require('./config/database');
const authRoutes = require('./routes/auth');
const mingpiRoutes = require('./routes/mingpi');
const adminRoutes = require('./routes/admin');
const authMiddleware = require('./middleware/auth');
const adminMiddleware = require('./middleware/admin');

const app = express();

// 信任反向代理（Nginx），以获取真实客户端 IP
app.set('trust proxy', true);

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));  // 增加请求体大小限制，支持大图片上传
app.use(cookieParser());

// 静态文件服务
const publicPath = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../public')
    : path.join(__dirname, '../../public');

// 上传文件目录
const uploadsPath = path.join(__dirname, '../uploads');

// 动态后台路径中间件
const dynamicAdminMiddleware = (req, res, next) => {
    const adminPath = getConfig('admin_path');

    // 如果访问的是配置的后台路径
    if (adminPath && req.path.startsWith('/' + adminPath)) {
        // 如果访问的是目录但没有尾斜杠，手动添加
        if (req.path === '/' + adminPath) {
            return res.redirect('/' + adminPath + '/');
        }
        // 将路径重写为 /admin
        const newPath = req.path.replace('/' + adminPath, '/admin');
        req.url = newPath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    }
    // 阻止直接访问 /admin（除非是配置的路径就是 admin）
    else if (req.path.startsWith('/admin') && adminPath !== 'admin') {
        return res.status(404).send('页面不存在');
    }

    next();
};

// 微信访问限制中间件
const wechatRestrictionMiddleware = (req, res, next) => {
    const reqPath = req.path.toLowerCase();
    const adminPath = getConfig('admin_path') || 'admin';

    // 1. 后台路径不限制
    if (reqPath.startsWith('/' + adminPath) || reqPath.startsWith('/admin')) {
        return next();
    }

    // 2. API路径不限制
    if (reqPath.startsWith('/api')) {
        return next();
    }

    // 3. 静态资源不限制
    if (reqPath.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)$/)) {
        return next();
    }

    // 4. 上传文件路径不限制
    if (reqPath.startsWith('/uploads')) {
        return next();
    }

    // 5. 健康检查不限制
    if (reqPath === '/health') {
        return next();
    }

    // 6. 测试入口：/bypass/xxx
    if (reqPath.startsWith('/bypass/')) {
        const secret = reqPath.split('/')[2];
        if (secret === 'linglu2025') {
            res.cookie('bypass_wechat', '1', {
                maxAge: 7 * 24 * 60 * 60 * 1000,
                httpOnly: true
            });
            return res.redirect('/');
        }
        return res.status(404).send('页面不存在');
    }

    // 7. 检查 bypass Cookie
    if (req.cookies && req.cookies.bypass_wechat === '1') {
        return next();
    }

    // 8. 检查微信 UA
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua.includes('micromessenger')) {
        return next();
    }

    // 9. 非微信访问，返回引导页面
    res.sendFile(path.join(publicPath, 'wechat-required.html'));
};

// 应用动态路径中间件（在静态文件之前）
app.use(dynamicAdminMiddleware);

// 应用微信访问限制中间件
app.use(wechatRestrictionMiddleware);

// 静态文件服务
app.use(express.static(publicPath));

// 上传文件静态服务
app.use('/uploads', express.static(uploadsPath));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/mingpi', authMiddleware, mingpiRoutes);
app.use('/api/admin', authMiddleware, adminMiddleware, adminRoutes);

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// URL 美化：隐藏 .html 扩展名
// 支持 /main, /analysis, /seasons, /bazi, /change-password 等
app.get('*', (req, res, next) => {
    // 跳过 API 请求
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: '接口不存在' });
    }

    // 跳过已有扩展名的请求（静态资源）
    if (path.extname(req.path)) {
        return next();
    }

    // 跳过根路径
    if (req.path === '/') {
        return res.sendFile(path.join(publicPath, 'index.html'));
    }

    // 尝试查找对应的 .html 文件
    const htmlPath = path.join(publicPath, req.path + '.html');

    if (fs.existsSync(htmlPath)) {
        return res.sendFile(htmlPath);
    }

    // 检查是否是目录，尝试返回 index.html
    const indexPath = path.join(publicPath, req.path, 'index.html');
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    // 都不存在，返回首页（SPA 兜底）
    res.sendFile(path.join(publicPath, 'index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
async function start() {
    try {
        // 初始化数据库
        await initDatabase();

        const PORT = process.env.PORT || 3000;
        const adminPath = getConfig('admin_path');

        app.listen(PORT, () => {
            console.log(`命批系统已启动: http://localhost:${PORT}`);
            console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
            console.log(`后台路径: /${adminPath}`);
        });
    } catch (error) {
        console.error('启动失败:', error);
        process.exit(1);
    }
}

start();
