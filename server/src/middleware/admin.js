/**
 * 管理员权限中间件
 * 必须在 auth 中间件之后使用
 */

function adminMiddleware(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: '未登录' });
    }

    if (!req.user.isAdmin) {
        return res.status(403).json({ error: '需要管理员权限' });
    }

    next();
}

module.exports = adminMiddleware;
