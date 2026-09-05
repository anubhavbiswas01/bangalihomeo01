const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isVercel = process.env.VERCEL === '1';
const BUNDLED_DB_PATH = path.join(__dirname, 'clinic.db');
const DB_PATH = isVercel ? path.join(os.tmpdir(), 'clinic.db') : BUNDLED_DB_PATH;
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;
let inTransaction = false;

// Save database to file
function save() {
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
        console.error('Failed to save DB to disk:', e);
    }
}

// Initialize database
async function init() {
    const SQL = await initSqlJs();

    // In Vercel, copy bundled DB to /tmp if not yet created
    if (isVercel && !fs.existsSync(DB_PATH) && fs.existsSync(BUNDLED_DB_PATH)) {
        try {
            fs.copyFileSync(BUNDLED_DB_PATH, DB_PATH);
        } catch (e) {
            console.error('Failed to copy bundled db to tmp:', e);
        }
    }

    // Load existing database or create a new one
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');

    // Run schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.run(schema);

    // Auto-migrate: ensure complaints column exists in prescriptions table
    try {
        db.run('ALTER TABLE prescriptions ADD COLUMN complaints TEXT');
    } catch (e) {
        // column already exists
    }

    save();

    return db;
}

// Helper: run a query that modifies data (INSERT, UPDATE, DELETE)
function run(sql, params = []) {
    db.run(sql, params);

    // Get last insert rowid
    const result = db.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid = result[0] ? result[0].values[0][0] : 0;

    // Only save to disk if not inside a transaction (transaction saves at the end)
    if (!inTransaction) {
        save();
    }

    return { lastInsertRowid };
}

// Helper: get all rows
function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// Helper: get one row
function get(sql, params = []) {
    const rows = all(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

// Helper: run multiple statements in a transaction
function transaction(fn) {
    inTransaction = true;
    db.run('BEGIN TRANSACTION');
    try {
        const result = fn();
        db.run('COMMIT');
        save();
        return result;
    } catch (err) {
        try { db.run('ROLLBACK'); } catch (_) { /* ignore if nothing to rollback */ }
        throw err;
    } finally {
        inTransaction = false;
    }
}

module.exports = { init, run, all, get, transaction };
