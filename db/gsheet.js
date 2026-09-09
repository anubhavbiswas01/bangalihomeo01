// ============================================================
// GOOGLE SHEETS DATABASE ADAPTER
// ============================================================

const fs = require('fs');
const path = require('path');

let hardcodedUrl = 'https://script.google.com/macros/s/AKfycbxwypco_TCcEFQUdGZzJJG1CoLRoCIlCAmEMKcChVGq1y91SErBL_1HnSIA5P6sR5mg/exec';

function getUrl() {
    if (process.env.GSHEET_WEBAPP_URL && process.env.GSHEET_WEBAPP_URL.trim()) {
        return process.env.GSHEET_WEBAPP_URL.trim();
    }
    if (hardcodedUrl && hardcodedUrl.trim()) {
        return hardcodedUrl.trim();
    }
    try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/GSHEET_WEBAPP_URL=["']?(https:\/\/script\.google\.com\/macros\/s\/[^"'\r\n]+)["']?/);
            if (match) return match[1].trim();
        }
    } catch (_) {}
    return '';
}

// High-speed in-memory cache to make Google Sheets instant
let cache = {
    patients: null,
    stats: null,
    patientDetails: {},
    lastFetched: 0
};
const CACHE_TTL_MS = 60000; // 60 seconds (1 minute)

let pendingPatientsPromise = null;
let pendingDetailPromises = {};

function invalidateCache() {
    cache.patients = null;
    cache.stats = null;
    cache.patientDetails = {};
    cache.lastFetched = 0;
    pendingPatientsPromise = null;
    pendingDetailPromises = {};
}

function isConfigured() {
    const u = getUrl();
    return Boolean(u && u.startsWith('https://script.google.com/macros/s/'));
}

function setUrl(url) {
    hardcodedUrl = (url || '').trim();
    invalidateCache();
}

async function request(action, params = {}, method = 'GET', body = null) {
    if (!isConfigured()) {
        throw new Error('Google Sheets Web App URL is not configured yet. Please deploy the Apps Script and provide the URL.');
    }

    let url = new URL(getUrl());
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const options = {
        method,
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' }
    };

    if (method === 'POST') {
        options.body = JSON.stringify({ action, ...body });
    }

    const res = await fetch(url.toString(), options);
    if (!res.ok) {
        throw new Error(`Google Sheets request failed with status ${res.status}`);
    }
    const data = await res.json();
    if (data && data.error) {
        throw new Error(data.error);
    }
    return data;
}

// ── Patient Operations with Promise Deduplication ──

async function getAllPatients() {
    const now = Date.now();
    if (cache.patients && (now - cache.lastFetched) < CACHE_TTL_MS) {
        return cache.patients;
    }

    // Deduplicate in-flight requests (e.g. simultaneous dashboard load & stats calls)
    if (pendingPatientsPromise) {
        return pendingPatientsPromise;
    }

    pendingPatientsPromise = (async () => {
        try {
            const patients = await request('get_all');
            cache.patients = Array.isArray(patients) ? patients : [];
            cache.lastFetched = Date.now();
            return cache.patients;
        } finally {
            pendingPatientsPromise = null;
        }
    })();

    return pendingPatientsPromise;
}

async function searchPatients(q = '', showAll = false) {
    const all = await getAllPatients();
    const query = (q || '').trim().toLowerCase();

    if (!query) {
        return showAll ? all : all.slice(0, 25);
    }

    return all.filter(p => {
        const idMatch = p.patient_id && p.patient_id.toLowerCase().includes(query);
        const nameMatch = p.name && p.name.toLowerCase().includes(query);
        const phoneMatch = p.phone && p.phone.toLowerCase().includes(query);
        const addressMatch = p.address && p.address.toLowerCase().includes(query);
        return idMatch || nameMatch || phoneMatch || addressMatch;
    }).slice(0, 100);
}

// High-speed stats derived directly from cached patients list (0 extra roundtrips!)
async function getStats() {
    const all = await getAllPatients();
    const todayStr = new Date().toDateString();
    let todayCount = 0;
    let rxCount = 0;

    for (const pt of all) {
        if (pt.created_at) {
            try {
                if (new Date(pt.created_at).toDateString() === todayStr) todayCount++;
            } catch (e) {}
        }
        if (Array.isArray(pt.prescriptions)) {
            rxCount += pt.prescriptions.length;
        } else if (pt.last_visit_date && pt.last_visit_date !== pt.created_at) {
            rxCount++;
        }
    }

    return {
        totalPatients: all.length,
        totalPrescriptions: rxCount,
        todayPatients: todayCount
    };
}

async function getPatientById(id) {
    const strId = String(id);
    const now = Date.now();
    const cachedEntry = cache.patientDetails[strId];
    if (cachedEntry && (now - cachedEntry.time) < CACHE_TTL_MS) {
        return cachedEntry.data;
    }

    if (pendingDetailPromises[strId]) {
        return pendingDetailPromises[strId];
    }

    pendingDetailPromises[strId] = (async () => {
        try {
            const patient = await request('get_patient', { id });
            if (patient && Array.isArray(patient.prescriptions)) {
                for (const rx of patient.prescriptions) {
                    if (!rx.medicines || rx.medicines.length === 0) {
                        try {
                            const fullRx = await getPrescriptionById(rx.rx_id);
                            if (fullRx && Array.isArray(fullRx.medicines)) {
                                rx.medicines = fullRx.medicines;
                            }
                        } catch (e) {}
                    }
                }
            }
            if (patient && !patient.error) {
                cache.patientDetails[strId] = { data: patient, time: Date.now() };
                if (patient.patient_id && patient.patient_id !== strId) {
                    cache.patientDetails[String(patient.patient_id)] = { data: patient, time: Date.now() };
                }
            }
            return patient;
        } finally {
            delete pendingDetailPromises[strId];
        }
    })();

    return pendingDetailPromises[strId];
}

async function createPatient(data) {
    const res = await request('create_patient', {}, 'POST', data);
    invalidateCache();
    return res;
}

async function updatePatient(id, data) {
    const res = await request('update_patient', {}, 'POST', { id, ...data });
    invalidateCache();
    return res;
}

async function deletePatient(id) {
    const res = await request('delete_patient', {}, 'POST', { id });
    invalidateCache();
    return res;
}

// ── Prescription Operations ──

async function createPrescription(data) {
    const res = await request('create_rx', {}, 'POST', data);
    invalidateCache();
    return res;
}

async function getPrescriptionById(rxId) {
    return await request('get_rx', { rxId });
}

module.exports = {
    isConfigured,
    getAllPatients,
    searchPatients,
    getStats,
    getPatientById,
    createPatient,
    updatePatient,
    deletePatient,
    createPrescription,
    getPrescriptionById,
    invalidateCache
};
