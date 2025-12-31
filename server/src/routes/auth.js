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

        // 验证密码
        const isValid = await verifyPassword(password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 更新最后登录时间
        run('UPDATE users SET last_login_at = datetime("now") WHERE id = ?', [user.id]);

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
 */
router.post('/change-password', authMiddleware, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        // 验证新密码强度
        const validation = validatePasswordStrength(newPassword);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.message });
        }

        // 查询当前用户
        const user = queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);

        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 验证旧密码
        const isValid = await verifyPassword(oldPassword, user.password_hash);

        if (!isValid) {
            return res.status(400).json({ error: '当前密码错误' });
        }

        // 哈希新密码
        const newHash = await hashPassword(newPassword);

        // 更新密码，同时清除强制修改密码标记
        run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [newHash, req.user.id]);

        res.json({ success: true, message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({ error: '修改密码失败，请稍后重试' });
    }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

module.exports = router;
