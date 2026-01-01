/**
 * 认证路由
 * 处理登录、登出、修改密码等
 */

const express = require('express');
const router = express.Router();
const { queryOne, run } = require('../config/database');
const { verifyPassword, hashPassword, validatePasswordStrength } = require('../utils/password');
const { generateToken } = require('../middleware/auth');
const authMiddleware = require('../middleware/auth');
const { logFromRequest, ActionTypes } = require('../utils/accessLog');

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        // 查询用户
        const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);

        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 检查用户是否被锁定
        if (user.is_locked === 1) {
            return res.status(403).json({ error: '该账户已被锁定，请联系管理员' });
        }

        // 验证密码
        const isValid = await verifyPassword(password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 更新最后登录时间（使用北京时间）
        run('UPDATE users SET last_login_at = datetime("now", "+8 hours") WHERE id = ?', [user.id]);

        // 记录登录日志
        const action = user.is_admin === 1 ? ActionTypes.ADMIN_LOGIN : ActionTypes.LOGIN;
        logFromRequest(req, action, { userId: user.id, username: user.username });

        // 生成 token
        const token = generateToken(user, rememberMe === true);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                isAdmin: user.is_admin === 1
            },
            mustChangePassword: user.must_change_password === 1
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

/**
 * POST /api/auth/logout
 * 用户登出 (客户端清除 token 即可)
 */
router.post('/logout', (req, res) => {
    res.json({ success: true });
});

/**
 * POST /api/auth/change-password
 * 修改密码
 * - 首次登录（must_change_password = 1）时不需要验证旧密码
 * - 主动修改密码时需要验证旧密码
 */
router.post('/change-password', authMiddleware, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        // 查询当前用户
        const user = queryOne('SELECT password_hash, must_change_password FROM users WHERE id = ?', [req.user.id]);

        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const isFirstLogin = user.must_change_password === 1;

        // 首次登录时只需要新密码，主动修改时需要旧密码
        if (isFirstLogin) {
            if (!newPassword) {
                return res.status(400).json({ error: '请输入新密码' });
            }
        } else {
            if (!oldPassword || !newPassword) {
                return res.status(400).json({ error: '请填写完整信息' });
            }

            // 验证旧密码（仅非首次登录时）
            const isValid = await verifyPassword(oldPassword, user.password_hash);
            if (!isValid) {
                return res.status(400).json({ error: '当前密码错误' });
            }
        }

        // 验证新密码强度
        const validation = validatePasswordStrength(newPassword);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.message });
        }

        // 哈希新密码
        const newHash = await hashPassword(newPassword);

        // 更新密码，同时清除强制修改密码标记
        run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [newHash, req.user.id]);

        // 记录修改密码日志
        logFromRequest(req, ActionTypes.CHANGE_PASSWORD);

        res.json({ success: true, message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({ error: '修改密码失败，请稍后重试' });
    }
});

/**
 * POST /api/auth/visit
 * 记录用户访问页面（前端在页面加载时调用）
 */
router.post('/visit', authMiddleware, (req, res) => {
    const { page } = req.body;

    // 根据页面类型记录不同的操作
    let action = ActionTypes.VIEW_CALENDAR;
    if (page === 'mingpi') {
        action = ActionTypes.VIEW_MINGPI;
    }

    // 异步记录访问日志，不阻塞响应
    logFromRequest(req, action, { page });

    res.json({ success: true });
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', authMiddleware, (req, res) => {
    // 禁止缓存，确保每次获取最新状态
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.json({
        success: true,
        user: req.user
    });
});

module.exports = router;
