// ============================================================
// DATA MIGRATION SCRIPT: GOOGLE SHEETS -> MONGODB
// Safely transfers all patients, prescriptions, and medicines
// ============================================================

const fs = require('fs');
const path = require('path');
const mongo = require('../db/mongodb');

const GSHEET_URL = 'https://script.google.com/macros/s/AKfycbxwypco_TCcEFQUdGZzJJG1CoLRoCIlCAmEMKcChVGq1y91SErBL_1HnSIA5P6sR5mg/exec';

async function fetchJson(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}

async function runMigration() {
    console.log('🚀 Starting Migration: Google Sheets ➔ MongoDB');
    console.log('----------------------------------------------------');

    if (!mongo.isConfigured()) {
        console.error('❌ MONGODB_URI is not configured in environment or .env!');
        console.error('Please set MONGODB_URI and run again.');
        process.exit(1);
    }

    const db = await mongo.connect();
    console.log('✅ Connected to MongoDB successfully.');

    // 1. Fetch all patients from Google Sheets
    console.log('📥 Fetching all patient records from Google Sheets...');
    const patients = await fetchJson(`${GSHEET_URL}?action=get_all`);
    console.log(`✅ Fetched ${patients.length} patients from Google Sheets.`);

    const patientsCollection = db.collection('patients');
    const rxCollection = db.collection('prescriptions');

    let migratedPatients = 0;
    let migratedPrescriptions = 0;

    for (const pt of patients) {
        // Check if patient already exists in MongoDB
        const existing = await patientsCollection.findOne({ patient_id: pt.patient_id });
        if (!existing) {
            await patientsCollection.insertOne({
                id: Number(pt.id),
                patient_id: String(pt.patient_id),
                name: String(pt.name || ''),
                age: pt.age ? Number(pt.age) : null,
                gender: String(pt.gender || ''),
                phone: String(pt.phone || ''),
                address: String(pt.address || ''),
                created_at: pt.created_at || new Date().toISOString(),
                last_visit_date: pt.last_visit_date || pt.created_at || new Date().toISOString()
            });
            migratedPatients++;
        }

        // Fetch prescriptions for this patient
        try {
            const detail = await fetchJson(`${GSHEET_URL}?action=get_patient&id=${pt.patient_id}`);
            if (detail && Array.isArray(detail.prescriptions) && detail.prescriptions.length > 0) {
                for (const rx of detail.prescriptions) {
                    const existingRx = await rxCollection.findOne({ rx_id: rx.rx_id });
                    if (!existingRx) {
                        // Fetch medicines for this prescription if needed
                        let meds = rx.medicines || [];
                        if (!meds || meds.length === 0) {
                            try {
                                const rxDetail = await fetchJson(`${GSHEET_URL}?action=get_rx&rxId=${rx.rx_id}`);
                                if (rxDetail && Array.isArray(rxDetail.medicines)) {
                                    meds = rxDetail.medicines;
                                }
                            } catch (_) {}
                        }

                        await rxCollection.insertOne({
                            id: Number(rx.id),
                            rx_id: String(rx.rx_id),
                            patient_id: String(pt.patient_id),
                            complaints: String(rx.complaints || ''),
                            diagnosis: String(rx.diagnosis || ''),
                            notes: String(rx.notes || ''),
                            previous_visit_date: rx.previous_visit_date || null,
                            medicines: meds,
                            created_at: rx.created_at || new Date().toISOString()
                        });
                        migratedPrescriptions++;
                    }
                }
            }
        } catch (err) {
            console.warn(`⚠️ Warning fetching prescriptions for ${pt.patient_id}:`, err.message);
        }
    }

    console.log('----------------------------------------------------');
    console.log(`🎉 Migration Completed!`);
    console.log(`👥 Patients Migrated: ${migratedPatients} / ${patients.length}`);
    console.log(`💊 Prescriptions Migrated: ${migratedPrescriptions}`);
    console.log('----------------------------------------------------');
}

if (require.main === module) {
    runMigration().then(() => process.exit(0)).catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
}

module.exports = { runMigration };
