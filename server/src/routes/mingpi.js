/**
 * 命批路由
 * 处理用户获取命批内容
 */

const express = require('express');
const router = express.Router();
const { queryOne } = require('../config/database');
const { getCurrentJieQiYearMonth, getJieQiMonthName } = require('../utils/lunar');

// 默认命批内容
const defaultTips = [
    '岁月如流，时光荏苒，愿你珍惜当下每一天。',
    '春有百花秋有月，夏有凉风冬有雪。若无闲事挂心头，便是人间好时节。',
    '天行健，君子以自强不息；地势坤，君子以厚德载物。',
    '行到水穷处，坐看云起时。',
    '人生若只如初见，何事秋风悲画扇。',
    '山不在高，有仙则名；水不在深，有龙则灵。',
    '采菊东篱下，悠然见南山。',
    '宠辱不惊，看庭前花开花落；去留无意，望天上云卷云舒。'
];

/**
 * GET /api/mingpi/current
 * 获取当前节气月的命批
 */
router.get('/current', (req, res) => {
    try {
        const jieQi = getCurrentJieQiYearMonth();

        // 查询当前用户当前节气月的命批
        const mingpi = queryOne(
            'SELECT content FROM mingpi WHERE user_id = ? AND lunar_year = ? AND lunar_month = ?',
            [req.user.id, jieQi.year, jieQi.month]
        );

        if (mingpi) {
            res.json({
                success: true,
                data: {
                    lunarYear: jieQi.year,
                    lunarMonth: jieQi.month,
                    lunarMonthName: jieQi.monthName,
                    yearGanZhi: jieQi.yearGanZhi,
                    content: mingpi.content,
                    isDefault: false
                }
            });
        } else {
            // 返回默认内容
            const randomTip = defaultTips[Math.floor(Math.random() * defaultTips.length)];
            res.json({
                success: true,
                data: {
                    lunarYear: jieQi.year,
                    lunarMonth: jieQi.month,
                    lunarMonthName: jieQi.monthName,
                    yearGanZhi: jieQi.yearGanZhi,
                    content: randomTip,
                    isDefault: true
                }
            });
        }
    } catch (error) {
        console.error('获取命批错误:', error);
        res.status(500).json({ error: '获取命批失败' });
    }
});

/**
 * GET /api/mingpi/profile
 * 获取当前用户的资料（八字、起运、命局分析）
 */
router.get('/profile', (req, res) => {
    try {
        const profile = queryOne(
            'SELECT * FROM user_profile WHERE user_id = ?',
            [req.user.id]
        );

        if (profile) {
            res.json({
                success: true,
                data: {
                    yearPillar: profile.year_pillar,
                    monthPillar: profile.month_pillar,
                    dayPillar: profile.day_pillar,
                    hourPillar: profile.hour_pillar,
                    qiyunAge: profile.qiyun_age,
                    analysis: profile.analysis
                }
            });
        } else {
            res.json({
                success: true,
                data: null
            });
        }
    } catch (error) {
        console.error('获取用户资料错误:', error);
        res.status(500).json({ error: '获取用户资料失败' });
    }
});

/**
 * GET /api/mingpi/yearly-fortune
 * 获取当前用户当前年份的运势
 */
router.get('/yearly-fortune', (req, res) => {
    try {
        const lunar = getCurrentLunarYearMonth();

        const fortune = queryOne(
            'SELECT * FROM user_yearly_fortune WHERE user_id = ? AND lunar_year = ?',
            [req.user.id, lunar.year]
        );

        if (fortune) {
            res.json({
                success: true,
                data: {
                    lunarYear: fortune.lunar_year,
                    dayun: fortune.dayun,
                    liunian: fortune.liunian,
                    springContent: fortune.spring_content,
                    summerContent: fortune.summer_content,
                    autumnContent: fortune.autumn_content,
                    winterContent: fortune.winter_content
                }
            });
        } else {
            res.json({
                success: true,
                data: null
            });
        }
    } catch (error) {
        console.error('获取年度运势错误:', error);
        res.status(500).json({ error: '获取年度运势失败' });
    }
});

/**
 * GET /api/mingpi/yearly-fortune/:year
 * 获取当前用户指定年份的运势（大运、流年、四季财官）
 */
