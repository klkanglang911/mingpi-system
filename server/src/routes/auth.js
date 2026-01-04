/**
 * 认证路由
 * 处理登录、登出、修改密码等
 */

const express = require('express');
const router = express.Router();
const { queryOne, run, getConfig } = require('../config/database');
const { verifyPassword, hashPassword, validatePasswordStrength } = require('../utils/password');
const { generateToken } = require('../middleware/auth');
const authMiddleware = require('../middleware/auth');
const { logFromRequest, ActionTypes } = require('../utils/accessLog');

/**
 * 检查用户是否被登录锁定
 */
function isLoginLocked(user) {
    if (!user.login_locked_until) return false;
    const lockUntil = new Date(user.login_locked_until + ' UTC');
    return lockUntil > new Date();
}

/**
 * 获取锁定剩余时间（分钟）
 */
function getLockRemainingMinutes(user) {
    if (!user.login_locked_until) return 0;
    const lockUntil = new Date(user.login_locked_until + ' UTC');
    const remaining = Math.ceil((lockUntil - new Date()) / 60000);
    return Math.max(0, remaining);
}

/**
 * 记录登录失败
 */
function recordLoginFailure(userId) {
    const maxAttempts = parseInt(getConfig('login_max_attempts') || '5');
    const lockMinutes = parseInt(getConfig('login_lock_minutes') || '15');

    // 获取当前失败次数
    const user = queryOne('SELECT login_fail_count FROM users WHERE id = ?', [userId]);
    const newCount = (user?.login_fail_count || 0) + 1;

    if (newCount >= maxAttempts) {
        // 达到最大次数，锁定账户
        run(`
            UPDATE users
            SET login_fail_count = ?,
                login_locked_until = datetime('now', '+${lockMinutes} minutes')
            WHERE id = ?
        `, [newCount, userId]);
    } else {
        // 增加失败计数
        run('UPDATE users SET login_fail_count = ? WHERE id = ?', [newCount, userId]);
    }

    return { count: newCount, maxAttempts, lockMinutes };
}

/**
 * 重置登录失败计数
 */
function resetLoginFailure(userId) {
    run('UPDATE users SET login_fail_count = 0, login_locked_until = NULL WHERE id = ?', [userId]);
}

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

        // 检查登录是否被锁定（因多次失败）
        if (isLoginLocked(user)) {
            const remaining = getLockRemainingMinutes(user);
            return res.status(403).json({
                error: `登录失败次数过多，请 ${remaining} 分钟后重试`,
                locked: true,
                remainingMinutes: remaining
            });
        }

        // 检查用户是否被锁定（管理员锁定）
        if (user.is_locked === 1) {
            return res.status(403).json({ error: '该账户已被锁定，请联系管理员' });
        }

        // 验证密码
        const isValid = await verifyPassword(password, user.password_hash);

        if (!isValid) {
            // 记录登录失败
            const failInfo = recordLoginFailure(user.id);
            const remaining = failInfo.maxAttempts - failInfo.count;

            if (remaining <= 0) {
                return res.status(403).json({
                    error: `密码错误次数过多，账户已锁定 ${failInfo.lockMinutes} 分钟`,
                    locked: true,
                    remainingMinutes: failInfo.lockMinutes
                });
            }

            return res.status(401).json({
                error: `用户名或密码错误，还剩 ${remaining} 次尝试机会`,
                remainingAttempts: remaining
            });
        }

        // 登录成功，重置失败计数
        resetLoginFailure(user.id);

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
 * PUT /api/auth/username
 * 修改登录账号
 * 需要验证当前密码
 */
router.put('/username', authMiddleware, async (req, res) => {
    try {
        const { newUsername, password } = req.body;

        if (!newUsername || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        // 验证新用户名格式
        if (newUsername.length < 2 || newUsername.length > 20) {
            return res.status(400).json({ error: '用户名长度需在 2-20 个字符之间' });
        }

        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(newUsername)) {
            return res.status(400).json({ error: '用户名只能包含字母、数字、下划线和中文' });
        }

        // 查询当前用户
        const user = queryOne('SELECT password_hash, username FROM users WHERE id = ?', [req.user.id]);

        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 验证密码
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return res.status(400).json({ error: '密码错误' });
        }

        // 检查新用户名是否与当前相同
        if (newUsername === user.username) {
            return res.status(400).json({ error: '新用户名与当前相同' });
        }

        // 检查新用户名是否已被使用
        const existing = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [newUsername, req.user.id]);
        if (existing) {
            return res.status(400).json({ error: '该用户名已被使用' });
        }

        // 更新用户名
        run('UPDATE users SET username = ? WHERE id = ?', [newUsername, req.user.id]);

        res.json({
            success: true,
            message: '用户名修改成功，请重新登录',
            newUsername
        });
    } catch (error) {
        console.error('修改用户名错误:', error);
        res.status(500).json({ error: '修改用户名失败，请稍后重试' });
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

/**
 * GET /api/auth/admin-path
 * 获取后台路径（需要管理员权限）
 */
router.get('/admin-path', authMiddleware, (req, res) => {
    // 只有管理员可以获取后台路径
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: '无权访问' });
    }

    const adminPath = getConfig('admin_path');
    res.json({
        success: true,
        adminPath: adminPath || 'admin'
    });
});

/**
 * GET /api/auth/opening-config
 * 获取年批开启时间配置（公开API，需要登录）
 */
router.get('/opening-config', authMiddleware, (req, res) => {
    try {
        const openingTime = getConfig('yearly_opening_time') || '';
        const openingText = getConfig('yearly_opening_text') || '小寒开启你的新一年命批';
        const openingSubtext = getConfig('yearly_opening_subtext') || '敬请期待 · 静候天时';

        res.json({
            success: true,
            data: {
                openingTime,
                openingText,
                openingSubtext,
                // 判断是否已开放
                isOpen: !openingTime || new Date(openingTime) <= new Date()
            }
        });
    } catch (error) {
        console.error('获取开启配置错误:', error);
        res.status(500).json({ error: '获取配置失败' });
    }
});

module.exports = router;
