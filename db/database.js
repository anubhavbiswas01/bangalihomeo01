const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isVercel = process.env.VERCEL === '1';
const BUNDLED_DB_PATH = path.join(__dirname, 'clinic.db');
const DB_PATH = isVercel ? path.join(os.tmpdir(), 'clinic.db') : BUNDLED_DB_PATH;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    phone TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rx_id TEXT UNIQUE NOT NULL,
    patient_id INTEGER NOT NULL,
    complaints TEXT,
    diagnosis TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE TABLE IF NOT EXISTS prescription_medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prescription_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    dosage TEXT,
    frequency TEXT,
    duration TEXT,
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
);
`;

let db = null;
let inTransaction = false;

// Save database to file
function save() {
    try {
        if (!db) return;
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
        console.error('Failed to save DB to disk:', e);
    }
}

// Initialize database
async function init() {
    if (db) return db;

    let wasmBinary = null;
    try {
        const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
        if (fs.existsSync(wasmPath)) {
            wasmBinary = fs.readFileSync(wasmPath);
        }
    } catch (e) {
        console.warn('Could not load wasm via require.resolve:', e);
    }

    const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : {});

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
        try {
            const fileBuffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(fileBuffer);
        } catch (e) {
            console.error('Failed to read existing DB, creating fresh:', e);
            db = new SQL.Database();
        }
    } else {
        db = new SQL.Database();
    }

    // Enable foreign keys
    try { db.run('PRAGMA foreign_keys = ON'); } catch (_) {}

    // Run embedded schema
    db.run(SCHEMA_SQL);

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
