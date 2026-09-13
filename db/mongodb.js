// ============================================================
// MONGODB DATABASE ADAPTER FOR CLINIC SYSTEM
// High-performance, low-latency document storage
// ============================================================

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

let cachedClient = null;
let cachedDb = null;

function sanitizeMongoUri(rawUri) {
    if (!rawUri) return '';
    try {
        // If URI contains unescaped @ in password (e.g. user:pass@word@cluster...)
        const match = rawUri.match(/^(mongodb(?:\+srv)?:\/\/)([^:]+):(.+)@([^@]+)$/);
        if (match) {
            const scheme = match[1];
            const user = match[2];
            const rawPass = match[3];
            const hostAndRest = match[4];
            // Encode @ as %40 if not already encoded
            const encodedPass = rawPass.replace(/@/g, '%40');
            return `${scheme}${user}:${encodedPass}@${hostAndRest}`;
        }
    } catch (_) {}
    return rawUri;
}

function getMongoUri() {
    let uri = '';
    if (process.env.MONGODB_URI && process.env.MONGODB_URI.trim()) {
        uri = process.env.MONGODB_URI.trim();
    } else {
        try {
            const envPath = path.join(__dirname, '..', '.env');
            if (fs.existsSync(envPath)) {
                const content = fs.readFileSync(envPath, 'utf8');
                const match = content.match(/MONGODB_URI=["']?(mongodb(\+srv)?:\/\/[^"'\r\n]+)["']?/);
                if (match) uri = match[1].trim();
            }
        } catch (_) {}
    }
    return sanitizeMongoUri(uri);
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

// ── Master Medicines Catalog ──

const DEFAULT_MEDICINES = [
    { name: 'Arnica Montana', common_potencies: ['30C', '200C', '1M', 'Q'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '7 Days', indication: 'Trauma, injury, soreness, muscular pain' },
    { name: 'Nux Vomica', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'At bedtime', default_duration: '7 Days', indication: 'Gastric trouble, acidity, indigestion, constipation' },
    { name: 'Rhus Toxicodendron', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '10 Days', indication: 'Joint pain, stiffness worse on first movement' },
    { name: 'Bryonia Alba', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '7 Days', indication: 'Dry cough, pleurisy, pain worse with least motion' },
    { name: 'Belladonna', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'High fever, sudden redness, throbbing headache' },
    { name: 'Arsenicum Album', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: 'Morning & Evening', default_duration: '5 Days', indication: 'Food poisoning, burning pain, restlessness, asthma' },
    { name: 'Pulsatilla Nigricans', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'Morning & Evening', default_duration: '15 Days', indication: 'Catarrh, menstrual irregularities, changeable symptoms' },
    { name: 'Lycopodium Clavatum', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'Morning & Evening', default_duration: '15 Days', indication: 'Liver disorders, bloating 4-8 PM, flatulence' },
    { name: 'Thuja Occidentalis', common_potencies: ['30C', '200C', '1M', 'Q'], default_dosage: '4 pills', default_frequency: 'Once daily', default_duration: '1 Month', indication: 'Warts, skin excrescences, polyp, vaccination ill-effects' },
    { name: 'Calcarea Carbonica', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'Once daily', default_duration: '1 Month', indication: 'Fat, flabby, cold, profuse head sweating' },
    { name: 'Sulphur', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'Once early morning', default_duration: '7 Days', indication: 'Skin itching, burning, psoriasis, chronic relapse' },
    { name: 'Hypericum Perforatum', common_potencies: ['30C', '200C', 'Q'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '7 Days', indication: 'Nerve injury, crushed fingers/toes, coccyx fall' },
    { name: 'Silicea', common_potencies: ['6X', '12X', '30C', '200C'], default_dosage: '4 tablets', default_frequency: '3 times daily', default_duration: '15 Days', indication: 'Boils, abscess, suppurations, weak nails' },
    { name: 'Hepar Sulphuris', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Infections with extreme sensitivity to cold & touch' },
    { name: 'Natrum Muriaticum', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'Morning & Evening', default_duration: '15 Days', indication: 'Headache from sun, anemia, grief, dry lips' },
    { name: 'Aconitum Napellus', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '3 Days', indication: 'Sudden onset fever, panic, exposure to dry cold wind' },
    { name: 'Chamomilla', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Dentition diarrhea, extreme irritability, colic' },
    { name: 'Colocynthis', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Severe cramping, abdominal colic bending double' },
    { name: 'Berberis Vulgaris', common_potencies: ['Q', '30C', '200C'], default_dosage: '10 drops in water', default_frequency: '3 times daily', default_duration: '1 Month', indication: 'Kidney stones, renal colic, radiating back pain' },
    { name: 'Ignatia Amara', common_potencies: ['30C', '200C', '1M'], default_dosage: '4 pills', default_frequency: 'Morning & Evening', default_duration: '10 Days', indication: 'Acute grief, emotional distress, sighing' },
    { name: 'Allium Cepa', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Coryza, acrid nasal discharge, bland lachrymation' },
    { name: 'Cantharis Vesicatoria', common_potencies: ['30C', '200C', 'Q'], default_dosage: '4 pills / 10 drops', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Burning micturition, cystitis, burns and scalds' },
    { name: 'Apis Mellifica', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Stinging pain, edema, bee stings, urticaria' },
    { name: 'Ledum Palustre', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '7 Days', indication: 'Puncture wounds, black eye, animal bites, cold to touch' },
    { name: 'Ruta Graveolens', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '10 Days', indication: 'Tendon, ligament sprain, periosteum injury, eye strain' },
    { name: 'Carbo Vegetabilis', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Upper abdominal gas, collapse state, wants to be fanned' },
    { name: 'Cinchona Officinalis (China)', common_potencies: ['30C', '200C', 'Q'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '10 Days', indication: 'Debility from loss of vital fluids, malaria, bloating' },
    { name: 'Gelsemium Sempervirens', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '5 Days', indication: 'Dullness, dizziness, trembling, anticipation anxiety' },
    { name: 'Drosera Rotundifolia', common_potencies: ['30C', '200C'], default_dosage: '4 pills', default_frequency: '3 times daily', default_duration: '7 Days', indication: 'Spasmodic paroxysmal cough, whooping cough worse at night' },
    { name: 'Echinacea Angustifolia', common_potencies: ['Q', '30C'], default_dosage: '10 drops in water', default_frequency: '3 times daily', default_duration: '15 Days', indication: 'Immunity booster, blood purifier, recurrent boils' }
];

async function seedDefaultMedicines(db) {
    try {
        const collection = db.collection('medicines');
        const count = await collection.countDocuments({});
        if (count === 0) {
            const nowIso = new Date().toISOString();
            const docs = DEFAULT_MEDICINES.map(m => ({ ...m, created_at: nowIso }));
            await collection.insertMany(docs);
            await collection.createIndex({ name: 1 }, { unique: true });
            console.log(`✅ Pre-seeded ${docs.length} homeopathic medicines into database.`);
        }
    } catch (e) {
        console.warn('Medicine seed notice:', e.message);
    }
}

async function getAllMedicines() {
    const db = await connect();
    await seedDefaultMedicines(db);
    const meds = await db.collection('medicines').find({}).sort({ name: 1 }).toArray();
    return meds.map(m => {
        delete m._id;
        return m;
    });
}

async function addMedicine(data) {
    const db = await connect();
    if (!data.name || !data.name.trim()) {
        throw new Error('Medicine name is required.');
    }

    const cleanName = data.name.trim();
    const existing = await db.collection('medicines').findOne({
        name: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    if (existing) {
        throw new Error(`Medicine "${cleanName}" already exists in the database.`);
    }

    const newMed = {
        name: cleanName,
        common_potencies: Array.isArray(data.common_potencies) ? data.common_potencies : ['30C', '200C', '1M', 'Q'],
        default_dosage: data.default_dosage ? data.default_dosage.trim() : '4 pills',
        default_frequency: data.default_frequency ? data.default_frequency.trim() : '3 times daily',
        default_duration: data.default_duration ? data.default_duration.trim() : '7 Days',
        indication: data.indication ? data.indication.trim() : '',
        created_at: new Date().toISOString()
    };

    await db.collection('medicines').insertOne({ ...newMed });
    delete newMed._id;
    return newMed;
}

async function deleteMedicine(name) {
    const db = await connect();
    const cleanName = (name || '').trim();
    const result = await db.collection('medicines').deleteOne({
        name: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    return result.deletedCount > 0;
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
    getStats,
    getAllMedicines,
    addMedicine,
    deleteMedicine,
    seedDefaultMedicines,
    DEFAULT_MEDICINES
};
