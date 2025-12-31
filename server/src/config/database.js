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
            last_login_at DATETIME
        )
    `);

    // 为已存在的表添加 is_locked 字段（兼容旧数据）
    try {
        db.run(`ALTER TABLE users ADD COLUMN is_locked INTEGER DEFAULT 0`);
    } catch (e) {
        // 字段已存在，忽略错误
    }

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

    // 访问日志表
    db.run(`
        CREATE TABLE IF NOT EXISTS access_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action VARCHAR(50) NOT NULL,
            page VARCHAR(100),
            ip_address VARCHAR(50),
            location VARCHAR(100),
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

    // 访问日志索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_access_logs_location ON access_logs(location)`);

    console.log('数据表初始化完成');
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
    saveDatabase
};
