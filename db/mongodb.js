// ============================================================
// MONGODB DATABASE ADAPTER FOR CLINIC SYSTEM
// High-performance, low-latency document storage
// ============================================================

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

let cachedClient = null;
let cachedDb = null;

function getMongoUri() {
    if (process.env.MONGODB_URI && process.env.MONGODB_URI.trim()) {
        return process.env.MONGODB_URI.trim();
    }
    try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/MONGODB_URI=["']?(mongodb(\+srv)?:\/\/[^"'\r\n]+)["']?/);
            if (match) return match[1].trim();
        }
    } catch (_) {}
    return '';
}

function isConfigured() {
    const uri = getMongoUri();
    return Boolean(uri && uri.startsWith('mongodb') && !uri.includes('<db_password>'));
}

async function connect() {
    if (cachedDb) return cachedDb;

    const uri = getMongoUri();
    if (!uri || uri.includes('<db_password>')) {
        throw new Error('MONGODB_URI is not configured or still contains <db_password>');
    }

    if (!cachedClient) {
        cachedClient = new MongoClient(uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000
        });
        await cachedClient.connect();
    }

    // Default db name from URI or fallback to 'clinic'
    cachedDb = cachedClient.db(process.env.MONGODB_DB_NAME || 'clinic');
    await initIndexes(cachedDb);
    return cachedDb;
}

let indexesInitialized = false;
async function initIndexes(db) {
    if (indexesInitialized) return;
    try {
        const patients = db.collection('patients');
        const prescriptions = db.collection('prescriptions');

        await patients.createIndex({ patient_id: 1 }, { unique: true });
        await patients.createIndex({ id: 1 });
        await patients.createIndex({ name: 1 });
        await patients.createIndex({ phone: 1 });
        await patients.createIndex({ address: 1 });
        await patients.createIndex({ created_at: -1 });

        await prescriptions.createIndex({ rx_id: 1 }, { unique: true });
        await prescriptions.createIndex({ patient_id: 1 });
        await prescriptions.createIndex({ created_at: -1 });

        indexesInitialized = true;
    } catch (e) {
        console.warn('MongoDB index initialization warning:', e.message);
    }
}

// ── Next ID Counters ──
async function getNextPatientId() {
    const db = await connect();
    const last = await db.collection('patients')
        .find({})
        .sort({ id: -1 })
        .limit(1)
        .project({ id: 1, patient_id: 1 })
        .toArray();

    let nextNum = 1;
    if (last.length > 0) {
        if (last[0].id) {
            nextNum = Number(last[0].id) + 1;
        } else if (last[0].patient_id) {
            const m = String(last[0].patient_id).match(/\d+/);
            if (m) nextNum = parseInt(m[0], 10) + 1;
        }
    }
    return {
        numericId: nextNum,
        code: 'PAT-' + String(nextNum).padStart(5, '0')
    };
}

async function getNextRxId() {
    const db = await connect();
    const last = await db.collection('prescriptions')
        .find({})
        .sort({ id: -1 })
        .limit(1)
        .project({ id: 1, rx_id: 1 })
        .toArray();

    let nextNum = 1;
    if (last.length > 0) {
        if (last[0].id) {
            nextNum = Number(last[0].id) + 1;
        } else if (last[0].rx_id) {
            const m = String(last[0].rx_id).match(/\d+/);
            if (m) nextNum = parseInt(m[0], 10) + 1;
        }
    }
    return {
        numericId: nextNum,
        code: 'RX-' + String(nextNum).padStart(5, '0')
    };
}

// ── Patient Operations ──

async function getAllPatients(showAll = false) {
    const db = await connect();
    const query = db.collection('patients').find({}).sort({ id: -1 });
    if (!showAll) {
        query.limit(25);
    }
    const patients = await query.toArray();
    return patients.map(p => {
        delete p._id;
        return p;
    });
}

async function searchPatients(q = '', showAll = false) {
    const db = await connect();
    const cleanQ = (q || '').trim();
    if (!cleanQ) {
        return getAllPatients(showAll);
    }

    const regex = new RegExp(cleanQ, 'i');
    const query = db.collection('patients').find({
        $or: [
            { patient_id: regex },
            { name: regex },
            { phone: regex },
            { address: regex }
        ]
    }).sort({ id: -1 });

    if (!showAll) {
        query.limit(50);
    }
    const results = await query.toArray();
    return results.map(p => {
        delete p._id;
        return p;
    });
}

async function getPatientById(id) {
    const db = await connect();
    const strId = String(id);
    const numId = Number(id);

    const filter = {
        $or: [
            { patient_id: strId },
            ...(isNaN(numId) ? [] : [{ id: numId }])
        ]
    };

    const patient = await db.collection('patients').findOne(filter);
    if (!patient) return null;
    delete patient._id;

    // Fetch all prescriptions for this patient in a single blazing fast query
    const patientCode = patient.patient_id;
    const patientNumId = patient.id;
    const rxFilter = {
        $or: [
            { patient_id: patientCode },
            ...(patientNumId ? [{ patient_id: String(patientNumId) }] : [])
        ]
    };

    const prescriptions = await db.collection('prescriptions')
        .find(rxFilter)
        .sort({ created_at: -1 })
        .toArray();

    patient.prescriptions = prescriptions.map(r => {
        delete r._id;
        return r;
    });

    return patient;
}

