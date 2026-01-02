const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let db = null;

// 数据库文件路径
const getDbPath = () => {
    const dbPath = process.env.DATABASE_PATH || '../data/mingpi.db';
    return path.resolve(__dirname, '..', dbPath);
};

// 初始化数据库
async function initDatabase() {
    const SQL = await initSqlJs();
    const dbPath = getDbPath();

    // 确保数据目录存在
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    // 如果数据库文件存在则加载，否则创建新数据库
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        console.log('数据库已加载:', dbPath);
    } else {
        db = new SQL.Database();
        console.log('创建新数据库:', dbPath);
    }

    // 创建表结构
    createTables();

    // 创建默认管理员
    await createDefaultAdmin();

    // 保存数据库
    saveDatabase();

    return db;
}

// 生成随机路径
function generateRandomPath() {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // 排除易混淆字符
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 创建表结构
function createTables() {
    // 用户表
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            display_name VARCHAR(100) NOT NULL,
            is_admin INTEGER DEFAULT 0,
            is_locked INTEGER DEFAULT 0,
            must_change_password INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login_at DATETIME,
            login_fail_count INTEGER DEFAULT 0,
            login_locked_until DATETIME
        )
    `);

    // 为已存在的表添加 is_locked 字段（兼容旧数据）
    try {
        db.run(`ALTER TABLE users ADD COLUMN is_locked INTEGER DEFAULT 0`);
    } catch (e) {
        // 字段已存在，忽略错误
    }

    // 为已存在的表添加登录失败计数字段
    try {
        db.run(`ALTER TABLE users ADD COLUMN login_fail_count INTEGER DEFAULT 0`);
    } catch (e) {}
    try {
        db.run(`ALTER TABLE users ADD COLUMN login_locked_until DATETIME`);
    } catch (e) {}

    // 系统配置表
    db.run(`
        CREATE TABLE IF NOT EXISTS system_config (
            key VARCHAR(50) PRIMARY KEY,
            value TEXT NOT NULL,
            description VARCHAR(200),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 初始化默认配置
    initDefaultConfig();

    // 命批表
    db.run(`
        CREATE TABLE IF NOT EXISTS mingpi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            lunar_year INTEGER NOT NULL,
            lunar_month INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, lunar_year, lunar_month)
        )
    `);

    // 创建索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_mingpi_user_date ON mingpi(user_id, lunar_year, lunar_month)`);

    // 用户资料表（固定数据：八字、起运、命局分析）
    db.run(`
        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            year_pillar TEXT,
            month_pillar TEXT,
            day_pillar TEXT,
            hour_pillar TEXT,
            qiyun_age INTEGER,
            analysis TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_user_profile_user_id ON user_profile(user_id)`);

    // 年度运势表（每年更新：大运、流年、四季财官）
    db.run(`
        CREATE TABLE IF NOT EXISTS user_yearly_fortune (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            lunar_year INTEGER NOT NULL,
            dayun TEXT,
            liunian TEXT,
            spring_content TEXT,
            summer_content TEXT,
            autumn_content TEXT,
            winter_content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, lunar_year),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_user_yearly_fortune ON user_yearly_fortune(user_id, lunar_year)`);

    // 访问日志表
    db.run(`
        CREATE TABLE IF NOT EXISTS access_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action VARCHAR(50) NOT NULL,
            page VARCHAR(100),
            ip_address VARCHAR(50),
            location VARCHAR(100),
            device_type VARCHAR(20),
            os VARCHAR(50),
            browser VARCHAR(50),
            user_agent VARCHAR(500),
            extra_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 为已存在的表添加 location 字段（兼容旧数据）
    try {
        db.run(`ALTER TABLE access_logs ADD COLUMN location VARCHAR(100)`);
    } catch (e) {
        // 字段已存在，忽略错误
    }

    // 为已存在的表添加设备相关字段（兼容旧数据）
    try {
        db.run(`ALTER TABLE access_logs ADD COLUMN device_type VARCHAR(20)`);
    } catch (e) {}
    try {
        db.run(`ALTER TABLE access_logs ADD COLUMN os VARCHAR(50)`);
    } catch (e) {}
    try {
        db.run(`ALTER TABLE access_logs ADD COLUMN browser VARCHAR(50)`);
    } catch (e) {}

    // 访问日志索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_location ON access_logs(location)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_device ON access_logs(device_type)`);

    console.log('数据表初始化完成');
}

// 初始化默认配置
function initDefaultConfig() {
    const defaultConfigs = [
        { key: 'admin_path', value: generateRandomPath(), description: '后台管理路径' },
        { key: 'login_max_attempts', value: '5', description: '最大登录失败次数' },
        { key: 'login_lock_minutes', value: '15', description: '登录锁定时间(分钟)' },
        { key: 'yearly_opening_time', value: '', description: '年批开启时间(ISO格式)' },
        { key: 'yearly_opening_text', value: '小寒开启你的新一年命批', description: '年批开启提示文案' },
        { key: 'yearly_opening_subtext', value: '敬请期待 · 静候天时', description: '年批开启副文案' }
    ];

    defaultConfigs.forEach(config => {
        // 检查配置是否已存在
        const existing = db.exec(`SELECT key FROM system_config WHERE key = '${config.key}'`);
        if (existing.length === 0 || existing[0].values.length === 0) {
            db.run(`
                INSERT INTO system_config (key, value, description)
                VALUES ('${config.key}', '${config.value}', '${config.description}')
            `);
            console.log(`初始化配置: ${config.key} = ${config.value}`);
        }
    });
}

// 获取系统配置
function getConfig(key) {
    const result = db.exec(`SELECT value FROM system_config WHERE key = '${key}'`);
    if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0];
    }
    return null;
}

// 设置系统配置
function setConfig(key, value) {
    db.run(`
        UPDATE system_config
        SET value = ?, updated_at = datetime('now', '+8 hours')
        WHERE key = ?
    `, [value, key]);
    saveDatabase();
}

// 创建默认管理员
async function createDefaultAdmin() {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    // 检查管理员是否已存在
    const result = db.exec(`SELECT id FROM users WHERE username = '${adminUsername}'`);
    if (result.length > 0 && result[0].values.length > 0) {
        console.log('管理员账户已存在');
        return;
    }

    // 创建管理员
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    db.run(`
        INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password)
        VALUES ('${adminUsername}', '${passwordHash}', '管理员', 1, 1)
    `);

    console.log('默认管理员已创建:', adminUsername);
}

// 保存数据库到文件
function saveDatabase() {
    if (!db) return;

    const dbPath = getDbPath();
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

// 获取数据库实例
function getDb() {
    return db;
}

// 执行查询并返回结果
function query(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) {
            stmt.bind(params);
        }

        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('查询错误:', error.message);
        throw error;
    }
}

// 执行单条查询
function queryOne(sql, params = []) {
    const results = query(sql, params);
    return results.length > 0 ? results[0] : null;
}

// 执行写入操作
function run(sql, params = []) {
    try {
        if (params.length > 0) {
            const stmt = db.prepare(sql);
            stmt.bind(params);
            stmt.step();
            stmt.free();
        } else {
            db.run(sql);
        }
        saveDatabase();
        return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] };
    } catch (error) {
        console.error('执行错误:', error.message);
        throw error;
    }
}

module.exports = {
    initDatabase,
    getDb,
    query,
    queryOne,
    run,
    saveDatabase,
    getConfig,
    setConfig
};
