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

        const appointments = db.collection('appointments');
        await appointments.createIndex({ reference_no: 1 }, { unique: true });
        await appointments.createIndex({ preferred_date: 1 });
        await appointments.createIndex({ mobile: 1 });
        await appointments.createIndex({ status: 1 });
        await appointments.createIndex({ created_at: -1 });

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

    // Fetch patient info to embed permanently in prescription
    const ptFilter = {
        $or: [
            { patient_id: String(data.patient_id) },
            { patient_id: data.patient_id },
            ...(isNaN(Number(data.patient_id)) ? [] : [{ id: Number(data.patient_id) }])
        ]
    };
    const pt = await db.collection('patients').findOne(ptFilter);

    const ptName = (pt && pt.name) || data.name || data.patient_name || '';
    const ptCode = (pt && pt.patient_id) || data.patient_code || String(data.patient_id);
    const ptAge = (pt && pt.age) || data.age || data.patient_age || '';
    const ptGender = (pt && pt.gender) || data.gender || data.patient_gender || '';
    const ptPhone = (pt && pt.phone) || data.phone || data.patient_phone || '';
    const ptAddress = (pt && pt.address) || data.address || data.patient_address || '';

    const newRx = {
        id: ids.numericId,
        rx_id: ids.code,
        patient_id: String(data.patient_id),
        patient_code: ptCode,
        name: ptName,
        patient_name: ptName,
        age: ptAge,
        patient_age: ptAge,
        gender: ptGender,
        patient_gender: ptGender,
        phone: ptPhone,
        patient_phone: ptPhone,
        address: ptAddress,
        patient_address: ptAddress,
        complaints: data.complaints || '',
        diagnosis: data.diagnosis || '',
        tests: data.tests || '',
        next_visit_date: data.next_visit_date ? String(data.next_visit_date).trim() : null,
        notes: data.notes || '',
        previous_visit_date: prevVisitDate,
        medicines: Array.isArray(data.medicines) ? data.medicines : [],
        created_at: nowIso
    };

    await db.collection('prescriptions').insertOne({ ...newRx });

    // Update patient's last_visit_date and next_visit_date
    const ptUpdate = { last_visit_date: nowIso };
    if (data.next_visit_date) {
        ptUpdate.next_visit_date = String(data.next_visit_date).trim();
    }
    await db.collection('patients').updateOne(
        {
            $or: [
                { patient_id: String(data.patient_id) },
                { id: Number(data.patient_id) }
            ]
        },
        { $set: ptUpdate }
    );

    delete newRx._id;
    return newRx;
}

async function getPrescriptionById(rxId) {
    const db = await connect();
    const strId = String(rxId).trim();
    const numId = Number(rxId);

    const filter = {
        $or: [
            { rx_id: strId },
            { rx_id: { $regex: new RegExp(`^${strId}$`, 'i') } },
            ...(isNaN(numId) ? [] : [{ id: numId }])
        ]
    };

    const rx = await db.collection('prescriptions').findOne(filter);
    if (!rx) return null;
    delete rx._id;

    // Fetch patient info
    const ptFilter = {
        $or: [
            { patient_id: String(rx.patient_id) },
            { patient_id: rx.patient_id },
            ...(rx.patient_code ? [{ patient_id: rx.patient_code }] : []),
            ...(isNaN(Number(rx.patient_id)) ? [] : [{ id: Number(rx.patient_id) }])
        ]
    };
    const pt = await db.collection('patients').findOne(ptFilter);
    if (pt) {
        rx.name = pt.name;
        rx.patient_name = pt.name;
        rx.patient_code = pt.patient_id;
        rx.age = pt.age;
        rx.patient_age = pt.age;
        rx.gender = pt.gender;
        rx.patient_gender = pt.gender;
        rx.phone = pt.phone;
        rx.patient_phone = pt.phone;
        rx.address = pt.address;
        rx.patient_address = pt.address;
    } else {
        // Fallbacks to guarantee name & demographics are never missing
        if (!rx.name && rx.patient_name) rx.name = rx.patient_name;
        if (!rx.patient_name && rx.name) rx.patient_name = rx.name;
        if (rx.age === undefined && rx.patient_age !== undefined) rx.age = rx.patient_age;
        if (rx.patient_age === undefined && rx.age !== undefined) rx.patient_age = rx.age;
        if (!rx.gender && rx.patient_gender) rx.gender = rx.patient_gender;
        if (!rx.patient_gender && rx.gender) rx.patient_gender = rx.gender;
        if (!rx.phone && rx.patient_phone) rx.phone = rx.patient_phone;
        if (!rx.patient_phone && rx.phone) rx.patient_phone = rx.phone;
        if (!rx.address && rx.patient_address) rx.address = rx.patient_address;
        if (!rx.patient_address && rx.address) rx.patient_address = rx.address;
    }

    return rx;
}

