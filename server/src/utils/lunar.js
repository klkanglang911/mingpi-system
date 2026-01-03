/**
 * 农历计算工具模块
 * 支持1900-2100年农历计算
 */

// 农历数据表
const lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520
];

const Gan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const Zhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const Animals = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
const lunarMonths = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const lunarDays = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

// 节气月名称（地支名 + 传统名）
const jieQiMonthNames = [
    '寅月（正月）', '卯月（二月）', '辰月（三月）', '巳月（四月）',
    '午月（五月）', '未月（六月）', '申月（七月）', '酉月（八月）',
    '戌月（九月）', '亥月（十月）', '子月（冬月）', '丑月（腊月）'
];

// 节气月短名（仅地支）
const jieQiMonthShortNames = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'];

// 节气月对应的起始节气（"节"）
const jieQiStartTerms = ['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒'];

// 计算农历年总天数
function lYearDays(y) {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) {
        sum += (lunarInfo[y - 1900] & i) ? 1 : 0;
    }
    return sum + leapDays(y);
}

// 获取闰月月份 (0表示无闰月)
function leapMonth(y) {
    return lunarInfo[y - 1900] & 0xf;
}

// 获取闰月天数
function leapDays(y) {
    if (leapMonth(y)) {
        return (lunarInfo[y - 1900] & 0x10000) ? 30 : 29;
    }
    return 0;
}

// 获取某月天数
function monthDays(y, m) {
    return (lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29;
}

/**
 * 阳历转农历
 * @param {number} y - 阳历年
 * @param {number} m - 阳历月
 * @param {number} d - 阳历日
 * @returns {object} 农历信息对象
 */
function solarToLunar(y, m, d) {
    if (y < 1900 || y > 2100) return null;

    let offset = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);

    let year = 1900;
    let temp = 0;
    for (; year < 2101 && offset > 0; year++) {
        temp = lYearDays(year);
        offset -= temp;
    }
    if (offset < 0) {
        offset += temp;
        year--;
    }

    let isLeap = false;
    let leap = leapMonth(year);
    let month = 1;
    for (; month < 13 && offset > 0; month++) {
        if (leap > 0 && month === (leap + 1) && !isLeap) {
            --month;
            isLeap = true;
            temp = leapDays(year);
        } else {
            temp = monthDays(year, month);
        }
        if (isLeap && month === (leap + 1)) isLeap = false;
        offset -= temp;
    }
    if (offset === 0 && leap > 0 && month === leap + 1) {
        if (isLeap) {
            isLeap = false;
        } else {
            isLeap = true;
            --month;
        }
    }
    if (offset < 0) {
        offset += temp;
        --month;
    }

    const day = offset + 1;

    return {
        year,
        month,
        day,
        isLeap,
        monthDays: temp,
        yearGan: Gan[(year - 4) % 10],
        yearZhi: Zhi[(year - 4) % 12],
        animal: Animals[(year - 4) % 12],
        monthName: lunarMonths[month - 1] + '月',
        dayName: lunarDays[day - 1]
    };
}

/**
 * 获取农历月份的阳历日期范围
 * @param {number} lunarYear - 农历年
 * @param {number} lunarMonth - 农历月 (1-12)
 * @returns {object} 包含起止日期和天数
 */
function getLunarMonthSolarRange(lunarYear, lunarMonth) {
    if (lunarYear < 1900 || lunarYear > 2100 || lunarMonth < 1 || lunarMonth > 12) {
        return null;
    }

    let daysFromBase = 0;

    for (let y = 1900; y < lunarYear; y++) {
        daysFromBase += lYearDays(y);
    }

    const leap = leapMonth(lunarYear);
    for (let m = 1; m < lunarMonth; m++) {
        daysFromBase += monthDays(lunarYear, m);
        if (leap > 0 && m === leap) {
            daysFromBase += leapDays(lunarYear);
        }
    }

    const baseTime = Date.UTC(1900, 0, 31);
    const startTime = baseTime + daysFromBase * 86400000;
    const startDate = new Date(startTime);

    const days = monthDays(lunarYear, lunarMonth);
    const endTime = startTime + (days - 1) * 86400000;
    const endDate = new Date(endTime);

    return {
        start: {
            year: startDate.getUTCFullYear(),
            month: startDate.getUTCMonth() + 1,
            day: startDate.getUTCDate()
        },
        end: {
            year: endDate.getUTCFullYear(),
            month: endDate.getUTCMonth() + 1,
            day: endDate.getUTCDate()
        },
        days: days
    };
}

/**
 * 获取当前农历年月
 * @returns {object} 当前农历年月信息
 */
