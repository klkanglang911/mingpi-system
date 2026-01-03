/**
 * 管理员路由
 * 处理用户管理和命批管理
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, queryOne, run, getConfig, setConfig } = require('../config/database');
const { generatePassword, hashPassword } = require('../utils/password');
const { logFromRequest, ActionTypes } = require('../utils/accessLog');

// 配置 multer 存储
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../uploads/ads');
        // 确保目录存在
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // 生成唯一文件名: 时间戳 + 随机数 + 原始扩展名
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `ad_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
        cb(null, uniqueName);
    }
});

// 文件过滤器，只允许图片
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('只支持 JPEG、PNG、GIF、WebP 格式的图片'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 限制 5MB
    }
});

// ============ 用户管理 ============

/**
 * GET /api/admin/users
 * 获取用户列表（支持搜索）
 */
router.get('/users', (req, res) => {
    try {
        const { search } = req.query;
        let sql = `
            SELECT id, username, display_name, is_admin, is_locked, must_change_password, created_at, last_login_at
            FROM users
        `;
        const params = [];

        if (search && search.trim()) {
            sql += ` WHERE username LIKE ? OR display_name LIKE ?`;
            const searchPattern = `%${search.trim()}%`;
            params.push(searchPattern, searchPattern);
        }

        sql += ` ORDER BY created_at DESC`;

        const users = query(sql, params);

        res.json({
            success: true,
            data: users.map(u => ({
                id: u.id,
                username: u.username,
                displayName: u.display_name,
                isAdmin: u.is_admin === 1,
                isLocked: u.is_locked === 1,
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

        // 创建用户（使用北京时间）
        const result = run(
            `INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password, created_at)
             VALUES (?, ?, ?, 0, 1, datetime("now", "+8 hours"))`,
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

        // 记录创建用户日志
        logFromRequest(req, ActionTypes.ADMIN_CREATE_USER, { targetUserId: result.lastInsertRowid, username, displayName });
    } catch (error) {
        console.error('创建用户错误:', error);
        res.status(500).json({ error: '创建用户失败' });
    }
});

/**
 * PUT /api/admin/users/:id
 * 编辑用户（用户名、显示名称）
 */
router.put('/users/:id', (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { username, displayName } = req.body;

        if (!displayName) {
            return res.status(400).json({ error: '显示名称不能为空' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id, username FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 如果修改了用户名，检查是否重复
        if (username && username !== user.username) {
            const existing = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
            if (existing) {
                return res.status(400).json({ error: '用户名已被使用' });
            }
            run('UPDATE users SET username = ?, display_name = ? WHERE id = ?', [username, displayName, userId]);
        } else {
            run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, userId]);
        }

        // 记录编辑用户日志
        logFromRequest(req, ActionTypes.ADMIN_EDIT_USER, { targetUserId: userId, username, displayName });

        res.json({ success: true });
    } catch (error) {
        console.error('编辑用户错误:', error);
        res.status(500).json({ error: '编辑用户失败' });
    }
});

/**
 * POST /api/admin/users/:id/lock
 * 锁定/解锁用户
 */
router.post('/users/:id/lock', (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { locked } = req.body;

        // 不能锁定自己
        if (userId === req.user.id) {
            return res.status(400).json({ error: '不能锁定自己的账户' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 不能锁定管理员
        if (user.is_admin === 1) {
            return res.status(400).json({ error: '不能锁定管理员账户' });
        }

        run('UPDATE users SET is_locked = ? WHERE id = ?', [locked ? 1 : 0, userId]);

        // 记录锁定/解锁日志
        logFromRequest(req, ActionTypes.ADMIN_LOCK_USER, { targetUserId: userId, locked: !!locked });

        res.json({ success: true, locked: !!locked });
    } catch (error) {
        console.error('锁定用户错误:', error);
        res.status(500).json({ error: '操作失败' });
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

        // 记录删除用户日志
        logFromRequest(req, ActionTypes.ADMIN_DELETE_USER, { targetUserId: userId });

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

        // 记录重置密码日志
        logFromRequest(req, ActionTypes.ADMIN_RESET_PASSWORD, { targetUserId: userId });

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
                'UPDATE mingpi SET content = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?',
                [content, existing.id]
            );
            logFromRequest(req, ActionTypes.ADMIN_EDIT_MINGPI, { targetUserId: userId, lunarYear, lunarMonth });
            res.json({ success: true, action: 'updated', id: existing.id });
        } else {
            // 创建
            const result = run(
                `INSERT INTO mingpi (user_id, lunar_year, lunar_month, content, created_at, updated_at)
                 VALUES (?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                [userId, lunarYear, lunarMonth, content]
            );
            logFromRequest(req, ActionTypes.ADMIN_CREATE_MINGPI, { targetUserId: userId, lunarYear, lunarMonth });
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

        // 记录删除命批日志
        logFromRequest(req, ActionTypes.ADMIN_DELETE_MINGPI, { mingpiId });

        res.json({ success: true });
    } catch (error) {
        console.error('删除命批错误:', error);
        res.status(500).json({ error: '删除命批失败' });
    }
});

/**
 * POST /api/admin/mingpi/batch
 * 批量导入命批
 * 支持两种格式：
 * 1. 可视化导入：{ userId, lunarYear, items: [{month, content}] }
 * 2. CSV导入：{ data: [{username, lunarYear, lunarMonth, content}] }
 */
router.post('/mingpi/batch', (req, res) => {
    try {
        const { userId, lunarYear, items, data } = req.body;
        const results = { created: 0, updated: 0, skipped: 0, errors: [] };

        // 格式1：可视化导入（单用户单年份）
        if (userId && lunarYear && items) {
            // 检查用户是否存在
            const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
            if (!user) {
                return res.status(404).json({ error: '用户不存在' });
            }

            for (const item of items) {
                const { month, content } = item;

                // 跳过空内容
                if (!content || content.trim() === '') {
                    results.skipped++;
                    continue;
                }

                // 验证月份
                if (month < 1 || month > 12) {
                    results.errors.push(`无效的月份: ${month}`);
                    continue;
                }

                // UPSERT
                const existing = queryOne(
                    'SELECT id FROM mingpi WHERE user_id = ? AND lunar_year = ? AND lunar_month = ?',
                    [userId, lunarYear, month]
                );

                if (existing) {
                    run(
                        'UPDATE mingpi SET content = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?',
                        [content.trim(), existing.id]
                    );
                    results.updated++;
                } else {
                    run(
                        `INSERT INTO mingpi (user_id, lunar_year, lunar_month, content, created_at, updated_at)
                         VALUES (?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                        [userId, lunarYear, month, content.trim()]
                    );
                    results.created++;
                }
            }
        }
        // 格式2：CSV导入（多用户多年份）
        else if (data && Array.isArray(data)) {
            // 构建用户名到ID的映射
            const users = query('SELECT id, username FROM users');
            const userMap = {};
            users.forEach(u => { userMap[u.username] = u.id; });

            for (const row of data) {
                const { username, lunarYear: year, lunarMonth: month, content } = row;

                // 跳过空内容
                if (!content || content.trim() === '') {
                    results.skipped++;
                    continue;
                }

                // 查找用户
                const uid = userMap[username];
                if (!uid) {
                    results.errors.push(`用户不存在: ${username}`);
                    continue;
                }

                // 验证年月
                if (year < 1900 || year > 2100 || month < 1 || month > 12) {
                    results.errors.push(`无效的年月: ${year}/${month}`);
                    continue;
                }

                // UPSERT
                const existing = queryOne(
                    'SELECT id FROM mingpi WHERE user_id = ? AND lunar_year = ? AND lunar_month = ?',
                    [uid, year, month]
                );

                if (existing) {
                    run(
                        'UPDATE mingpi SET content = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?',
                        [content.trim(), existing.id]
                    );
                    results.updated++;
                } else {
                    run(
                        `INSERT INTO mingpi (user_id, lunar_year, lunar_month, content, created_at, updated_at)
                         VALUES (?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                        [uid, year, month, content.trim()]
                    );
                    results.created++;
                }
            }
        } else {
            return res.status(400).json({ error: '无效的导入数据格式' });
        }

        // 记录批量导入日志
        logFromRequest(req, ActionTypes.ADMIN_BATCH_IMPORT, {
            created: results.created,
            updated: results.updated,
            skipped: results.skipped
        });

        res.json({ success: true, results });
    } catch (error) {
        console.error('批量导入命批错误:', error);
        res.status(500).json({ error: '批量导入失败' });
    }
});

/**
 * POST /api/admin/mingpi/batch/preview
 * 预览批量导入（不实际写入）
 */
router.post('/mingpi/batch/preview', (req, res) => {
    try {
        const { userId, lunarYear, items } = req.body;
        const preview = [];

        if (!userId || !lunarYear || !items) {
            return res.status(400).json({ error: '参数不完整' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id, display_name FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const lunarMonthNames = ['正月', '二月', '三月', '四月', '五月', '六月',
                                  '七月', '八月', '九月', '十月', '冬月', '腊月'];

        for (const item of items) {
            const { month, content } = item;

            const existing = queryOne(
                'SELECT id, content FROM mingpi WHERE user_id = ? AND lunar_year = ? AND lunar_month = ?',
                [userId, lunarYear, month]
            );

            preview.push({
                month,
                monthName: lunarMonthNames[month - 1],
                content: content || '',
                isEmpty: !content || content.trim() === '',
                exists: !!existing,
                existingContent: existing ? existing.content : null,
                action: !content || content.trim() === '' ? 'skip' : (existing ? 'update' : 'create')
            });
        }

        res.json({
            success: true,
            user: { id: user.id, displayName: user.display_name },
            lunarYear,
            preview,
            summary: {
                create: preview.filter(p => p.action === 'create').length,
                update: preview.filter(p => p.action === 'update').length,
                skip: preview.filter(p => p.action === 'skip').length
            }
        });
    } catch (error) {
        console.error('预览批量导入错误:', error);
        res.status(500).json({ error: '预览失败' });
    }
});

/**
 * DELETE /api/admin/mingpi/batch
 * 批量清空命批
 */
router.delete('/mingpi/batch', (req, res) => {
    try {
        const { userId, lunarYear } = req.body;

        if (!userId) {
            return res.status(400).json({ error: '请指定用户' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        let sql = 'DELETE FROM mingpi WHERE user_id = ?';
        const params = [userId];

        if (lunarYear) {
            sql += ' AND lunar_year = ?';
            params.push(lunarYear);
        }

        const result = run(sql, params);

        // 记录批量删除日志
        logFromRequest(req, ActionTypes.ADMIN_BATCH_DELETE, {
            targetUserId: userId,
            lunarYear: lunarYear || 'all',
            deleted: result.changes
        });

        res.json({
            success: true,
            deleted: result.changes,
            message: lunarYear
                ? `已清空该用户 ${lunarYear} 年的所有命批`
                : '已清空该用户的所有命批'
        });
    } catch (error) {
        console.error('批量清空命批错误:', error);
        res.status(500).json({ error: '批量清空失败' });
    }
});

/**
 * GET /api/admin/mingpi/export
 * 导出命批为CSV格式
 */
router.get('/mingpi/export', (req, res) => {
    try {
        const { userId, lunarYear } = req.query;

        let sql = `
            SELECT u.username, m.lunar_year, m.lunar_month, m.content
            FROM mingpi m
            JOIN users u ON m.user_id = u.id
        `;
        const params = [];
        const conditions = [];

        if (userId) {
            conditions.push('m.user_id = ?');
            params.push(parseInt(userId));
        }

        if (lunarYear) {
            conditions.push('m.lunar_year = ?');
            params.push(parseInt(lunarYear));
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY u.username, m.lunar_year, m.lunar_month';

        const mingpis = query(sql, params);

        // 生成CSV
        const header = '用户名,农历年份,月份,命批内容';
        const rows = mingpis.map(m => {
            // 处理内容中的逗号和换行
            const content = m.content
                .replace(/"/g, '""')
                .replace(/\n/g, '\\n');
            return `${m.username},${m.lunar_year},${m.lunar_month},"${content}"`;
        });

        const csv = [header, ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=mingpi_export.csv');
        // 添加 BOM 以支持 Excel 正确识别 UTF-8
        res.send('\uFEFF' + csv);
    } catch (error) {
        console.error('导出命批错误:', error);
        res.status(500).json({ error: '导出失败' });
    }
});

/**
 * GET /api/admin/mingpi/template
 * 下载CSV导入模板
 */
router.get('/mingpi/template', (req, res) => {
    const template = `用户名,农历年份,月份,命批内容
zhangsan,2025,1,正月命批内容示例...
zhangsan,2025,2,二月命批内容示例...
zhangsan,2025,3,三月命批内容示例...
lisi,2025,1,正月命批内容示例...`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=mingpi_template.csv');
    res.send('\uFEFF' + template);
});

// ============ 统计仪表盘 ============

/**
 * GET /api/admin/stats/overview
 * 获取概览统计数据
 */
router.get('/stats/overview', (req, res) => {
    try {
        // 用户总数
        const userCount = queryOne('SELECT COUNT(*) as count FROM users WHERE is_admin = 0');

        // 命批总数
        const mingpiCount = queryOne('SELECT COUNT(*) as count FROM mingpi');

        // 今日访问量（PV）
        const todayPV = queryOne(`
            SELECT COUNT(*) as count FROM access_logs
            WHERE date(created_at) = date(datetime("now", "+8 hours"))
        `);

        // 今日独立访客（UV）
        const todayUV = queryOne(`
            SELECT COUNT(DISTINCT user_id) as count FROM access_logs
            WHERE date(created_at) = date(datetime("now", "+8 hours"))
            AND user_id IS NOT NULL
        `);

        // 本周活跃用户
        const weeklyActive = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE last_login_at >= datetime("now", "+8 hours", "-7 days")
            AND is_admin = 0
        `);

        // 本月活跃用户
        const monthlyActive = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE last_login_at >= datetime("now", "+8 hours", "-30 days")
            AND is_admin = 0
        `);

        res.json({
            success: true,
            data: {
                userCount: userCount?.count || 0,
                mingpiCount: mingpiCount?.count || 0,
                todayPV: todayPV?.count || 0,
                todayUV: todayUV?.count || 0,
                weeklyActive: weeklyActive?.count || 0,
                monthlyActive: monthlyActive?.count || 0
            }
        });
    } catch (error) {
        console.error('获取概览统计错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

/**
 * GET /api/admin/stats/trend
 * 获取访问趋势数据（最近7天或30天）
 */
router.get('/stats/trend', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const validDays = Math.min(Math.max(days, 7), 30);

        // 生成日期列表
        const dates = [];
        for (let i = validDays - 1; i >= 0; i--) {
            dates.push({
                offset: i,
                date: null,
                pv: 0,
                uv: 0
            });
        }

        // 获取每日PV
        const pvData = query(`
            SELECT date(created_at) as date, COUNT(*) as count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            GROUP BY date(created_at)
            ORDER BY date
        `);

        // 获取每日UV
        const uvData = query(`
            SELECT date(created_at) as date, COUNT(DISTINCT user_id) as count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            AND user_id IS NOT NULL
            GROUP BY date(created_at)
            ORDER BY date
        `);

        // 构建PV/UV映射
        const pvMap = {};
        const uvMap = {};
        pvData.forEach(row => { pvMap[row.date] = row.count; });
        uvData.forEach(row => { uvMap[row.date] = row.count; });

        // 填充日期数据
        const result = dates.map((d, index) => {
            // 计算实际日期（北京时间）
            const dateObj = new Date();
            dateObj.setTime(dateObj.getTime() + 8 * 60 * 60 * 1000); // 转北京时间
            dateObj.setDate(dateObj.getDate() - d.offset);
            const dateStr = dateObj.toISOString().split('T')[0];

            return {
                date: dateStr,
                label: `${dateObj.getMonth() + 1}/${dateObj.getDate()}`,
                pv: pvMap[dateStr] || 0,
                uv: uvMap[dateStr] || 0
            };
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('获取访问趋势错误:', error);
        res.status(500).json({ error: '获取趋势数据失败' });
    }
});

/**
 * GET /api/admin/stats/users
 * 获取用户活跃度统计
 */
router.get('/stats/users', (req, res) => {
    try {
        // 今日登录
        const todayLogin = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE date(last_login_at) = date(datetime("now", "+8 hours"))
            AND is_admin = 0
        `);

        // 本周活跃
        const weeklyActive = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE last_login_at >= datetime("now", "+8 hours", "-7 days")
            AND is_admin = 0
        `);

        // 本月活跃
        const monthlyActive = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE last_login_at >= datetime("now", "+8 hours", "-30 days")
            AND is_admin = 0
        `);

        // 从未登录
        const neverLogin = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE last_login_at IS NULL
            AND is_admin = 0
        `);

        // 已锁定用户
        const lockedUsers = queryOne(`
            SELECT COUNT(*) as count FROM users
            WHERE is_locked = 1
            AND is_admin = 0
        `);

        // 最近登录的用户（前5个）
        const recentLogins = query(`
            SELECT id, display_name, last_login_at
            FROM users
            WHERE last_login_at IS NOT NULL AND is_admin = 0
            ORDER BY last_login_at DESC
            LIMIT 5
        `);

        res.json({
            success: true,
            data: {
                todayLogin: todayLogin?.count || 0,
                weeklyActive: weeklyActive?.count || 0,
                monthlyActive: monthlyActive?.count || 0,
                neverLogin: neverLogin?.count || 0,
                lockedUsers: lockedUsers?.count || 0,
                recentLogins: recentLogins.map(u => ({
                    id: u.id,
                    displayName: u.display_name,
                    lastLoginAt: u.last_login_at
                }))
            }
        });
    } catch (error) {
        console.error('获取用户活跃度统计错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

/**
 * GET /api/admin/stats/mingpi
 * 获取命批覆盖统计
 */
router.get('/stats/mingpi', (req, res) => {
    try {
        // 获取当前农历年（简化处理，使用公历年）
        const now = new Date();
        now.setTime(now.getTime() + 8 * 60 * 60 * 1000);
        const currentYear = now.getFullYear();

        // 各年份命批数量
        const yearStats = query(`
            SELECT lunar_year as year, COUNT(*) as count
            FROM mingpi
            WHERE lunar_year >= ? AND lunar_year <= ?
            GROUP BY lunar_year
            ORDER BY lunar_year DESC
        `, [currentYear - 2, currentYear + 1]);

        // 用户总数（非管理员）
        const totalUsers = queryOne('SELECT COUNT(*) as count FROM users WHERE is_admin = 0');

        // 有命批的用户数（当年）
        const usersWithMingpi = queryOne(`
            SELECT COUNT(DISTINCT user_id) as count
            FROM mingpi
            WHERE lunar_year = ?
        `, [currentYear]);

        // 各用户的命批覆盖月份数
        const userCoverage = query(`
            SELECT u.id, u.display_name, COUNT(m.id) as month_count
            FROM users u
            LEFT JOIN mingpi m ON u.id = m.user_id AND m.lunar_year = ?
            WHERE u.is_admin = 0
            GROUP BY u.id
            ORDER BY month_count DESC
            LIMIT 10
        `, [currentYear]);

        // 计算平均覆盖率
        const avgCoverage = queryOne(`
            SELECT AVG(month_count) as avg FROM (
                SELECT user_id, COUNT(*) as month_count
                FROM mingpi
                WHERE lunar_year = ?
                GROUP BY user_id
            )
        `, [currentYear]);

        res.json({
            success: true,
            data: {
                currentYear,
                yearStats: yearStats.map(y => ({
                    year: y.year,
                    count: y.count,
                    coverage: Math.round((y.count / (12 * (totalUsers?.count || 1))) * 100)
                })),
                totalUsers: totalUsers?.count || 0,
                usersWithMingpi: usersWithMingpi?.count || 0,
                avgMonthsPerUser: Math.round((avgCoverage?.avg || 0) * 10) / 10,
                userCoverage: userCoverage.map(u => ({
                    id: u.id,
                    displayName: u.display_name,
                    monthCount: u.month_count,
                    percentage: Math.round((u.month_count / 12) * 100)
                }))
            }
        });
    } catch (error) {
        console.error('获取命批覆盖统计错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

/**
 * GET /api/admin/stats/logs
 * 获取最近活动日志
 */
router.get('/stats/logs', (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);

        const logs = query(`
            SELECT l.*, u.display_name as user_display_name
            FROM access_logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT ?
        `, [limit]);

        // 操作类型的中文映射
        const actionNames = {
            'login': '用户登录',
            'logout': '用户登出',
            'view_calendar': '查看日历',
            'view_mingpi': '查看命批',
            'change_password': '修改密码',
            'admin_login': '管理员登录',
            'admin_create_user': '创建用户',
            'admin_edit_user': '编辑用户',
            'admin_delete_user': '删除用户',
            'admin_lock_user': '锁定用户',
            'admin_reset_password': '重置密码',
            'admin_create_mingpi': '创建命批',
            'admin_edit_mingpi': '编辑命批',
            'admin_delete_mingpi': '删除命批',
            'admin_batch_import': '批量导入',
            'admin_batch_delete': '批量删除'
        };

        res.json({
            success: true,
            data: logs.map(log => ({
                id: log.id,
                userId: log.user_id,
                userDisplayName: log.user_display_name || '未知用户',
                action: log.action,
                actionName: actionNames[log.action] || log.action,
                page: log.page,
                ipAddress: log.ip_address,
                location: log.location || '未知',
                extraData: log.extra_data ? JSON.parse(log.extra_data) : null,
                createdAt: log.created_at
            }))
        });
    } catch (error) {
        console.error('获取活动日志错误:', error);
        res.status(500).json({ error: '获取日志失败' });
    }
});

/**
 * GET /api/admin/stats/devices
 * 获取访问设备统计
 */
router.get('/stats/devices', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const validDays = Math.min(Math.max(days, 7), 90);

        // 按设备类型统计
        const deviceTypeStats = query(`
            SELECT
                COALESCE(device_type, '未知') as device_type,
                COUNT(*) as count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            GROUP BY device_type
            ORDER BY count DESC
        `);

        // 按操作系统统计
        const osStats = query(`
            SELECT
                COALESCE(os, '未知') as os,
                COUNT(*) as count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            GROUP BY os
            ORDER BY count DESC
            LIMIT 10
        `);

        // 按浏览器统计
        const browserStats = query(`
            SELECT
                COALESCE(browser, '未知') as browser,
                COUNT(*) as count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            GROUP BY browser
            ORDER BY count DESC
            LIMIT 10
        `);

        // 统计总访问量
        const totalVisits = queryOne(`
            SELECT COUNT(*) as count FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
        `);

        const total = totalVisits?.count || 1;

        res.json({
            success: true,
            data: {
                days: validDays,
                totalVisits: total,
                deviceTypeStats: deviceTypeStats.map(d => ({
                    deviceType: d.device_type,
                    count: d.count,
                    percentage: Math.round((d.count / total) * 100)
                })),
                osStats: osStats.map(o => ({
                    os: o.os,
                    count: o.count,
                    percentage: Math.round((o.count / total) * 100)
                })),
                browserStats: browserStats.map(b => ({
                    browser: b.browser,
                    count: b.count,
                    percentage: Math.round((b.count / total) * 100)
                }))
            }
        });
    } catch (error) {
        console.error('获取设备统计错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

/**
 * GET /api/admin/stats/locations
 * 获取访问地理位置统计
 */
router.get('/stats/locations', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const validDays = Math.min(Math.max(days, 7), 90);

        // 按地理位置统计访问量
        const locationStats = query(`
            SELECT
                COALESCE(location, '未知') as location,
                COUNT(*) as count,
                COUNT(DISTINCT user_id) as user_count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            AND location IS NOT NULL
            AND location != ''
            GROUP BY location
            ORDER BY count DESC
            LIMIT 20
        `);

        // 统计总访问量
        const totalVisits = queryOne(`
            SELECT COUNT(*) as count FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
        `);

        // 按国家/地区汇总（提取第一个词作为国家）
        const countryStats = query(`
            SELECT
                CASE
                    WHEN location IS NULL OR location = '' THEN '未知'
                    WHEN location = '本地网络' THEN '本地网络'
                    ELSE SUBSTR(location, 1, INSTR(location || ' ', ' ') - 1)
                END as country,
                COUNT(*) as count
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-${validDays} days")
            GROUP BY country
            ORDER BY count DESC
            LIMIT 10
        `);

        // 最近访问的地理位置（去重）
        const recentLocations = query(`
            SELECT DISTINCT location, MAX(created_at) as last_visit
            FROM access_logs
            WHERE created_at >= datetime("now", "+8 hours", "-7 days")
            AND location IS NOT NULL
            AND location != ''
            AND location != '未知'
            GROUP BY location
            ORDER BY last_visit DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            data: {
                days: validDays,
                totalVisits: totalVisits?.count || 0,
                locationStats: locationStats.map(l => ({
                    location: l.location,
                    count: l.count,
                    userCount: l.user_count,
                    percentage: totalVisits?.count ? Math.round((l.count / totalVisits.count) * 100) : 0
                })),
                countryStats: countryStats.map(c => ({
                    country: c.country,
                    count: c.count,
                    percentage: totalVisits?.count ? Math.round((c.count / totalVisits.count) * 100) : 0
                })),
                recentLocations: recentLocations.map(r => ({
                    location: r.location,
                    lastVisit: r.last_visit
                }))
            }
        });
    } catch (error) {
        console.error('获取地理位置统计错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

// ============ 系统配置管理 ============

/**
 * GET /api/admin/config
 * 获取所有系统配置
 */
router.get('/config', (req, res) => {
    try {
        const configs = query('SELECT key, value, description, updated_at FROM system_config');

        res.json({
            success: true,
            data: configs.reduce((acc, c) => {
                acc[c.key] = {
                    value: c.value,
                    description: c.description,
                    updatedAt: c.updated_at
                };
                return acc;
            }, {})
        });
    } catch (error) {
        console.error('获取系统配置错误:', error);
        res.status(500).json({ error: '获取配置失败' });
    }
});

/**
 * PUT /api/admin/config/:key
 * 更新系统配置
 */
router.put('/config/:key', (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined || value === null) {
            return res.status(400).json({ error: '配置值不能为空' });
        }

        // 验证配置项是否存在
        const existing = queryOne('SELECT key FROM system_config WHERE key = ?', [key]);
        if (!existing) {
            return res.status(404).json({ error: '配置项不存在' });
        }

        // 特殊验证：后台路径
        if (key === 'admin_path') {
            // 路径只能包含字母、数字、下划线和中划线
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                return res.status(400).json({ error: '后台路径只能包含字母、数字、下划线和中划线' });
            }
            // 路径长度限制
            if (value.length < 4 || value.length > 32) {
                return res.status(400).json({ error: '后台路径长度需在4-32个字符之间' });
            }
            // 不能是常见路径
            const forbiddenPaths = ['admin', 'api', 'public', 'static', 'assets', 'css', 'js', 'img', 'images'];
            if (forbiddenPaths.includes(value.toLowerCase())) {
                return res.status(400).json({ error: '不能使用保留路径名' });
            }
        }

        // 更新配置
        setConfig(key, value);

        res.json({
            success: true,
            message: '配置已更新',
            data: { key, value }
        });
    } catch (error) {
        console.error('更新系统配置错误:', error);
        res.status(500).json({ error: '更新配置失败' });
    }
});

/**
 * POST /api/admin/config/regenerate-path
 * 重新生成随机后台路径
 */
router.post('/config/regenerate-path', (req, res) => {
    try {
        const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
        let newPath = '';
        for (let i = 0; i < 8; i++) {
            newPath += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        setConfig('admin_path', newPath);

        res.json({
            success: true,
            message: '已生成新的后台路径',
            data: { adminPath: newPath }
        });
    } catch (error) {
        console.error('重新生成路径错误:', error);
        res.status(500).json({ error: '生成路径失败' });
    }
});

// ============ 用户资料管理（固定数据：八字、起运、命局分析） ============

/**
 * GET /api/admin/user-profile
 * 获取用户资料列表
 */
router.get('/user-profile', (req, res) => {
    try {
        const { userId } = req.query;
        let sql = `
            SELECT p.*, u.display_name, u.username
            FROM user_profile p
            JOIN users u ON p.user_id = u.id
        `;
        const params = [];

        if (userId) {
            sql += ` WHERE p.user_id = ?`;
            params.push(parseInt(userId));
        }

        sql += ` ORDER BY u.display_name`;

        const profiles = query(sql, params);

        res.json({
            success: true,
            data: profiles.map(p => ({
                id: p.id,
                userId: p.user_id,
                userDisplayName: p.display_name,
                username: p.username,
                yearPillar: p.year_pillar,
                monthPillar: p.month_pillar,
                dayPillar: p.day_pillar,
                hourPillar: p.hour_pillar,
                qiyunAge: p.qiyun_age,
                analysis: p.analysis,
                createdAt: p.created_at,
                updatedAt: p.updated_at
            }))
        });
    } catch (error) {
        console.error('获取用户资料列表错误:', error);
        res.status(500).json({ error: '获取用户资料列表失败' });
    }
});

/**
 * GET /api/admin/user-profile/:userId
 * 获取单个用户资料
 */
router.get('/user-profile/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);

        const profile = queryOne(`
            SELECT p.*, u.display_name, u.username
            FROM user_profile p
            JOIN users u ON p.user_id = u.id
            WHERE p.user_id = ?
        `, [userId]);

        if (!profile) {
            return res.json({
                success: true,
                data: null
            });
        }

        res.json({
            success: true,
            data: {
                id: profile.id,
                userId: profile.user_id,
                userDisplayName: profile.display_name,
                username: profile.username,
                yearPillar: profile.year_pillar,
                monthPillar: profile.month_pillar,
                dayPillar: profile.day_pillar,
                hourPillar: profile.hour_pillar,
                qiyunAge: profile.qiyun_age,
                analysis: profile.analysis,
                createdAt: profile.created_at,
                updatedAt: profile.updated_at
            }
        });
    } catch (error) {
        console.error('获取用户资料错误:', error);
        res.status(500).json({ error: '获取用户资料失败' });
    }
});

/**
 * POST /api/admin/user-profile
 * 创建或更新用户资料 (UPSERT)
 */
router.post('/user-profile', (req, res) => {
    try {
        const { userId, yearPillar, monthPillar, dayPillar, hourPillar, qiyunAge, analysis } = req.body;

        if (!userId) {
            return res.status(400).json({ error: '请选择用户' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 检查是否已存在
        const existing = queryOne('SELECT id FROM user_profile WHERE user_id = ?', [userId]);

        if (existing) {
            // 更新
            run(
                `UPDATE user_profile SET
                    year_pillar = ?, month_pillar = ?, day_pillar = ?, hour_pillar = ?,
                    qiyun_age = ?, analysis = ?, updated_at = datetime("now", "+8 hours")
                WHERE user_id = ?`,
                [yearPillar || null, monthPillar || null, dayPillar || null, hourPillar || null,
                 qiyunAge || null, analysis || null, userId]
            );
            logFromRequest(req, ActionTypes.ADMIN_EDIT_MINGPI, { targetUserId: userId, type: 'profile' });
            res.json({ success: true, action: 'updated', id: existing.id });
        } else {
            // 创建
            const result = run(
                `INSERT INTO user_profile (user_id, year_pillar, month_pillar, day_pillar, hour_pillar, qiyun_age, analysis, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                [userId, yearPillar || null, monthPillar || null, dayPillar || null, hourPillar || null,
                 qiyunAge || null, analysis || null]
            );
            logFromRequest(req, ActionTypes.ADMIN_CREATE_MINGPI, { targetUserId: userId, type: 'profile' });
            res.json({ success: true, action: 'created', id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('保存用户资料错误:', error);
        res.status(500).json({ error: '保存用户资料失败' });
    }
});

/**
 * POST /api/admin/user-profile/batch
 * 批量导入用户资料
 * CSV格式：{ data: [{username, yearPillar, monthPillar, dayPillar, hourPillar, qiyunAge, analysis}] }
 */
router.post('/user-profile/batch', (req, res) => {
    try {
        const { data } = req.body;
        const results = { created: 0, updated: 0, skipped: 0, errors: [] };

        if (!data || !Array.isArray(data)) {
            return res.status(400).json({ error: '无效的数据格式' });
        }

        // 构建用户名到ID的映射
        const users = query('SELECT id, username FROM users');
        const userMap = {};
        users.forEach(u => { userMap[u.username] = u.id; });

        for (const row of data) {
            const { username, yearPillar, monthPillar, dayPillar, hourPillar, qiyunAge, analysis } = row;

            // 查找用户
            const userId = userMap[username];
            if (!userId) {
                results.errors.push(`用户不存在: ${username}`);
                continue;
            }

            // 检查是否有任何数据
            if (!yearPillar && !monthPillar && !dayPillar && !hourPillar && !qiyunAge && !analysis) {
                results.skipped++;
                continue;
            }

            // UPSERT
            const existing = queryOne('SELECT id FROM user_profile WHERE user_id = ?', [userId]);

            if (existing) {
                run(
                    `UPDATE user_profile SET
                        year_pillar = COALESCE(?, year_pillar),
                        month_pillar = COALESCE(?, month_pillar),
                        day_pillar = COALESCE(?, day_pillar),
                        hour_pillar = COALESCE(?, hour_pillar),
                        qiyun_age = COALESCE(?, qiyun_age),
                        analysis = COALESCE(?, analysis),
                        updated_at = datetime("now", "+8 hours")
                    WHERE user_id = ?`,
                    [yearPillar || null, monthPillar || null, dayPillar || null, hourPillar || null,
                     qiyunAge || null, analysis || null, userId]
                );
                results.updated++;
            } else {
                run(
                    `INSERT INTO user_profile (user_id, year_pillar, month_pillar, day_pillar, hour_pillar, qiyun_age, analysis, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                    [userId, yearPillar || null, monthPillar || null, dayPillar || null, hourPillar || null,
                     qiyunAge || null, analysis || null]
                );
                results.created++;
            }
        }

        logFromRequest(req, ActionTypes.ADMIN_BATCH_IMPORT, { type: 'profile', ...results });
        res.json({ success: true, results });
    } catch (error) {
        console.error('批量导入用户资料错误:', error);
        res.status(500).json({ error: '批量导入失败' });
    }
});

/**
 * DELETE /api/admin/user-profile/:userId
 * 删除用户资料
 */
router.delete('/user-profile/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);

        const existing = queryOne('SELECT id FROM user_profile WHERE user_id = ?', [userId]);
        if (!existing) {
            return res.status(404).json({ error: '用户资料不存在' });
        }

        run('DELETE FROM user_profile WHERE user_id = ?', [userId]);
        logFromRequest(req, ActionTypes.ADMIN_DELETE_MINGPI, { targetUserId: userId, type: 'profile' });

        res.json({ success: true });
    } catch (error) {
        console.error('删除用户资料错误:', error);
        res.status(500).json({ error: '删除用户资料失败' });
    }
});

/**
 * GET /api/admin/user-profile/template
 * 下载用户资料CSV导入模板
 */
router.get('/user-profile/template', (req, res) => {
    const template = `用户名,年柱,月柱,日柱,时柱,起运年龄,命局分析
zhangsan,癸丑,庚申,己卯,壬申,9,"癸丑女命，天干壬癸聚贵于卯，入女命十八贵格之伤官生财..."
lisi,甲寅,丙子,戊午,甲寅,6,"甲寅男命，印星高透..."`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=user_profile_template.csv');
    res.send('\uFEFF' + template);
});

// ============ 年度运势管理（每年更新：大运、流年、四季财官） ============

/**
 * GET /api/admin/yearly-fortune
 * 获取年度运势列表
 */
router.get('/yearly-fortune', (req, res) => {
    try {
        const { userId, year } = req.query;
        let sql = `
            SELECT f.*, u.display_name, u.username
            FROM user_yearly_fortune f
            JOIN users u ON f.user_id = u.id
        `;
        const params = [];
        const conditions = [];

        if (userId) {
            conditions.push('f.user_id = ?');
            params.push(parseInt(userId));
        }
        if (year) {
            conditions.push('f.lunar_year = ?');
            params.push(parseInt(year));
        }

        if (conditions.length > 0) {
            sql += ` WHERE ` + conditions.join(' AND ');
        }

        sql += ` ORDER BY f.lunar_year DESC, u.display_name`;

        const fortunes = query(sql, params);

        res.json({
            success: true,
            data: fortunes.map(f => ({
                id: f.id,
                userId: f.user_id,
                userDisplayName: f.display_name,
                username: f.username,
                lunarYear: f.lunar_year,
                dayun: f.dayun,
                liunian: f.liunian,
                springContent: f.spring_content,
                summerContent: f.summer_content,
                autumnContent: f.autumn_content,
                winterContent: f.winter_content,
                createdAt: f.created_at,
                updatedAt: f.updated_at
            }))
        });
    } catch (error) {
        console.error('获取年度运势列表错误:', error);
        res.status(500).json({ error: '获取年度运势列表失败' });
    }
});

/**
 * GET /api/admin/yearly-fortune/:userId/:year
 * 获取指定用户指定年份的运势
 */
router.get('/yearly-fortune/:userId/:year', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const year = parseInt(req.params.year);

        const fortune = queryOne(`
            SELECT f.*, u.display_name, u.username
            FROM user_yearly_fortune f
            JOIN users u ON f.user_id = u.id
            WHERE f.user_id = ? AND f.lunar_year = ?
        `, [userId, year]);

        if (!fortune) {
            return res.json({
                success: true,
                data: null
            });
        }

        res.json({
            success: true,
            data: {
                id: fortune.id,
                userId: fortune.user_id,
                userDisplayName: fortune.display_name,
                username: fortune.username,
                lunarYear: fortune.lunar_year,
                dayun: fortune.dayun,
                liunian: fortune.liunian,
                springContent: fortune.spring_content,
                summerContent: fortune.summer_content,
                autumnContent: fortune.autumn_content,
                winterContent: fortune.winter_content,
                createdAt: fortune.created_at,
                updatedAt: fortune.updated_at
            }
        });
    } catch (error) {
        console.error('获取年度运势错误:', error);
        res.status(500).json({ error: '获取年度运势失败' });
    }
});

/**
 * POST /api/admin/yearly-fortune
 * 创建或更新年度运势 (UPSERT)
 */
router.post('/yearly-fortune', (req, res) => {
    try {
        const { userId, lunarYear, dayun, liunian, springContent, summerContent, autumnContent, winterContent } = req.body;

        if (!userId || !lunarYear) {
            return res.status(400).json({ error: '请选择用户和年份' });
        }

        if (lunarYear < 1900 || lunarYear > 2100) {
            return res.status(400).json({ error: '无效的农历年份' });
        }

        // 检查用户是否存在
        const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 检查是否已存在
        const existing = queryOne(
            'SELECT id FROM user_yearly_fortune WHERE user_id = ? AND lunar_year = ?',
            [userId, lunarYear]
        );

        if (existing) {
            // 更新
            run(
                `UPDATE user_yearly_fortune SET
                    dayun = ?, liunian = ?,
                    spring_content = ?, summer_content = ?, autumn_content = ?, winter_content = ?,
                    updated_at = datetime("now", "+8 hours")
                WHERE user_id = ? AND lunar_year = ?`,
                [dayun || null, liunian || null,
                 springContent || null, summerContent || null, autumnContent || null, winterContent || null,
                 userId, lunarYear]
            );
            logFromRequest(req, ActionTypes.ADMIN_EDIT_MINGPI, { targetUserId: userId, lunarYear, type: 'yearly-fortune' });
            res.json({ success: true, action: 'updated', id: existing.id });
        } else {
            // 创建
            const result = run(
                `INSERT INTO user_yearly_fortune (user_id, lunar_year, dayun, liunian, spring_content, summer_content, autumn_content, winter_content, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                [userId, lunarYear, dayun || null, liunian || null,
                 springContent || null, summerContent || null, autumnContent || null, winterContent || null]
            );
            logFromRequest(req, ActionTypes.ADMIN_CREATE_MINGPI, { targetUserId: userId, lunarYear, type: 'yearly-fortune' });
            res.json({ success: true, action: 'created', id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('保存年度运势错误:', error);
        res.status(500).json({ error: '保存年度运势失败' });
    }
});

/**
 * POST /api/admin/yearly-fortune/batch
 * 批量导入年度运势
 * CSV格式：{ data: [{username, lunarYear, dayun, liunian, springContent, summerContent, autumnContent, winterContent}] }
 */
router.post('/yearly-fortune/batch', (req, res) => {
    try {
        const { data } = req.body;
        const results = { created: 0, updated: 0, skipped: 0, errors: [] };

        if (!data || !Array.isArray(data)) {
            return res.status(400).json({ error: '无效的数据格式' });
        }

        // 构建用户名到ID的映射
        const users = query('SELECT id, username FROM users');
        const userMap = {};
        users.forEach(u => { userMap[u.username] = u.id; });

        for (const row of data) {
            const { username, lunarYear, dayun, liunian, springContent, summerContent, autumnContent, winterContent } = row;

            // 查找用户
            const userId = userMap[username];
            if (!userId) {
                results.errors.push(`用户不存在: ${username}`);
                continue;
            }

            // 验证年份
            if (!lunarYear || lunarYear < 1900 || lunarYear > 2100) {
                results.errors.push(`无效的年份: ${lunarYear}`);
                continue;
            }

            // 检查是否有任何数据
            if (!dayun && !liunian && !springContent && !summerContent && !autumnContent && !winterContent) {
                results.skipped++;
                continue;
            }

            // UPSERT
            const existing = queryOne(
                'SELECT id FROM user_yearly_fortune WHERE user_id = ? AND lunar_year = ?',
                [userId, lunarYear]
            );

            if (existing) {
                run(
                    `UPDATE user_yearly_fortune SET
                        dayun = COALESCE(?, dayun),
                        liunian = COALESCE(?, liunian),
                        spring_content = COALESCE(?, spring_content),
                        summer_content = COALESCE(?, summer_content),
                        autumn_content = COALESCE(?, autumn_content),
                        winter_content = COALESCE(?, winter_content),
                        updated_at = datetime("now", "+8 hours")
                    WHERE user_id = ? AND lunar_year = ?`,
                    [dayun || null, liunian || null,
                     springContent || null, summerContent || null, autumnContent || null, winterContent || null,
                     userId, lunarYear]
                );
                results.updated++;
            } else {
                run(
                    `INSERT INTO user_yearly_fortune (user_id, lunar_year, dayun, liunian, spring_content, summer_content, autumn_content, winter_content, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"), datetime("now", "+8 hours"))`,
                    [userId, lunarYear, dayun || null, liunian || null,
                     springContent || null, summerContent || null, autumnContent || null, winterContent || null]
                );
                results.created++;
            }
        }

        logFromRequest(req, ActionTypes.ADMIN_BATCH_IMPORT, { type: 'yearly-fortune', ...results });
        res.json({ success: true, results });
    } catch (error) {
        console.error('批量导入年度运势错误:', error);
        res.status(500).json({ error: '批量导入失败' });
    }
});

/**
 * DELETE /api/admin/yearly-fortune/:userId/:year
 * 删除年度运势（按用户和年份）
 */
router.delete('/yearly-fortune/:userId/:year', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const lunarYear = parseInt(req.params.year);

        const existing = queryOne('SELECT id FROM user_yearly_fortune WHERE user_id = ? AND lunar_year = ?', [userId, lunarYear]);
        if (!existing) {
            return res.status(404).json({ error: '年度运势不存在' });
        }

        run('DELETE FROM user_yearly_fortune WHERE user_id = ? AND lunar_year = ?', [userId, lunarYear]);
        logFromRequest(req, ActionTypes.ADMIN_DELETE_MINGPI, { targetUserId: userId, lunarYear, type: 'yearly-fortune' });

        res.json({ success: true });
    } catch (error) {
        console.error('删除年度运势错误:', error);
        res.status(500).json({ error: '删除年度运势失败' });
    }
});

/**
 * GET /api/admin/yearly-fortune/template
 * 下载年度运势CSV导入模板
 */
router.get('/yearly-fortune/template', (req, res) => {
    const template = `用户名,农历年份,大运,流年,春季,夏季,秋季,冬季
zhangsan,2025,乙丑,丙午,"春木当令，财星得位。宜进取开拓，利于求财谋事。","夏火旺盛，官星显耀。宜守成稳进，利于仕途升迁。","秋金肃杀，印星护身。宜收敛积蓄，利于学业进修。","冬水藏润，比劫帮身。宜静养休整，利于谋划来年。"
lisi,2025,丙寅,丙午,"春季运势...","夏季运势...","秋季运势...","冬季运势..."`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=yearly_fortune_template.csv');
    res.send('\uFEFF' + template);
});


// ============ 广告管理 ============

/**
 * GET /api/admin/ads
 * 获取所有广告列表（不含完整图片数据，优化加载速度）
 */
router.get('/ads', (req, res) => {
    try {
        const ads = query(`
            SELECT a.id, a.ad_type, a.name, a.link_url, a.is_enabled,
                   a.start_time, a.end_time, a.display_frequency,
                   a.countdown_seconds, a.sort_order, a.created_at, a.updated_at,
                   CASE WHEN a.image_url IS NOT NULL AND a.image_url != '' THEN 1 ELSE 0 END as has_image,
                   CASE WHEN a.image_url LIKE 'data:%' THEN 'base64' ELSE 'url' END as image_type,
                (SELECT COUNT(*) FROM ad_stats WHERE ad_id = a.id AND action = 'view') as view_count,
                (SELECT COUNT(*) FROM ad_stats WHERE ad_id = a.id AND action = 'click') as click_count,
                (SELECT COUNT(*) FROM ad_stats WHERE ad_id = a.id AND action = 'close') as close_count
            FROM ads a
            ORDER BY a.ad_type, a.sort_order ASC, a.id DESC
        `);

        res.json({
            success: true,
            data: ads.map(ad => ({
                id: ad.id,
                adType: ad.ad_type,
                name: ad.name,
                hasImage: ad.has_image === 1,
                imageType: ad.image_type,
                linkUrl: ad.link_url,
                isEnabled: ad.is_enabled === 1,
                startTime: ad.start_time,
                endTime: ad.end_time,
                displayFrequency: ad.display_frequency,
                countdownSeconds: ad.countdown_seconds,
                sortOrder: ad.sort_order,
                viewCount: ad.view_count || 0,
                clickCount: ad.click_count || 0,
                closeCount: ad.close_count || 0,
                createdAt: ad.created_at,
                updatedAt: ad.updated_at
            }))
        });
    } catch (error) {
        console.error('获取广告列表错误:', error);
        res.status(500).json({ error: '获取广告列表失败' });
    }
});

/**
 * GET /api/admin/ads/:id
 * 获取单个广告详情
 */
router.get('/ads/:id', (req, res) => {
    try {
        const adId = parseInt(req.params.id);
        const ad = queryOne('SELECT * FROM ads WHERE id = ?', [adId]);

        if (!ad) {
            return res.status(404).json({ error: '广告不存在' });
        }

        res.json({
            success: true,
            data: {
                id: ad.id,
                adType: ad.ad_type,
                name: ad.name,
                imageUrl: ad.image_url,
                linkUrl: ad.link_url,
                isEnabled: ad.is_enabled === 1,
                startTime: ad.start_time,
                endTime: ad.end_time,
                displayFrequency: ad.display_frequency,
                countdownSeconds: ad.countdown_seconds,
                sortOrder: ad.sort_order,
                createdAt: ad.created_at,
                updatedAt: ad.updated_at
            }
        });
    } catch (error) {
        console.error('获取广告详情错误:', error);
        res.status(500).json({ error: '获取广告详情失败' });
    }
});

/**
 * POST /api/admin/ads/upload-image
 * 上传广告图片
 */
router.post('/ads/upload-image', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请选择要上传的图片' });
        }

        // 返回文件路径（相对于 uploads 目录）
        const imageUrl = `/uploads/ads/${req.file.filename}`;

        logFromRequest(req, 'admin_upload_ad_image', { filename: req.file.filename });

        res.json({
            success: true,
            data: {
                imageUrl: imageUrl,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            }
        });
    } catch (error) {
        console.error('上传广告图片错误:', error);
        res.status(500).json({ error: '上传图片失败' });
    }
});