async function deletePrescription(rxId) {
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
    if (!rx) return false;

    await db.collection('prescriptions').deleteOne(filter);

    // Re-evaluate patient's last_visit_date and next_visit_date
    const patientCode = rx.patient_id;
    const remainingRx = await db.collection('prescriptions')
        .find({ patient_id: patientCode })
        .sort({ created_at: -1 })
        .limit(1)
        .toArray();

    const ptUpdate = {};
    if (remainingRx.length > 0) {
        ptUpdate.last_visit_date = remainingRx[0].created_at;
        ptUpdate.next_visit_date = remainingRx[0].next_visit_date || null;
    } else {
        // Fall back to patient created_at
        const pt = await db.collection('patients').findOne({
            $or: [{ patient_id: patientCode }, { id: Number(patientCode) }]
        });
        if (pt) {
            ptUpdate.last_visit_date = pt.created_at;
            ptUpdate.next_visit_date = null;
        }
    }

    await db.collection('patients').updateOne(
        { $or: [{ patient_id: patientCode }, { id: Number(patientCode) }] },
        { $set: ptUpdate }
    );

    return true;
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
  // ─── 12 BIOCHEMIC TISSUE SALTS ───
  { name: "Calcarea Fluorica", common_potencies: ["6X", "12X", "30X", "200X"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Varicose veins, bone spurs, cataracts, tooth decay" },
  { name: "Calcarea Phosphorica", common_potencies: ["6X", "12X", "30X"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Bone fractures, slow teething, growth tonic for children, rickets" },
  { name: "Calcarea Sulphurica", common_potencies: ["6X", "12X"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Cystic acne, suppurating wounds, boils with thick yellow pus" },
  { name: "Ferrum Phosphoricum", common_potencies: ["6X", "12X", "30C"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "5 Days", indication: "First stage of all fevers, acute inflammation, anemia, bronchitis" },
  { name: "Kali Muriaticum", common_potencies: ["6X", "12X"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Second stage inflammation, white tongue coating, ear congestion" },
  { name: "Kali Phosphoricum", common_potencies: ["6X", "12X", "30C"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Nerve exhaustion, brain fag, stress, depression, insomnia" },
  { name: "Kali Sulphuricum", common_potencies: ["6X", "12X"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Third stage catarrh, yellow-slimy discharge, dandruff, peeling skin" },
  { name: "Magnesium Phosphoricum", common_potencies: ["6X", "12X", "30C", "200C"], default_dosage: "4 tablets in warm water", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Severe spasmodic pain, menstrual colic, cramps relieved by heat" },
  { name: "Natrum Muriaticum", common_potencies: ["6X", "12X", "30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Anemia, sun headache, grief, dry chapped lips, eczema" },
  { name: "Natrum Phosphoricum", common_potencies: ["6X", "12X"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Hyperacidity, sour eructations, golden-yellow tongue coating" },
  { name: "Natrum Sulphuricum", common_potencies: ["6X", "12X", "30C", "200C"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Liver complaints, morning diarrhea, asthma in damp weather" },
  { name: "Silicea", common_potencies: ["6X", "12X", "30C", "200C"], default_dosage: "4 tablets", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Abscess, styes, ingrown toenails, brittle nails, offensive foot sweat" },

  // ─── MAJOR MOTHER TINCTURES (Q) ───
  { name: "Berberis Vulgaris Q", common_potencies: ["Q"], default_dosage: "10-15 drops in water", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Renal calculus (kidney stone), radiating back pain, uric acid" },
  { name: "Crataegus Oxyacantha Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Heart tonic, high blood pressure, angina pectoris, palpitations" },
  { name: "Syzygium Jambolanum Q", common_potencies: ["Q"], default_dosage: "10-15 drops in water", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Diabetes mellitus, blood sugar regulator, excessive thirst" },
  { name: "Withania Somnifera (Ashwagandha) Q", common_potencies: ["Q"], default_dosage: "15 drops in water", default_frequency: "Morning & Night", default_duration: "1 Month", indication: "General debility, vitality tonic, memory loss, fatigue" },
  { name: "Ocimum Sanctum (Tulsi) Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Cough, cold, influenza, intermittent fever, respiratory immunity" },
  { name: "Echinacea Angustifolia Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Blood purifier, septic infections, boils, low immunity" },
  { name: "Passiflora Incarnata Q", common_potencies: ["Q"], default_dosage: "20-30 drops in water", default_frequency: "At bedtime", default_duration: "15 Days", indication: "Insomnia, sleeplessness due to worry, nervous palpitations" },
  { name: "Plantago Major Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Severe toothache, earache, sensitive teeth" },
  { name: "Calendula Officinalis Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Antiseptic healing, open cuts, lacerations, burns, ulcers" },
  { name: "Rauvolfia Serpentina Q", common_potencies: ["Q"], default_dosage: "10-15 drops in water", default_frequency: "Morning & Evening", default_duration: "1 Month", indication: "Hypertension, high blood pressure, insomnia, psychiatric calm" },
  { name: "Terminalia Arjuna Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Cardiac tonic, high cholesterol, weakness of heart muscles" },
  { name: "Hamamelis Virginica Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Bleeding piles, varicose veins, venous congestion" },
  { name: "Cephalandra Indica Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Blood sugar regulator, dryness of mouth with diabetes" },
  { name: "Chelidonium Majus Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Jaundice, liver enlargement, pain under right scapula" },
  { name: "Hydrastis Canadensis Q", common_potencies: ["Q"], default_dosage: "10 drops in water", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Chronic gastritis, sluggish liver, thick ropy mucous secretions" },
  { name: "Damiana Q", common_potencies: ["Q"], default_dosage: "15 drops in water", default_frequency: "Morning & Night", default_duration: "1 Month", indication: "Sexual weakness, neurasthenia, vitality tonic" },
  { name: "Sabal Serrulata Q", common_potencies: ["Q"], default_dosage: "10-15 drops in water", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Benign prostatic hyperplasia (BPH), prostate enlargement" },
  { name: "Avena Sativa Q", common_potencies: ["Q"], default_dosage: "15-20 drops in warm water", default_frequency: "At bedtime", default_duration: "1 Month", indication: "Nerve exhaustion, convalescence after illness, sleeplessness" },
  { name: "Cascara Sagrada Q", common_potencies: ["Q"], default_dosage: "15 drops in water", default_frequency: "At bedtime", default_duration: "10 Days", indication: "Chronic constipation, restores normal peristaltic bowel movement" },

  // ─── CLASSIC POLYCHRESTS & MATERIA MEDICA REMEDIES ───
  { name: "Aconitum Napellus", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "3 Days", indication: "Sudden high fever, terror, panic, dry cold wind exposure" },
  { name: "Allium Cepa", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Sneezing, profuse acrid watery nasal discharge, bland tears" },
  { name: "Antimonium Crudum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Thick milky-white coated tongue, indigestion from sweets" },
  { name: "Antimonium Tartaricum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Rattling cough with inability to expectorate phlegm, bronchitis" },
  { name: "Apis Mellifica", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Bee stings, swelling with stinging burning pain, hives" },
  { name: "Arnica Montana", common_potencies: ["30C", "200C", "1M", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Blunt trauma, falls, bruises, muscle soreness, post-operative" },
  { name: "Arsenicum Album", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "5 Days", indication: "Food poisoning, gastroenteritis, midnight asthma, restlessness" },
  { name: "Baptisia Tinctoria", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Typhoid fever, stupor, offensive breath, feels scattered" },
  { name: "Baryta Carbonica", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "1 Month", indication: "Recurrent tonsillitis, developmental delay, geriatric memory loss" },
  { name: "Belladonna", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "3 Days", indication: "Sudden high fever, flushed red face, throbbing headache" },
  { name: "Berberis Vulgaris", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Kidney stones, renal colic, radiating back pain" },
  { name: "Bryonia Alba", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Dry painful cough, constipation, pain worse on least movement" },
  { name: "Calcarea Carbonica", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Once daily", default_duration: "1 Month", indication: "Chubby children with profuse head sweating during sleep" },
  { name: "Camphora", common_potencies: ["Q", "30C", "200C"], default_dosage: "4 pills", default_frequency: "Every 15 mins in collapse", default_duration: "1 Day", indication: "Sudden collapse, icy coldness of body yet cannot bear covers" },
  { name: "Cantharis Vesicatoria", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Scalding burning during micturition, drop by drop urination, burns" },
  { name: "Carbo Vegetabilis", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Upper abdominal bloating, cold skin, air hunger, vital collapse" },
  { name: "Causticum", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Loss of voice, hoarseness, urinary incontinence on coughing" },
  { name: "Chamomilla", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Infant dentition colic, green diarrhea, extreme irritability" },
  { name: "Chelidonium Majus", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Jaundice, liver enlargement, pain under right scapula" },
  { name: "Cina Maritima", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Intestinal worms, grinding teeth in sleep, rubbing nose" },
  { name: "Cinchona Officinalis (China)", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Exhaustion from loss of fluids, anemia, whole abdomen bloated" },
  { name: "Cocculus Indicus", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "3 Days", indication: "Motion sickness, car/sea sickness, dizziness from night watching" },
  { name: "Coffea Cruda", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "At bedtime", default_duration: "5 Days", indication: "Insomnia from racing thoughts, over-excitement, wide awake" },
  { name: "Colchicum Autumnale", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Gouty arthritis in big toe, nausea from smell of food" },
  { name: "Colocynthis", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Violent abdominal colic, bends double, relieved by hard pressure" },
  { name: "Conium Maculatum", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "1 Month", indication: "Breast lumps, glandular tumors, vertigo when turning head" },
  { name: "Dioscorea Villosa", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Abdominal cramps relieved by bending backwards or standing erect" },
  { name: "Drosera Rotundifolia", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Spasmodic paroxysmal cough, whooping cough worse at night" },
  { name: "Dulcamara", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Cough or joint pain from change to damp cold weather" },
  { name: "Echinacea Angustifolia", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Immunity booster, blood purifier, recurrent boils, sepsis" },
  { name: "Euphrasia Officinalis", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Conjunctivitis, burning acrid tears, bland non-irritating coryza" },
  { name: "Gelsemium Sempervirens", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Dullness, dizziness, trembling, flu with heavy drooping eyelids" },
  { name: "Glonoinum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "3 Days", indication: "Sunstroke, bursting throbbing congestive headache, high BP" },
  { name: "Graphites", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Eczema in skin folds with honey-like sticky yellow fluid" },
  { name: "Hamamelis Virginica", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Bleeding piles with dark blood, varicose veins, bruised soreness" },
  { name: "Hepar Sulphuris", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Suppurating painful boils, extreme sensitivity to cold draft of air" },
  { name: "Hyoscyamus Niger", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Dry nighttime cough relieved by sitting up, twitching, delirium" },
  { name: "Hypericum Perforatum", common_potencies: ["30C", "200C", "1M", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Nerve-rich injuries: crushed fingers, coccyx fall, animal bites" },
  { name: "Ignatia Amara", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "10 Days", indication: "Emotional grief, sorrow, bereavement, frequent involuntary sighing" },
  { name: "Ipecacuanha (Ipecac)", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Persistent nausea not relieved by vomiting, clean tongue" },
  { name: "Kali Bichromicum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Sinusitis, thick stringy tough yellow mucus in long threads" },
  { name: "Kali Carbonicum", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Lower backache, bags above upper eyelids, asthma at 2-4 AM" },
  { name: "Kreosotum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "15 Days", indication: "Rapid decay of children teeth, acrid vaginal discharges" },
  { name: "Lachesis Muta", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning only", default_duration: "7 Days", indication: "Hot flashes, cannot bear tight collar around neck, left-sided" },
  { name: "Ledum Palustre", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Puncture wounds from nails, insect bites, black eye, feels cold" },
  { name: "Lycopodium Clavatum", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Right-sided complaints, flatulence worse 4-8 PM, warm food craving" },
  { name: "Medorrhinum", common_potencies: ["200C", "1M"], default_dosage: "4 pills", default_frequency: "Single dose weekly", default_duration: "1 Month", indication: "Chronic joint pains, burning soles of feet, constitutional nosode" },
  { name: "Mercurius Solubilis", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Offensive night sweat, excessive saliva, flabby indented tongue" },
  { name: "Mezereum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Eczema with thick crusts and oozing pus, shingles neuralgia" },
  { name: "Nitricum Acidum", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Splinter-like stitching pains, anal fissures, bleeding warts" },
  { name: "Nux Vomica", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "At bedtime", default_duration: "7 Days", indication: "Sedentary lifestyle, acid reflux, constipation, irritability" },
  { name: "Opium", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "5 Days", indication: "Coma, painless complaints, obstinate constipation with black balls" },
  { name: "Petroleum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Skin cracks and bleeds in winter, chapped hands and feet" },
  { name: "Phosphoricum Acidum", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "15 Days", indication: "Apathy, hair fall after grief, diabetes, mental exhaustion" },
  { name: "Phosphorus", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "10 Days", indication: "Tall slender build, craving for ice-cold water, bleeding tendency" },
  { name: "Phytolacca Decandra", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Throat pain shooting to ears on swallowing, hard mastitis" },
  { name: "Platina", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "15 Days", indication: "Arrogance, vaginismus, severe neuralgic numbness, ovarian pain" },
  { name: "Plumbum Metallicum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "15 Days", indication: "Violent abdominal colic radiating to limbs, blue gum line" },
  { name: "Podophyllum Peltatum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Profuse painless morning diarrhea, gushing watery stool" },
  { name: "Psorinum", common_potencies: ["200C", "1M"], default_dosage: "4 pills", default_frequency: "Single dose weekly", default_duration: "1 Month", indication: "Chronic intolerable skin itching, offensive sweat, chilly patient" },
  { name: "Pulsatilla Nigricans", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Thirstless, weeping disposition, open air relief, changeable symptoms" },
  { name: "Pyrogenium", common_potencies: ["200C", "1M"], default_dosage: "4 pills", default_frequency: "Every 4 hours in acute sepsis", default_duration: "5 Days", indication: "Septic fevers, bed feels too hard, rapid disproportionate pulse" },
  { name: "Ranunculus Bulbosus", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Intercostal neuralgia, shingles with bluish burning blisters" },
  { name: "Rhododendron Chrysanthum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Rheumatic pains worse before thunderstorm, orchitis" },
  { name: "Rhus Toxicodendron", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Joint stiffness worse on first motion, better on continued movement" },
  { name: "Rumex Crispus", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Violent dry tickling cough triggered by breathing cold air" },
  { name: "Ruta Graveolens", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "10 Days", indication: "Injuries to tendons and periosteum, eye strain from reading" },
  { name: "Sabadilla", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Paroxysmal sneezing, hay fever, red burning eyelids" },
  { name: "Sabal Serrulata", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Prostate enlargement in elderly men, frequent night urination" },
  { name: "Sabina", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Uterine bleeding shooting from sacrum to pubes, threatened abortion" },
  { name: "Sambucus Nigra", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Snuffles in newborn infants, cannot breathe while nursing" },
  { name: "Sanguinaria Canadensis", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Right-sided migraine starting in occiput, settling over right eye" },
  { name: "Sarsaparilla", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "15 Days", indication: "Severe screaming pain at end of urination, white sediment" },
  { name: "Secale Cornutum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "10 Days", indication: "Gangrene, Reynauds disease, cold limbs that burn internally" },
  { name: "Selenium Metallicum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "15 Days", indication: "Hair fall, involuntary seminal emissions, hoarseness in singers" },
  { name: "Sepia Officinalis", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Bearing-down sensation in uterus, brown saddle on nose bridge" },
  { name: "Spigelia Anthelmia", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Left-sided facial neuralgia, sharp knife-like heart pains" },
  { name: "Spongia Tosta", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Croupy barking dry cough like saw through pine wood" },
  { name: "Staphysagria", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "10 Days", indication: "Ailments from suppressed anger, styes on eyelids, honeymoon cystitis" },
  { name: "Stramonium", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "10 Days", indication: "Terror, fear of darkness, stammering, violent night terrors" },
  { name: "Sulphur", common_potencies: ["30C", "200C", "1M"], default_dosage: "4 pills", default_frequency: "Once early morning", default_duration: "7 Days", indication: "Skin itching, burning soles, empty stomach sinking at 11 AM" },
  { name: "Symphytum Officinale", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "1 Month", indication: "Accelerates union of fractured bones, blunt eyeball trauma" },
  { name: "Syphilinum", common_potencies: ["200C", "1M"], default_dosage: "4 pills", default_frequency: "Single dose weekly", default_duration: "1 Month", indication: "Nighttime bone pains from sunset to sunrise, linear ulcerations" },
  { name: "Tabacum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "As needed during nausea", default_duration: "3 Days", indication: "Severe travel nausea with cold clammy sweat, must uncover body" },
  { name: "Tarentula Hispanica", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Twice daily", default_duration: "15 Days", indication: "Restless legs, constantly moves feet, symptoms soothed by music" },
  { name: "Terebinthina", common_potencies: ["30C", "200C", "Q"], default_dosage: "4 pills", default_frequency: "3 times daily", default_duration: "7 Days", indication: "Smoky coffee-ground urine with blood, bladder inflammation" },
  { name: "Thuja Occidentalis", common_potencies: ["30C", "200C", "1M", "Q"], default_dosage: "4 pills", default_frequency: "Once daily", default_duration: "1 Month", indication: "Skin warts, polyps, pedunculated growths, vaccine ill-effects" },
  { name: "Tuberculinum Bovinum", common_potencies: ["200C", "1M"], default_dosage: "4 pills", default_frequency: "Single dose monthly", default_duration: "2 Months", indication: "Respiratory weakness, catches cold from least exposure" },
  { name: "Urtica Urens", common_potencies: ["Q", "30C", "200C"], default_dosage: "4 pills / 10 drops", default_frequency: "3 times daily", default_duration: "5 Days", indication: "Nettle rash, hives, severe stinging burning, promotes breast milk" },
  { name: "Veratrum Album", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Every 2 hours in acute diarrhea", default_duration: "3 Days", indication: "Violent vomiting with profuse watery diarrhea, cold forehead sweat" },
  { name: "Zincum Metallicum", common_potencies: ["30C", "200C"], default_dosage: "4 pills", default_frequency: "Morning & Evening", default_duration: "15 Days", indication: "Restless fidgety feet, brain exhaustion, delayed skin eruptions" }
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

// ── Appointment Management ──

function getTodayISTString() {
    const d = new Date();
    // Convert to IST (UTC + 5:30)
    const istTime = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

async function getNextAppointmentRef() {
    const db = await connect();
    const today = getTodayISTString();
    const prefix = `BHC-${today}-`;

    const last = await db.collection('appointments')
        .find({ reference_no: { $regex: `^${prefix}` } })
        .sort({ reference_no: -1 })
        .limit(1)
        .project({ reference_no: 1 })
        .toArray();

    let seq = 1;
    if (last.length > 0 && last[0].reference_no) {
        const parts = last[0].reference_no.split('-');
        const lastNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastNum)) {
            seq = lastNum + 1;
        }
    }
    return `${prefix}${String(seq).padStart(3, '0')}`;
}

async function createAppointment(data) {
    const db = await connect();
    let refNo = await getNextAppointmentRef();

    // Prevent rare collisions
    let exists = await db.collection('appointments').findOne({ reference_no: refNo });
    let attempts = 0;
    while (exists && attempts < 10) {
        const parts = refNo.split('-');
        const num = parseInt(parts[2], 10) + 1;
        refNo = `${parts[0]}-${parts[1]}-${String(num).padStart(3, '0')}`;
        exists = await db.collection('appointments').findOne({ reference_no: refNo });
        attempts++;
    }

    const appointment = {
        reference_no: refNo,
        patient_type: data.patient_type || 'new',
        patient_id: data.patient_id ? String(data.patient_id).trim() : '',
        name: data.name ? data.name.trim() : (data.patient_id ? `Existing Patient (${data.patient_id})` : 'New Patient'),
        age: data.age !== null && data.age !== undefined && !isNaN(parseInt(data.age, 10)) ? parseInt(data.age, 10) : null,
        gender: data.gender || '',
        mobile: String(data.mobile || '').trim(),
        address: data.address ? String(data.address).trim() : '',
        preferred_date: data.preferred_date,
        reason: data.reason ? data.reason.trim() : '',
        status: 'Pending',
        notes: data.notes ? data.notes.trim() : '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    await db.collection('appointments').insertOne({ ...appointment });
    delete appointment._id;
    return appointment;
}

async function getAllAppointments(query = {}) {
    const db = await connect();
    const filter = {};

    if (query.status && query.status !== 'all') {
        filter.status = query.status;
    }
    if (query.date) {
        filter.preferred_date = query.date;
    }
    if (query.q && query.q.trim()) {
        const term = query.q.trim();
        filter.$or = [
            { reference_no: { $regex: term, $options: 'i' } },
            { name: { $regex: term, $options: 'i' } },
            { mobile: { $regex: term, $options: 'i' } }
        ];
    }

    const list = await db.collection('appointments')
        .find(filter)
        .sort({ created_at: -1 })
        .toArray();

    return list.map(item => {
        delete item._id;
        return item;
    });
}

async function getAppointmentByRef(reference_no) {
    const db = await connect();
    const item = await db.collection('appointments').findOne({ reference_no: reference_no.trim() });
    if (item) delete item._id;
    return item;
}

async function updateAppointmentStatus(reference_no, status, notes = null) {
    const db = await connect();
    const update = {
        $set: {
            status: status,
            updated_at: new Date().toISOString()
        }
    };
    if (notes !== null) {
        update.$set.notes = notes;
    }
    const result = await db.collection('appointments').findOneAndUpdate(
        { reference_no: reference_no.trim() },
        update,
        { returnDocument: 'after' }
    );
    if (result && result.value) {
        delete result.value._id;
        return result.value;
    }
    return getAppointmentByRef(reference_no);
}

async function deleteAppointment(reference_no) {
    const db = await connect();
    const result = await db.collection('appointments').deleteOne({ reference_no: reference_no.trim() });
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
    deletePrescription,
    getStats,
    getAllMedicines,
    addMedicine,
    deleteMedicine,
    seedDefaultMedicines,
    DEFAULT_MEDICINES,
    getNextAppointmentRef,
    createAppointment,
    getAllAppointments,
    getAppointmentByRef,
    updateAppointmentStatus,
    deleteAppointment
};
