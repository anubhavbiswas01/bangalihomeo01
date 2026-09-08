const { createClient } = require('@libsql/client');

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://bengalihomeo-anubhavbiswas01.aws-ap-south-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg2MTExODYsImlkIjoiMDFhMDcxODgtMGYwMS03Y2VhLWFmNDctZjkwMDM4OWU2YWVmIiwia2lkIjoiTkcyX05Uci01MVExRHlNTHN5TXN5R1duclJDMHhsOGZJcnVxMU91bWtnTSIsInJpZCI6IjY1MTcwZTAzLTVkMDEtNGJjZC1hN2M3LTI2OWNiNWI1YWFkOCJ9.fRC1oEGr1rY06ktzEJDjAQnU_gLiVVUwTxtOGSIxNVgTlFPcW_u5fzd2m1_VA5gGCB6K7ZNwpEy81kPHFs2qAg';

let client = null;

async function init() {
    if (client) return client;

    client = createClient({
        url: TURSO_URL,
        authToken: TURSO_TOKEN
    });

    // Ensure schema exists in cloud database
    await client.execute(`
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
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS prescriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rx_id TEXT UNIQUE NOT NULL,
            patient_id INTEGER NOT NULL,
            complaints TEXT,
            diagnosis TEXT,
            notes TEXT,
            previous_visit_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
    `);

    try {
        await client.execute('ALTER TABLE prescriptions ADD COLUMN previous_visit_date TEXT');
    } catch (e) {
        // column already exists
    }

    await client.execute(`
        CREATE TABLE IF NOT EXISTS prescription_medicines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prescription_id INTEGER NOT NULL,
            medicine_name TEXT NOT NULL,
            dosage TEXT,
            frequency TEXT,
            duration TEXT,
            FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
        );
    `);

    return client;
}

async function run(sql, params = []) {
    if (!client) await init();
    const res = await client.execute({ sql, args: params });
    return {
        lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
        rowsAffected: res.rowsAffected
    };
}

async function all(sql, params = []) {
    if (!client) await init();
    const res = await client.execute({ sql, args: params });
    return res.rows;
}

async function get(sql, params = []) {
    const rows = await all(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

async function transaction(fn) {
    if (!client) await init();
    const tx = await client.transaction();
    try {
        const txWrapper = {
            run: async (sql, params = []) => {
                const res = await tx.execute({ sql, args: params });
                return {
                    lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
                    rowsAffected: res.rowsAffected
                };
            },
            all: async (sql, params = []) => {
                const res = await tx.execute({ sql, args: params });
                return res.rows;
            },
            get: async (sql, params = []) => {
                const res = await tx.execute({ sql, args: params });
                return res.rows.length > 0 ? res.rows[0] : null;
            }
        };
        const result = await fn(txWrapper);
        await tx.commit();
        return result;
    } catch (err) {
        try { await tx.rollback(); } catch (_) {}
        throw err;
    }
}

module.exports = { init, run, all, get, transaction };
