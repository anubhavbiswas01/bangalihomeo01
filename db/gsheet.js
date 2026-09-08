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

// Local cache to keep dashboard and search fast
let cache = {
    patients: null,
    stats: null,
    lastFetched: 0
};
const CACHE_TTL_MS = 10000; // 10 seconds

function invalidateCache() {
    cache.patients = null;
    cache.stats = null;
    cache.lastFetched = 0;
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

// ── Patient Operations ──

async function getAllPatients() {
    const now = Date.now();
    if (cache.patients && (now - cache.lastFetched) < CACHE_TTL_MS) {
        return cache.patients;
    }
    const patients = await request('get_all');
    cache.patients = patients;
    cache.lastFetched = now;
    return patients;
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

async function getStats() {
    const now = Date.now();
    if (cache.stats && (now - cache.lastFetched) < CACHE_TTL_MS) {
        return cache.stats;
    }
    const stats = await request('stats');
    cache.stats = stats;
    return stats;
}

async function getPatientById(id) {
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
    return patient;
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
