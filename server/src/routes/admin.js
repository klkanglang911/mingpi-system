/**
 * 管理员路由
 * 处理用户管理和命批管理
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, run } = require('../config/database');
const { generatePassword, hashPassword } = require('../utils/password');
const { logFromRequest, ActionTypes } = require('../utils/accessLog');

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

module.exports = router;
