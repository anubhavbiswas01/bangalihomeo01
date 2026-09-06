const express = require('express');
const router = express.Router();
const db = require('../db/database');
const gsheet = require('../db/gsheet');

// ── Generate next Rx ID (RX-00001, RX-00002, …) ──
async function nextRxId() {
    const row = await db.get('SELECT MAX(id) AS maxId FROM prescriptions');
    const num = ((row && row.maxId) || 0) + 1;
    return 'RX-' + String(num).padStart(5, '0');
}

// ── POST /api/prescriptions — Create a new prescription ──
router.post('/', async (req, res) => {
    try {
        const { patient_id, complaints, diagnosis, notes, medicines } = req.body;

        if (!patient_id) {
            return res.status(400).json({ error: 'Patient ID is required.' });
        }

        const medList = Array.isArray(medicines) ? medicines : [];

        let ptNumId = patient_id;
        let ptCode = patient_id;
        try {
            const ptRow = await db.get('SELECT id, patient_id FROM patients WHERE id = ? OR patient_id = ?', [patient_id, patient_id]);
            if (ptRow) {
                ptNumId = ptRow.id;
                ptCode = ptRow.patient_id;
            }
        } catch (e) {
            // Ignore if DB not reachable
        }

        if (gsheet.isConfigured()) {
            const newRx = await gsheet.createPrescription({
                patient_id: ptCode || patient_id,
                complaints,
                diagnosis,
                notes,
                medicines: medList
            });
            return res.status(201).json(newRx);
        }
        const rxId = await nextRxId();

        const prescriptionId = await db.transaction(async (tx) => {
            const result = await tx.run(
                `INSERT INTO prescriptions (rx_id, patient_id, complaints, diagnosis, notes)
                 VALUES (?, ?, ?, ?, ?)`,
                [rxId, ptNumId, complaints || '', diagnosis || '', notes || '']
            );
            const pId = result.lastInsertRowid;

            for (const med of medList) {
                if (med.medicine_name && med.medicine_name.trim()) {
                    await tx.run(
                        `INSERT INTO prescription_medicines (prescription_id, medicine_name, dosage, frequency, duration)
                         VALUES (?, ?, ?, ?, ?)`,
                        [pId, med.medicine_name.trim(), med.dosage || '', med.frequency || '', med.duration || '']
                    );
                }
            }

            return pId;
        });

        res.status(201).json({
            id: prescriptionId,
            rx_id: rxId,
            patient_id,
            complaints,
            diagnosis,
            notes
        });
    } catch (err) {
        console.error('Error creating prescription:', err);
        res.status(500).json({ error: 'Failed to create prescription.' });
    }
});

// ── GET /api/prescriptions/:rxId — Get full prescription for print ──
router.get('/:rxId', async (req, res) => {
    try {
        if (gsheet.isConfigured()) {
            const rx = await gsheet.getPrescriptionById(req.params.rxId);
            if (!rx || rx.error) {
                return res.status(404).json({ error: 'Prescription not found.' });
            }
            return res.json(rx);
        }

        const prescription = await db.get(
            `SELECT p.*, pt.patient_id AS patient_code, pt.name, pt.age, pt.gender, pt.phone, pt.address,
                    pt.created_at AS patient_created_at,
                    (SELECT MAX(created_at) FROM prescriptions WHERE patient_id = p.patient_id AND id != p.id AND created_at <= p.created_at) AS previous_visit_date
             FROM prescriptions p
             JOIN patients pt ON pt.id = p.patient_id
             WHERE p.rx_id = ? OR p.id = ?`,
            [req.params.rxId, req.params.rxId]
        );

        if (!prescription) {
            return res.status(404).json({ error: 'Prescription not found.' });
        }

        const medicines = await db.all(
            'SELECT * FROM prescription_medicines WHERE prescription_id = ?',
            [prescription.id]
        );

        res.json({ ...prescription, medicines });
    } catch (err) {
        console.error('Error fetching prescription:', err);
        res.status(500).json({ error: 'Failed to fetch prescription.' });
    }
});

module.exports = router;
