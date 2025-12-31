/**
 * 访问日志工具
 * 记录用户访问和操作日志
 */

const { run } = require('../config/database');

/**
 * 操作类型常量
 */
const ActionTypes = {
    // 用户操作
    LOGIN: 'login',
    LOGOUT: 'logout',
    VIEW_CALENDAR: 'view_calendar',
    VIEW_MINGPI: 'view_mingpi',
    CHANGE_PASSWORD: 'change_password',

    // 管理员操作
    ADMIN_LOGIN: 'admin_login',
    ADMIN_CREATE_USER: 'admin_create_user',
    ADMIN_EDIT_USER: 'admin_edit_user',
    ADMIN_DELETE_USER: 'admin_delete_user',
    ADMIN_LOCK_USER: 'admin_lock_user',
    ADMIN_RESET_PASSWORD: 'admin_reset_password',
    ADMIN_CREATE_MINGPI: 'admin_create_mingpi',
    ADMIN_EDIT_MINGPI: 'admin_edit_mingpi',
    ADMIN_DELETE_MINGPI: 'admin_delete_mingpi',
    ADMIN_BATCH_IMPORT: 'admin_batch_import',
    ADMIN_BATCH_DELETE: 'admin_batch_delete'
};

/**
 * 记录访问日志
 * @param {Object} options - 日志选项
 * @param {number|null} options.userId - 用户ID
 * @param {string} options.action - 操作类型
 * @param {string} [options.page] - 页面路径
 * @param {string} [options.ipAddress] - IP地址
 * @param {string} [options.userAgent] - 浏览器信息
 * @param {Object} [options.extraData] - 额外数据
 */
function logAccess(options) {
    const { userId, action, page, ipAddress, userAgent, extraData } = options;

    try {
        run(
            `INSERT INTO access_logs (user_id, action, page, ip_address, user_agent, extra_data, created_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"))`,
            [
                userId || null,
                action,
                page || null,
                ipAddress || null,
                userAgent ? userAgent.substring(0, 500) : null,
                extraData ? JSON.stringify(extraData) : null
            ]
        );
    } catch (error) {
        console.error('记录访问日志错误:', error);
    }
}

/**
 * 从请求中提取日志信息并记录
 * @param {Object} req - Express请求对象
 * @param {string} action - 操作类型
 * @param {Object} [extraData] - 额外数据
 */
function logFromRequest(req, action, extraData = null) {
    const userId = req.user ? req.user.id : null;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const page = req.originalUrl || req.url;

    logAccess({
        userId,
        action,
        page,
        ipAddress,
        userAgent,
        extraData
    });
}

module.exports = {
    ActionTypes,
    logAccess,
    logFromRequest
};
