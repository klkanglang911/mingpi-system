/**
 * 访问日志工具
 * 记录用户访问和操作日志，包含IP地理位置和设备信息
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
 * 解析 User-Agent 获取设备信息
 * @param {string} ua - User-Agent 字符串
 * @returns {Object} 设备信息 { deviceType, os, browser }
 */
function parseUserAgent(ua) {
    if (!ua) {
        return { deviceType: '未知', os: '未知', browser: '未知' };
    }

    const uaLower = ua.toLowerCase();

    // 设备类型检测
    let deviceType = '桌面';
    if (/mobile|android.*mobile|iphone|ipod|blackberry|iemobile|opera mini|opera mobi/i.test(ua)) {
        deviceType = '手机';
    } else if (/tablet|ipad|android(?!.*mobile)|kindle|silk/i.test(ua)) {
        deviceType = '平板';
    } else if (/bot|spider|crawl|scrape/i.test(ua)) {
        deviceType = '爬虫';
    }

    // 操作系统检测
    let os = '未知';
    if (/windows nt 10/i.test(ua)) {
        os = 'Windows 10/11';
    } else if (/windows nt 6\.3/i.test(ua)) {
        os = 'Windows 8.1';
    } else if (/windows nt 6\.2/i.test(ua)) {
        os = 'Windows 8';
    } else if (/windows nt 6\.1/i.test(ua)) {
        os = 'Windows 7';
    } else if (/windows/i.test(ua)) {
        os = 'Windows';
    } else if (/mac os x/i.test(ua)) {
        if (/iphone|ipad|ipod/i.test(ua)) {
            const match = ua.match(/os (\d+)[_\.]/i);
            os = match ? `iOS ${match[1]}` : 'iOS';
        } else {
            const match = ua.match(/mac os x (\d+)[_\.](\d+)/i);
            os = match ? `macOS ${match[1]}.${match[2]}` : 'macOS';
        }
    } else if (/android/i.test(ua)) {
        const match = ua.match(/android (\d+(\.\d+)?)/i);
        os = match ? `Android ${match[1]}` : 'Android';
    } else if (/linux/i.test(ua)) {
        os = 'Linux';
    } else if (/ubuntu/i.test(ua)) {
        os = 'Ubuntu';
    } else if (/chrome os/i.test(ua)) {
        os = 'Chrome OS';
    }

    // 浏览器检测（顺序很重要，需要先检测特殊浏览器）
    let browser = '未知';
    if (/edg\//i.test(ua)) {
        const match = ua.match(/edg\/(\d+)/i);
        browser = match ? `Edge ${match[1]}` : 'Edge';
    } else if (/opr\/|opera/i.test(ua)) {
        const match = ua.match(/(?:opr|opera)\/(\d+)/i);
        browser = match ? `Opera ${match[1]}` : 'Opera';
    } else if (/firefox/i.test(ua)) {
        const match = ua.match(/firefox\/(\d+)/i);
        browser = match ? `Firefox ${match[1]}` : 'Firefox';
    } else if (/chrome/i.test(ua) && !/chromium/i.test(ua)) {
        const match = ua.match(/chrome\/(\d+)/i);
        browser = match ? `Chrome ${match[1]}` : 'Chrome';
    } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
        const match = ua.match(/version\/(\d+)/i);
        browser = match ? `Safari ${match[1]}` : 'Safari';
    } else if (/msie|trident/i.test(ua)) {
        const match = ua.match(/(?:msie |rv:)(\d+)/i);
        browser = match ? `IE ${match[1]}` : 'IE';
    } else if (/micromessenger/i.test(ua)) {
        browser = '微信';
    } else if (/qq\//i.test(ua)) {
        browser = 'QQ';
    } else if (/weibo/i.test(ua)) {
        browser = '微博';
    } else if (/alipayclient/i.test(ua)) {
        browser = '支付宝';
    }

    return { deviceType, os, browser };
}

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
 */
function logAccess(options) {
    const { userId, action, page, ipAddress, location, deviceType, os, browser, userAgent, extraData } = options;

    try {
        run(
            `INSERT INTO access_logs (user_id, action, page, ip_address, location, device_type, os, browser, user_agent, extra_data, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now", "+8 hours"))`,
            [
                userId || null,
                action,
                page || null,
                ipAddress || null,
                location || null,
                deviceType || null,
                os || null,
                browser || null,
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

    // 优先使用代理头部获取真实客户端 IP
    // X-Forwarded-For 格式: "client, proxy1, proxy2"，取第一个
    // X-Real-IP 是 Nginx 常用的头部
    let ipAddress = req.headers['x-forwarded-for'] ||
                    req.headers['x-real-ip'] ||
                    req.ip ||
                    req.connection?.remoteAddress;

    const userAgent = req.headers['user-agent'];
    const page = req.originalUrl || req.url;

    // 处理多个IP的情况（代理链）
    if (ipAddress && ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
    }

    // 解析设备信息
    const { deviceType, os, browser } = parseUserAgent(userAgent);

    // 异步获取地理位置，不阻塞主流程
    getIpLocation(ipAddress).then(location => {
        logAccess({
            userId,
            action,
            page,
            ipAddress,
            location,
            deviceType,
            os,
            browser,
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
            deviceType,
            os,
            browser,
            userAgent,
            extraData
        });
    });
}

module.exports = {
    ActionTypes,
    logAccess,
    logFromRequest,
    getIpLocation,
    parseUserAgent
};