function getCurrentLunarYearMonth() {
    const now = new Date();
    const lunar = solarToLunar(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return {
        year: lunar.year,
        month: lunar.month,
        monthName: lunarMonths[lunar.month - 1] + '月',
        yearGanZhi: lunar.yearGan + lunar.yearZhi,
        animal: lunar.animal
    };
}

/**
 * 获取农历月份名称
 * @param {number} month - 农历月份 (1-12)
 * @returns {string} 月份名称
 */
function getLunarMonthName(month) {
    if (month < 1 || month > 12) return '';
    return lunarMonths[month - 1] + '月';
}

/**
 * 获取节气月名称
 * @param {number} month - 节气月份 (1-12, 1=寅月/正月)
 * @returns {string} 节气月名称
 */
function getJieQiMonthName(month) {
    if (month < 1 || month > 12) return '';
    return jieQiMonthNames[month - 1];
}

/**
 * 获取节气月短名
 * @param {number} month - 节气月份 (1-12)
 * @returns {string} 节气月短名（仅地支）
 */
function getJieQiMonthShortName(month) {
    if (month < 1 || month > 12) return '';
    return jieQiMonthShortNames[month - 1] + '月';
}

/**
 * 获取当前节气年月
 * 节气年以立春为界，节气月以"节"为界
 * @returns {object} 当前节气年月信息
 */
function getCurrentJieQiYearMonth() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();

    // 使用农历计算获取月干支
    // 这里简化处理：根据公历日期估算节气月
    // 实际项目中应使用 lunar-javascript 库进行精确计算

    // 节气月大约对应的公历月份：
    // 寅月(1)：2月4日左右 - 3月5日左右
    // 卯月(2)：3月6日左右 - 4月4日左右
    // ...以此类推

    // 简化的节气月估算（精确计算应使用 lunar-javascript）
    const jieQiMonthMap = [
        { month: 12, startDay: 6 },  // 丑月：1月6日左右开始
        { month: 1, startDay: 4 },   // 寅月：2月4日左右开始
        { month: 2, startDay: 6 },   // 卯月：3月6日左右开始
        { month: 3, startDay: 5 },   // 辰月：4月5日左右开始
        { month: 4, startDay: 6 },   // 巳月：5月6日左右开始
        { month: 5, startDay: 6 },   // 午月：6月6日左右开始
        { month: 6, startDay: 7 },   // 未月：7月7日左右开始
        { month: 7, startDay: 8 },   // 申月：8月8日左右开始
        { month: 8, startDay: 8 },   // 酉月：9月8日左右开始
        { month: 9, startDay: 8 },   // 戌月：10月8日左右开始
        { month: 10, startDay: 7 },  // 亥月：11月7日左右开始
        { month: 11, startDay: 7 }   // 子月：12月7日左右开始
    ];

    // 确定当前节气月
    let jieQiMonth = 1;
    for (let i = 0; i < 12; i++) {
        const nextIdx = (i + 1) % 12;
        const curr = jieQiMonthMap[i];
        const next = jieQiMonthMap[nextIdx];

        const currMonth = curr.month === 12 ? 1 : curr.month + 1;
        const nextMonth = next.month === 12 ? 1 : next.month + 1;

        // 检查当前日期是否在这个节气月范围内
        if (currMonth === m) {
            if (d >= curr.startDay) {
                jieQiMonth = i === 0 ? 12 : i;
                break;
            } else {
                jieQiMonth = i === 0 ? 11 : i - 1;
                if (jieQiMonth === 0) jieQiMonth = 12;
                break;
            }
        }
    }

    // 确定节气年（以立春为界）
    let jieQiYear = y;
    // 立春之前属于上一年
    if (m === 1 || (m === 2 && d < 4)) {
        jieQiYear = y - 1;
    }

    return {
        year: jieQiYear,
        month: jieQiMonth,
        monthName: jieQiMonthNames[jieQiMonth - 1],
        shortName: jieQiMonthShortNames[jieQiMonth - 1] + '月',
        yearGanZhi: Gan[(jieQiYear - 4) % 10] + Zhi[(jieQiYear - 4) % 12]
    };
}

module.exports = {
    solarToLunar,
    getLunarMonthSolarRange,
    getCurrentLunarYearMonth,
    getLunarMonthName,
    getJieQiMonthName,
    getJieQiMonthShortName,
    getCurrentJieQiYearMonth,
    lunarMonths,
    jieQiMonthNames,
    jieQiMonthShortNames,
    jieQiStartTerms,
    Gan,
    Zhi,
    Animals
};