async function createPatient(data) {
    const db = await connect();
    const ids = await getNextPatientId();
    const nowIso = new Date().toISOString();

    const newPatient = {
        id: ids.numericId,
        patient_id: ids.code,
        name: data.name,
        age: data.age !== null && data.age !== undefined && data.age !== '' ? Number(data.age) : null,
        gender: data.gender || '',
        phone: data.phone || '',
        address: data.address || '',
        created_at: nowIso,
        last_visit_date: nowIso
    };

    await db.collection('patients').insertOne({ ...newPatient });
    delete newPatient._id;
    return newPatient;
}

async function updatePatient(id, data) {
    const db = await connect();
    const strId = String(id);
    const numId = Number(id);

    const filter = {
        $or: [
            { patient_id: strId },
            ...(isNaN(numId) ? [] : [{ id: numId }])
        ]
    };

    const updateFields = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.age !== undefined) updateFields.age = data.age ? Number(data.age) : null;
    if (data.gender !== undefined) updateFields.gender = data.gender;
    if (data.phone !== undefined) updateFields.phone = data.phone;
    if (data.address !== undefined) updateFields.address = data.address;
    if (data.last_visit_date !== undefined) updateFields.last_visit_date = data.last_visit_date;

    await db.collection('patients').updateOne(filter, { $set: updateFields });
    return getPatientById(id);
}

async function deletePatient(id) {
    const db = await connect();
    const strId = String(id);
    const numId = Number(id);

    const filter = {
        $or: [
            { patient_id: strId },
            ...(isNaN(numId) ? [] : [{ id: numId }])
        ]
    };

    const pt = await db.collection('patients').findOne(filter);
    if (!pt) return false;

    await db.collection('patients').deleteOne(filter);
    // Also remove associated prescriptions
    await db.collection('prescriptions').deleteMany({
        $or: [
            { patient_id: pt.patient_id },
            { patient_id: String(pt.id) }
        ]
    });
    return true;
}

// ── Prescription Operations ──

async function createPrescription(data) {
    const db = await connect();
    const ids = await getNextRxId();
    const nowIso = new Date().toISOString();

    // Find previous visit date
    let prevVisitDate = data.previous_visit_date || null;
    if (!prevVisitDate) {
        const lastRx = await db.collection('prescriptions')
            .find({ patient_id: String(data.patient_id) })
            .sort({ created_at: -1 })
            .limit(1)
            .toArray();

        if (lastRx.length > 0 && lastRx[0].created_at) {
            prevVisitDate = lastRx[0].created_at;
        }
    }

    const newRx = {
        id: ids.numericId,
        rx_id: ids.code,
        patient_id: String(data.patient_id),
        complaints: data.complaints || '',
        diagnosis: data.diagnosis || '',
        notes: data.notes || '',
        previous_visit_date: prevVisitDate,
        medicines: Array.isArray(data.medicines) ? data.medicines : [],
        created_at: nowIso
    };

    await db.collection('prescriptions').insertOne({ ...newRx });

    // Update patient's last_visit_date
    await db.collection('patients').updateOne(
        {
            $or: [
                { patient_id: String(data.patient_id) },
                { id: Number(data.patient_id) }
            ]
        },
        { $set: { last_visit_date: nowIso } }
    );

    delete newRx._id;
    return newRx;
}

async function getPrescriptionById(rxId) {
    const db = await connect();
    const strId = String(rxId);
    const numId = Number(rxId);

    const filter = {
        $or: [
            { rx_id: strId },
            ...(isNaN(numId) ? [] : [{ id: numId }])
        ]
    };

    const rx = await db.collection('prescriptions').findOne(filter);
    if (!rx) return null;
    delete rx._id;

    // Fetch patient info
    const ptFilter = {
        $or: [
            { patient_id: rx.patient_id },
            { id: Number(rx.patient_id) }
        ]
    };
    const pt = await db.collection('patients').findOne(ptFilter);
    if (pt) {
        rx.patient_name = pt.name;
        rx.patient_code = pt.patient_id;
        rx.patient_age = pt.age;
        rx.patient_gender = pt.gender;
        rx.patient_phone = pt.phone;
        rx.patient_address = pt.address;
    }

    return rx;
}

// ── Stats (Aggregated in <5ms) ──
async function getStats() {
    const db = await connect();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [totalPatients, totalPrescriptions, todayPatients] = await Promise.all([
        db.collection('patients').countDocuments({}),
        db.collection('prescriptions').countDocuments({}),
        db.collection('patients').countDocuments({ created_at: { $gte: todayIso } })
    ]);

    return {
        totalPatients,
        totalPrescriptions,
        todayPatients
    };
}

module.exports = {
    isConfigured,
    connect,
    getMongoUri,
    getNextPatientId,
    getNextRxId,
    getAllPatients,
    searchPatients,
    getPatientById,
    createPatient,
    updatePatient,
    deletePatient,
    createPrescription,
    getPrescriptionById,
    getStats
};
