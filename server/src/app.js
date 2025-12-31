/**
 * 命批系统 - Express 应用入口
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const mingpiRoutes = require('./routes/mingpi');
const adminRoutes = require('./routes/admin');
const authMiddleware = require('./middleware/auth');
const adminMiddleware = require('./middleware/admin');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务
const publicPath = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../public')
    : path.join(__dirname, '../../public');
app.use(express.static(publicPath));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/mingpi', authMiddleware, mingpiRoutes);
app.use('/api/admin', authMiddleware, adminMiddleware, adminRoutes);

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA 路由支持 - 所有未匹配的路由返回 index.html
app.get('*', (req, res) => {
    // 如果是 API 请求，返回 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: '接口不存在' });
    }
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
        app.listen(PORT, () => {
            console.log(`命批系统已启动: http://localhost:${PORT}`);
            console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.error('启动失败:', error);
        process.exit(1);
    }
}

start();