// 处理 multer 错误
router.use('/ads/upload-image', (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '图片大小不能超过 5MB' });
        }
        return res.status(400).json({ error: '上传失败: ' + err.message });
    } else if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

/**
 * POST /api/admin/ads/migrate-images
 * 迁移 Base64 图片到文件存储
 */
router.post('/ads/migrate-images', async (req, res) => {
    try {
        // 查找所有使用 Base64 存储的广告
        const ads = query(`SELECT id, name, image_url FROM ads WHERE image_url LIKE 'data:%'`);

        if (ads.length === 0) {
            return res.json({
                success: true,
                message: '没有需要迁移的图片',
                migrated: 0
            });
        }

        const uploadDir = path.join(__dirname, '../../uploads/ads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        let migratedCount = 0;
        const errors = [];

        for (const ad of ads) {
            try {
                // 解析 Base64 数据
                const matches = ad.image_url.match(/^data:image\/(\w+);base64,(.+)$/);
                if (!matches) {
                    errors.push({ id: ad.id, name: ad.name, error: '无效的 Base64 格式' });
                    continue;
                }

                const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                const base64Data = matches[2];
                const buffer = Buffer.from(base64Data, 'base64');

                // 生成文件名
                const filename = `ad_${ad.id}_${Date.now()}.${ext}`;
                const filePath = path.join(uploadDir, filename);

                // 写入文件
                fs.writeFileSync(filePath, buffer);

                // 更新数据库
                const newImageUrl = `/uploads/ads/${filename}`;
                run('UPDATE ads SET image_url = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?', [newImageUrl, ad.id]);

                migratedCount++;
            } catch (err) {
                errors.push({ id: ad.id, name: ad.name, error: err.message });
            }
        }

        logFromRequest(req, 'admin_migrate_ad_images', { migratedCount, errorCount: errors.length });

        res.json({
            success: true,
            message: `成功迁移 ${migratedCount} 张图片`,
            migrated: migratedCount,
            total: ads.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('迁移广告图片错误:', error);
        res.status(500).json({ error: '迁移图片失败' });
    }
});

/**
 * POST /api/admin/ads
 * 创建广告
 */
router.post('/ads', (req, res) => {
    try {
        const { adType, name, imageUrl, linkUrl, isEnabled, startTime, endTime, displayFrequency, countdownSeconds, sortOrder } = req.body;

        if (!adType || !name || !imageUrl) {
            return res.status(400).json({ error: '广告类型、名称和图片不能为空' });
        }

        if (!['banner', 'fullscreen'].includes(adType)) {
            return res.status(400).json({ error: '无效的广告类型' });
        }

        const result = run(`
            INSERT INTO ads (ad_type, name, image_url, link_url, is_enabled, start_time, end_time, display_frequency, countdown_seconds, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
        `, [
            adType,
            name,
            imageUrl,
            linkUrl || null,
            isEnabled !== false ? 1 : 0,
            startTime || null,
            endTime || null,
            displayFrequency || 'every_visit',
            countdownSeconds || 3,
            sortOrder || 0
        ]);

        logFromRequest(req, 'admin_create_ad', { adId: result.lastInsertRowid, adType, name });

        res.json({
            success: true,
            data: { id: result.lastInsertRowid }
        });
    } catch (error) {
        console.error('创建广告错误:', error);
        res.status(500).json({ error: '创建广告失败' });
    }
});

/**
 * PUT /api/admin/ads/:id
 * 更新广告
 */
router.put('/ads/:id', (req, res) => {
    try {
        const adId = parseInt(req.params.id);
        const { adType, name, imageUrl, linkUrl, isEnabled, startTime, endTime, displayFrequency, countdownSeconds, sortOrder } = req.body;

        // 检查广告是否存在
        const ad = queryOne('SELECT id FROM ads WHERE id = ?', [adId]);
        if (!ad) {
            return res.status(404).json({ error: '广告不存在' });
        }

        if (!adType || !name || !imageUrl) {
            return res.status(400).json({ error: '广告类型、名称和图片不能为空' });
        }

        run(`
            UPDATE ads SET
                ad_type = ?,
                name = ?,
                image_url = ?,
                link_url = ?,
                is_enabled = ?,
                start_time = ?,
                end_time = ?,
                display_frequency = ?,
                countdown_seconds = ?,
                sort_order = ?,
                updated_at = datetime('now', '+8 hours')
            WHERE id = ?
        `, [
            adType,
            name,
            imageUrl,
            linkUrl || null,
            isEnabled !== false ? 1 : 0,
            startTime || null,
            endTime || null,
            displayFrequency || 'every_visit',
            countdownSeconds || 3,
            sortOrder || 0,
            adId
        ]);

        logFromRequest(req, 'admin_edit_ad', { adId, adType, name });

        res.json({ success: true });
    } catch (error) {
        console.error('更新广告错误:', error);
        res.status(500).json({ error: '更新广告失败' });
    }
});

/**
 * DELETE /api/admin/ads/:id
 * 删除广告
 */
router.delete('/ads/:id', (req, res) => {
    try {
        const adId = parseInt(req.params.id);

        // 检查广告是否存在，并获取图片路径
        const ad = queryOne('SELECT id, name, image_url FROM ads WHERE id = ?', [adId]);
        if (!ad) {
            return res.status(404).json({ error: '广告不存在' });
        }

        // 如果是文件存储的图片，删除文件
        if (ad.image_url && ad.image_url.startsWith('/uploads/ads/')) {
            const filePath = path.join(__dirname, '../..', ad.image_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // 删除广告（统计数据会级联删除）
        run('DELETE FROM ads WHERE id = ?', [adId]);

        logFromRequest(req, 'admin_delete_ad', { adId, name: ad.name });

        res.json({ success: true });
    } catch (error) {
        console.error('删除广告错误:', error);
        res.status(500).json({ error: '删除广告失败' });
    }
});

/**
 * GET /api/admin/ads/stats/overview
 * 获取广告统计概览
 */
router.get('/ads/stats/overview', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const validDays = Math.min(Math.max(days, 1), 90);

        // 总体统计
        const totalStats = queryOne(`
            SELECT
                (SELECT COUNT(*) FROM ad_stats WHERE action = 'view' AND created_at >= datetime('now', '+8 hours', '-${validDays} days')) as total_views,
                (SELECT COUNT(*) FROM ad_stats WHERE action = 'click' AND created_at >= datetime('now', '+8 hours', '-${validDays} days')) as total_clicks,
                (SELECT COUNT(*) FROM ad_stats WHERE action = 'close' AND created_at >= datetime('now', '+8 hours', '-${validDays} days')) as total_closes
        `);

        // 各广告统计
        const adStats = query(`
            SELECT
                a.id,
                a.ad_type,
                a.name,
                COUNT(CASE WHEN s.action = 'view' THEN 1 END) as view_count,
                COUNT(CASE WHEN s.action = 'click' THEN 1 END) as click_count,
                COUNT(CASE WHEN s.action = 'close' THEN 1 END) as close_count
            FROM ads a
            LEFT JOIN ad_stats s ON a.id = s.ad_id AND s.created_at >= datetime('now', '+8 hours', '-${validDays} days')
            GROUP BY a.id
            ORDER BY view_count DESC
        `);

        // 按日期统计
        const dailyStats = query(`
            SELECT
                date(created_at) as date,
                COUNT(CASE WHEN action = 'view' THEN 1 END) as views,
                COUNT(CASE WHEN action = 'click' THEN 1 END) as clicks,
                COUNT(CASE WHEN action = 'close' THEN 1 END) as closes
            FROM ad_stats
            WHERE created_at >= datetime('now', '+8 hours', '-${validDays} days')
            GROUP BY date(created_at)
            ORDER BY date DESC
        `);

        res.json({
            success: true,
            data: {
                days: validDays,
                totalViews: totalStats?.total_views || 0,
                totalClicks: totalStats?.total_clicks || 0,
                totalCloses: totalStats?.total_closes || 0,
                clickRate: totalStats?.total_views > 0
                    ? Math.round((totalStats.total_clicks / totalStats.total_views) * 10000) / 100
                    : 0,
                adStats: adStats.map(s => ({
                    id: s.id,
                    adType: s.ad_type,
                    name: s.name,
                    viewCount: s.view_count || 0,
                    clickCount: s.click_count || 0,
                    closeCount: s.close_count || 0,
                    clickRate: s.view_count > 0
                        ? Math.round((s.click_count / s.view_count) * 10000) / 100
                        : 0
                })),
                dailyStats
            }
        });
    } catch (error) {
        console.error('获取广告统计概览错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

/**
 * GET /api/admin/ads/:id/stats
 * 获取单个广告统计详情
 */
router.get('/ads/:id/stats', (req, res) => {
    try {
        const adId = parseInt(req.params.id);
        const days = parseInt(req.query.days) || 7;
        const validDays = Math.min(Math.max(days, 1), 90);

        // 检查广告是否存在
        const ad = queryOne('SELECT id, name, ad_type FROM ads WHERE id = ?', [adId]);
        if (!ad) {
            return res.status(404).json({ error: '广告不存在' });
        }

        // 总体统计
        const totalStats = queryOne(`
            SELECT
                COUNT(CASE WHEN action = 'view' THEN 1 END) as view_count,
                COUNT(CASE WHEN action = 'click' THEN 1 END) as click_count,
                COUNT(CASE WHEN action = 'close' THEN 1 END) as close_count
            FROM ad_stats
            WHERE ad_id = ? AND created_at >= datetime('now', '+8 hours', '-${validDays} days')
        `, [adId]);

        // 按日期统计
        const dailyStats = query(`
            SELECT
                date(created_at) as date,
                COUNT(CASE WHEN action = 'view' THEN 1 END) as views,
                COUNT(CASE WHEN action = 'click' THEN 1 END) as clicks,
                COUNT(CASE WHEN action = 'close' THEN 1 END) as closes
            FROM ad_stats
            WHERE ad_id = ? AND created_at >= datetime('now', '+8 hours', '-${validDays} days')
            GROUP BY date(created_at)
            ORDER BY date DESC
        `, [adId]);

        // 按用户统计
        const userStats = query(`
            SELECT
                s.user_id,
                u.display_name,
                u.username,
                COUNT(CASE WHEN s.action = 'view' THEN 1 END) as view_count,
                COUNT(CASE WHEN s.action = 'click' THEN 1 END) as click_count,
                COUNT(CASE WHEN s.action = 'close' THEN 1 END) as close_count
            FROM ad_stats s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.ad_id = ? AND s.created_at >= datetime('now', '+8 hours', '-${validDays} days')
            GROUP BY s.user_id
            ORDER BY view_count DESC
            LIMIT 20
        `, [adId]);

        // 按设备统计
        const deviceStats = query(`
            SELECT
                device_type,
                COUNT(*) as count
            FROM ad_stats
            WHERE ad_id = ? AND created_at >= datetime('now', '+8 hours', '-${validDays} days')
            GROUP BY device_type
            ORDER BY count DESC
        `, [adId]);

        res.json({
            success: true,
            data: {
                ad: {
                    id: ad.id,
                    name: ad.name,
                    adType: ad.ad_type
                },
                days: validDays,
                viewCount: totalStats?.view_count || 0,
                clickCount: totalStats?.click_count || 0,
                closeCount: totalStats?.close_count || 0,
                clickRate: totalStats?.view_count > 0
                    ? Math.round((totalStats.click_count / totalStats.view_count) * 10000) / 100
                    : 0,
                dailyStats,
                userStats: userStats.map(u => ({
                    userId: u.user_id,
                    displayName: u.display_name || '未知用户',
                    username: u.username,
                    viewCount: u.view_count || 0,
                    clickCount: u.click_count || 0,
                    closeCount: u.close_count || 0
                })),
                deviceStats: deviceStats.map(d => ({
                    deviceType: d.device_type || '未知',
                    count: d.count
                }))
            }
        });
    } catch (error) {
        console.error('获取广告统计详情错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

module.exports = router;