router.get('/yearly-fortune/:year', (req, res) => {
    try {
        const year = parseInt(req.params.year);

        if (isNaN(year) || year < 1900 || year > 2100) {
            return res.status(400).json({ error: '无效的年份参数' });
        }

        const fortune = queryOne(
            'SELECT * FROM user_yearly_fortune WHERE user_id = ? AND lunar_year = ?',
            [req.user.id, year]
        );

        if (fortune) {
            res.json({
                success: true,
                data: {
                    lunarYear: fortune.lunar_year,
                    dayun: fortune.dayun,
                    liunian: fortune.liunian,
                    springContent: fortune.spring_content,
                    summerContent: fortune.summer_content,
                    autumnContent: fortune.autumn_content,
                    winterContent: fortune.winter_content
                }
            });
        } else {
            res.json({
                success: true,
                data: null
            });
        }
    } catch (error) {
        console.error('获取年度运势错误:', error);
        res.status(500).json({ error: '获取年度运势失败' });
    }
});


/**
 * GET /api/mingpi/ads
 * 获取当前有效的广告
 */
router.get('/ads', (req, res) => {
    try {
        const { query } = require('../config/database');
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // 查询启用的、在有效期内的广告
        const ads = query(`
            SELECT id, ad_type, name, image_url, link_url, display_frequency, countdown_seconds
            FROM ads
            WHERE is_enabled = 1
            AND (start_time IS NULL OR start_time <= ?)
            AND (end_time IS NULL OR end_time >= ?)
            ORDER BY sort_order ASC, id DESC
        `, [now, now]);

        res.json({
            success: true,
            data: ads.map(ad => ({
                id: ad.id,
                adType: ad.ad_type,
                name: ad.name,
                imageUrl: ad.image_url,
                linkUrl: ad.link_url,
                displayFrequency: ad.display_frequency,
                countdownSeconds: ad.countdown_seconds
            }))
        });
    } catch (error) {
        console.error('获取广告错误:', error);
        res.status(500).json({ error: '获取广告失败' });
    }
});

/**
 * POST /api/mingpi/ads/:id/stat
 * 记录广告统计（展示/点击/关闭）
 */
router.post('/ads/:id/stat', (req, res) => {
    try {
        const { run, queryOne } = require('../config/database');
        const adId = parseInt(req.params.id);
        const { action } = req.body;

        // 验证action
        if (!['view', 'click', 'close'].includes(action)) {
            return res.status(400).json({ error: '无效的操作类型' });
        }

        // 验证广告存在
        const ad = queryOne('SELECT id FROM ads WHERE id = ?', [adId]);
        if (!ad) {
            return res.status(404).json({ error: '广告不存在' });
        }

        // 获取客户端信息
        const ip = req.headers['x-forwarded-for'] || req.ip || '';
        const ua = req.headers['user-agent'] || '';
        let deviceType = 'unknown';
        if (/Mobile|Android|iPhone/i.test(ua)) deviceType = 'mobile';
        else if (/Tablet|iPad/i.test(ua)) deviceType = 'tablet';
        else deviceType = 'desktop';

        // 记录统计
        run(`
            INSERT INTO ad_stats (ad_id, user_id, action, ip_address, device_type, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'))
        `, [adId, req.user.id, action, ip.split(',')[0].trim(), deviceType]);

        res.json({ success: true });
    } catch (error) {
        console.error('记录广告统计错误:', error);
        res.status(500).json({ error: '记录统计失败' });
    }
});

/**
 * GET /api/mingpi/:year/:month
 * 获取指定节气年月的命批
 * 注意：此路由必须放在最后，因为它会匹配所有两段路径
 */
router.get('/:year/:month', (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        // 参数验证
        if (isNaN(year) || isNaN(month) || year < 1900 || year > 2100 || month < 1 || month > 12) {
            return res.status(400).json({ error: '无效的年月参数' });
        }

        const monthName = getJieQiMonthName(month);

        // 查询命批
        const mingpi = queryOne(
            'SELECT content FROM mingpi WHERE user_id = ? AND lunar_year = ? AND lunar_month = ?',
            [req.user.id, year, month]
        );

        if (mingpi) {
            res.json({
                success: true,
                data: {
                    lunarYear: year,
                    lunarMonth: month,
                    lunarMonthName: monthName,
                    content: mingpi.content,
                    isDefault: false
                }
            });
        } else {
            // 返回默认内容
            const randomTip = defaultTips[Math.floor(Math.random() * defaultTips.length)];
            res.json({
                success: true,
                data: {
                    lunarYear: year,
                    lunarMonth: month,
                    lunarMonthName: monthName,
                    content: randomTip,
                    isDefault: true
                }
            });
        }
    } catch (error) {
        console.error('获取命批错误:', error);
        res.status(500).json({ error: '获取命批失败' });
    }
});

module.exports = router;
