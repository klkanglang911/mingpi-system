/**
 * JWT 认证中间件
 */

const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-key';

/**
 * 认证中间件
 * 验证请求头中的 JWT token
 */
async function authMiddleware(req, res, next) {
    try {
        // 获取 token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未登录' });
        }

        const token = authHeader.substring(7);

        // 验证 token
        const decoded = jwt.verify(token, JWT_SECRET);

        // 查询用户是否存在
        const user = queryOne('SELECT id, username, display_name, is_admin, must_change_password FROM users WHERE id = ?', [decoded.userId]);

        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }

        // 将用户信息挂载到请求对象
        req.user = {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            isAdmin: user.is_admin === 1,
            mustChangePassword: user.must_change_password === 1
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: '登录已过期，请重新登录' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: '无效的登录凭证' });
        }
        console.error('认证错误:', error);
        return res.status(401).json({ error: '认证失败' });
    }
}

/**
 * 生成 JWT token
 * @param {object} user - 用户信息
 * @param {boolean} rememberMe - 是否长期登录
 * @returns {string} JWT token
 */
function generateToken(user, rememberMe = false) {
    const payload = {
        userId: user.id,
        username: user.username,
        isAdmin: user.is_admin === 1
    };

    // rememberMe: 30天, 否则: 24小时
    const expiresIn = rememberMe ? '30d' : '24h';

    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

module.exports = authMiddleware;
module.exports.generateToken = generateToken;
