/**
 * 密码工具模块
 */

const bcrypt = require('bcryptjs');

// 可用字符集
const CHARS = {
    lowercase: 'abcdefghijkmnpqrstuvwxyz', // 去除易混淆的 l, o
    uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // 去除易混淆的 I, O
    numbers: '23456789' // 去除易混淆的 0, 1
};

/**
 * 生成随机密码
 * @param {number} length - 密码长度 (默认8位)
 * @returns {string} 随机密码
 */
function generatePassword(length = 8) {
    const allChars = CHARS.lowercase + CHARS.uppercase + CHARS.numbers;
    let password = '';

    // 确保至少包含一个小写、大写、数字
    password += CHARS.lowercase[Math.floor(Math.random() * CHARS.lowercase.length)];
    password += CHARS.uppercase[Math.floor(Math.random() * CHARS.uppercase.length)];
    password += CHARS.numbers[Math.floor(Math.random() * CHARS.numbers.length)];

    // 填充剩余字符
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // 打乱顺序
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * 哈希密码
 * @param {string} password - 明文密码
 * @returns {Promise<string>} 哈希后的密码
 */
async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} hash - 哈希密码
 * @returns {Promise<boolean>} 是否匹配
 */
async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * 验证密码强度
 * @param {string} password - 密码
 * @returns {object} 包含 valid 和 message
 */
function validatePasswordStrength(password) {
    if (!password || password.length < 6) {
        return { valid: false, message: '密码长度至少6位' };
    }
    if (password.length > 50) {
        return { valid: false, message: '密码长度不能超过50位' };
    }
    return { valid: true, message: '' };
}

module.exports = {
    generatePassword,
    hashPassword,
    verifyPassword,
    validatePasswordStrength
};
