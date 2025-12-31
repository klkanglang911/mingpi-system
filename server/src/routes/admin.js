/**
 * 管理员路由
 * 处理用户管理和命批管理
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, run } = require('../config/database');
const { generatePassword, hashPassword } = require('../utils/password');

// ============ 用户管理 ============

/**
 * GET /api/admin/users
 * 获取用户列表
 */
router.get('/users', (req, res) => {
    try {
        const users = query(`
            SELECT id, username, display_name, is_admin, must_change_password, created_at, last_login_at
            FROM users
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            data: users.map(u => ({
                id: u.id,
                username: u.username,
                displayName: u.display_name,
                isAdmin: u.is_admin === 1,
                mustChangePassword: u.must_change_password === 1,
                createdAt: u.created_at,
                lastLoginAt: u.last_login_at
            }))
        });
    } catch (error) {
        console.error('获取用户列表错误:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

/**
 * POST /api/admin/users
 * 创建用户
 */
router.post('/users', async (req, res) => {
    try {
        const { username, displayName } = req.body;

        if (!username || !displayName) {
            return res.status(400).json({ error: '用户名和显示名称不能为空' });
        }

        // 检查用户名是否已存在
        const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        // 生成随机密码
        const password = generatePassword(8);
        const passwordHash = await hashPassword(password);

        // 创建用户
        const result = run(
            'INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password) VALUES (?, ?, ?, 0, 1)',
            [username, passwordHash, displayName]
        );

        res.json({
            success: true,
            data: {
                id: result.lastInsertRowid,
                username,
                displayName,
                generatedPassword: password // 返回生成的密码，管理员需告知用户
            }
        });
    } catch (error) {
        console.error('创建用户错误:', error);
        res.status(500).json({ error: '创建用户失败' });
    }
});

/**
 * PUT /api/admin/users/:id
 * 编辑用户
 */
router.put('/users/:id', (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { displayName } = req.body;

        if (!displayName) {
            return res.status(400).json({ error: '显示名称不能为空' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 更新用户
        run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, userId]);

        res.json({ success: true });
    } catch (error) {
        console.error('编辑用户错误:', error);
        res.status(500).json({ error: '编辑用户失败' });
    }
});

/**
 * DELETE /api/admin/users/:id
 * 删除用户
 */
router.delete('/users/:id', (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // 不能删除自己
        if (userId === req.user.id) {
            return res.status(400).json({ error: '不能删除自己的账户' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 删除用户（关联的命批会级联删除）
        run('DELETE FROM users WHERE id = ?', [userId]);

        res.json({ success: true });
    } catch (error) {
        console.error('删除用户错误:', error);
        res.status(500).json({ error: '删除用户失败' });
    }
});

/**
 * POST /api/admin/users/:id/reset-password
 * 重置用户密码
 */
router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // 检查用户是否存在
        const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 生成新密码
        const password = generatePassword(8);
        const passwordHash = await hashPassword(password);

        // 更新密码，设置强制修改密码标记
        run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [passwordHash, userId]);

        res.json({
            success: true,
            data: {
                generatedPassword: password // 返回新密码
            }
        });
    } catch (error) {
        console.error('重置密码错误:', error);
        res.status(500).json({ error: '重置密码失败' });
    }
});

// ============ 命批管理 ============

/**
 * GET /api/admin/mingpi
 * 获取命批列表
 */
router.get('/mingpi', (req, res) => {
    try {
        const { userId, year } = req.query;

        let sql = `
            SELECT m.*, u.display_name as user_display_name
            FROM mingpi m
            JOIN users u ON m.user_id = u.id
        `;
        const params = [];
        const conditions = [];

        if (userId) {
            conditions.push('m.user_id = ?');
            params.push(parseInt(userId));
        }

        if (year) {
            conditions.push('m.lunar_year = ?');
            params.push(parseInt(year));
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY m.lunar_year DESC, m.lunar_month ASC';

        const mingpis = query(sql, params);

        res.json({
            success: true,
            data: mingpis.map(m => ({
                id: m.id,
                userId: m.user_id,
                userDisplayName: m.user_display_name,
                lunarYear: m.lunar_year,
                lunarMonth: m.lunar_month,
                content: m.content,
                createdAt: m.created_at,
                updatedAt: m.updated_at
            }))
        });
    } catch (error) {
        console.error('获取命批列表错误:', error);
        res.status(500).json({ error: '获取命批列表失败' });
    }
});

/**
 * GET /api/admin/mingpi/user/:userId
 * 获取指定用户的所有命批
 */
router.get('/mingpi/user/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);

        const mingpis = query(
            'SELECT * FROM mingpi WHERE user_id = ? ORDER BY lunar_year DESC, lunar_month ASC',
            [userId]
        );

        res.json({
            success: true,
            data: mingpis.map(m => ({
                id: m.id,
                lunarYear: m.lunar_year,
                lunarMonth: m.lunar_month,
                content: m.content,
                createdAt: m.created_at,
                updatedAt: m.updated_at
            }))
        });
    } catch (error) {
        console.error('获取用户命批错误:', error);
        res.status(500).json({ error: '获取用户命批失败' });
    }
});

/**
 * POST /api/admin/mingpi
 * 创建或更新命批 (UPSERT)
 */
router.post('/mingpi', (req, res) => {
    try {
        const { userId, lunarYear, lunarMonth, content } = req.body;

        // 参数验证
        if (!userId || !lunarYear || !lunarMonth || !content) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        if (lunarYear < 1900 || lunarYear > 2100 || lunarMonth < 1 || lunarMonth > 12) {
            return res.status(400).json({ error: '无效的农历年月' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 检查是否已存在
        const existing = queryOne(
            'SELECT id FROM mingpi WHERE user_id = ? AND lunar_year = ? AND lunar_month = ?',
            [userId, lunarYear, lunarMonth]
        );

        if (existing) {
            // 更新
            run(
                'UPDATE mingpi SET content = ?, updated_at = datetime("now") WHERE id = ?',
                [content, existing.id]
            );
            res.json({ success: true, action: 'updated', id: existing.id });
        } else {
            // 创建
            const result = run(
                'INSERT INTO mingpi (user_id, lunar_year, lunar_month, content) VALUES (?, ?, ?, ?)',
                [userId, lunarYear, lunarMonth, content]
            );
            res.json({ success: true, action: 'created', id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('保存命批错误:', error);
        res.status(500).json({ error: '保存命批失败' });
    }
});

/**
 * DELETE /api/admin/mingpi/:id
 * 删除命批
 */
router.delete('/mingpi/:id', (req, res) => {
    try {
        const mingpiId = parseInt(req.params.id);

        // 检查是否存在
        const mingpi = queryOne('SELECT id FROM mingpi WHERE id = ?', [mingpiId]);
        if (!mingpi) {
            return res.status(404).json({ error: '命批不存在' });
        }

        run('DELETE FROM mingpi WHERE id = ?', [mingpiId]);

        res.json({ success: true });
    } catch (error) {
        console.error('删除命批错误:', error);
        res.status(500).json({ error: '删除命批失败' });
    }
});

module.exports = router;
