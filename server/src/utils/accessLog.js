/**
 * 访问日志工具
 * 记录用户访问和操作日志，包含IP地理位置
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

// IP 地理位置缓存（避免重复查询）
const locationCache = new Map();
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

/**
 * 获取IP的地理位置
 * 使用 ip-api.com 免费服务（每分钟45次请求限制）
 * @param {string} ip - IP地址
 * @returns {Promise<string>} 地理位置字符串
 */
async function getIpLocation(ip) {
    // 跳过本地IP
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return '本地网络';
    }

    // 处理 IPv6 映射的 IPv4 地址
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    // 检查缓存
    const cached = locationCache.get(ip);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.location;
    }

    try {
        // 使用 ip-api.com 查询（免费，无需API密钥）
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city&lang=zh-CN`, {
            timeout: 3000
        });

        if (!response.ok) {
            return '未知';
        }

        const data = await response.json();

        let location = '未知';
        if (data.status === 'success') {
            // 组合地理位置：国家 省份 城市
            const parts = [];
            if (data.country) parts.push(data.country);
            if (data.regionName && data.regionName !== data.country) parts.push(data.regionName);
            if (data.city && data.city !== data.regionName) parts.push(data.city);
            location = parts.join(' ') || '未知';
        }

        // 缓存结果
        if (locationCache.size >= CACHE_MAX_SIZE) {
            // 清理最旧的缓存项
            const firstKey = locationCache.keys().next().value;
            locationCache.delete(firstKey);
        }
        locationCache.set(ip, { location, timestamp: Date.now() });

        return location;
    } catch (error) {
        console.error('获取IP地理位置错误:', error.message);
        return '未知';
    }
}

/**
 * 记录访问日志
 * @param {Object} options - 日志选项
 * @param {number|null} options.userId - 用户ID
 * @param {string} options.action - 操作类型
 * @param {string} [options.page] - 页面路径
 * @param {string} [options.ipAddress] - IP地址
 * @param {string} [options.location] - 地理位置
 * @param {string} [options.userAgent] - 浏览器信息
 * @param {Object} [options.extraData] - 额外数据
 */
function logAccess(options) {
    const { userId, action, page, ipAddress, location, userAgent, extraData } = options;

    try {
        run(
            `INSERT INTO access_logs (user_id, action, page, ip_address, location, user_agent, extra_data, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"))`,
            [
                userId || null,
                action,
                page || null,
                ipAddress || null,
                location || null,
                userAgent ? userAgent.substring(0, 500) : null,
                extraData ? JSON.stringify(extraData) : null
            ]
        );
    } catch (error) {
        console.error('记录访问日志错误:', error);
    }
}

/**
 * 从请求中提取日志信息并记录（异步获取地理位置）
 * @param {Object} req - Express请求对象
 * @param {string} action - 操作类型
 * @param {Object} [extraData] - 额外数据
 */
async function logFromRequest(req, action, extraData = null) {
    const userId = req.user ? req.user.id : null;
    let ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const page = req.originalUrl || req.url;

    // 处理多个IP的情况（代理）
    if (ipAddress && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
    }

    // 异步获取地理位置，不阻塞主流程
    getIpLocation(ipAddress).then(location => {
        logAccess({
            userId,
            action,
            page,
            ipAddress,
            location,
            userAgent,
            extraData
        });
    }).catch(error => {
        // 即使地理位置查询失败，也要记录日志
        console.error('地理位置查询失败:', error);
        logAccess({
            userId,
            action,
            page,
            ipAddress,
            location: '未知',
            userAgent,
            extraData
        });
    });
}

module.exports = {
    ActionTypes,
    logAccess,
    logFromRequest,
    getIpLocation
};
