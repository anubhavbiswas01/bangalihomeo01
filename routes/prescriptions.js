const express = require('express');
const router = express.Router();
const db = require('../db/database');
const mongo = require('../db/mongodb');

const useMongo = () => mongo.isConfigured();

// ── Generate next Rx ID (RX-00001, RX-00002, …) ──
async function nextRxId() {
    if (useMongo()) {
        const ids = await mongo.getNextRxId();
        return ids.code;
    }
    const row = await db.get('SELECT MAX(id) AS maxId FROM prescriptions');
    const num = ((row && row.maxId) || 0) + 1;
    return 'RX-' + String(num).padStart(5, '0');
}

// ── POST /api/prescriptions — Create a new prescription ──
router.post('/', async (req, res) => {
    try {
        const { patient_id, complaints, diagnosis, tests, next_visit_date, notes, medicines, previous_visit_date } = req.body;

        if (!patient_id) {
            return res.status(400).json({ error: 'Patient ID is required.' });
        }

        const medList = Array.isArray(medicines) ? medicines : [];

        let ptNumId = patient_id;
        let ptCode = patient_id;
        let ptDetails = null;
        try {
            if (useMongo()) {
                const pt = await mongo.getPatientById(patient_id);
                if (pt) {
                    ptNumId = pt.id;
                    ptCode = pt.patient_id;
                    ptDetails = pt;
                }
            } else {
                const pt = await db.get('SELECT * FROM patients WHERE id = ? OR patient_id = ?', [patient_id, patient_id]);
                if (pt) {
                    ptNumId = pt.id;
                    ptCode = pt.patient_id;
                    ptDetails = pt;
                }
            }
        } catch (e) {
            console.warn('Could not lookup patient code for Rx:', e.message);
        }

        let prevDate = previous_visit_date || null;
        if (!prevDate && ptDetails && Array.isArray(ptDetails.prescriptions) && ptDetails.prescriptions.length > 0) {
            prevDate = ptDetails.prescriptions[0].created_at || ptDetails.prescriptions[0].date;
        }

        if (useMongo()) {
            const newRx = await mongo.createPrescription({
                patient_id: ptCode || patient_id,
                complaints,
                diagnosis,
                tests: tests || '',
                next_visit_date: next_visit_date || null,
                notes,
                medicines: medList,
                previous_visit_date: prevDate
            });
            return res.status(201).json({
                ...newRx,
                patient_code: ptCode || patient_id,
                medicines: medList,
                previous_visit_date: prevDate,
                next_visit_date: next_visit_date || null
            });
        }

        const rxId = await nextRxId();
        const nowIso = new Date().toISOString();

        const prescriptionId = await db.transaction(async (tx) => {
            let result;
            try {
                result = await tx.run(
                    `INSERT INTO prescriptions (rx_id, patient_id, complaints, diagnosis, tests, next_visit_date, notes, previous_visit_date, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [rxId, ptNumId, complaints || '', diagnosis || '', tests || '', next_visit_date || null, notes || '', prevDate || null, nowIso]
                );
            } catch (_) {
                // Fallback if next_visit_date or tests column not yet added
                try {
                    result = await tx.run(
                        `INSERT INTO prescriptions (rx_id, patient_id, complaints, diagnosis, tests, notes, previous_visit_date, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [rxId, ptNumId, complaints || '', diagnosis || '', tests || '', notes || '', prevDate || null, nowIso]
                    );
                } catch (__) {
                    result = await tx.run(
                        `INSERT INTO prescriptions (rx_id, patient_id, complaints, diagnosis, notes, previous_visit_date, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [rxId, ptNumId, complaints || '', diagnosis || '', notes || '', prevDate || null, nowIso]
                    );
                }
            }
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

            // Update patient's last_visit_date and next_visit_date in local DB
            try {
                await tx.run(
                    `UPDATE patients SET last_visit_date = ?, next_visit_date = ? WHERE id = ? OR patient_id = ?`,
                    [nowIso, next_visit_date || null, ptNumId, ptCode]
                );
            } catch (_) {
                await tx.run(
                    `UPDATE patients SET last_visit_date = ? WHERE id = ? OR patient_id = ?`,
                    [nowIso, ptNumId, ptCode]
                );
            }

            return pId;
        });

        res.status(201).json({
            id: prescriptionId,
            rx_id: rxId,
            patient_id,
            complaints,
            diagnosis,
            tests: tests || '',
            next_visit_date: next_visit_date || null,
            notes,
            previous_visit_date: prevDate,
            medicines: medList,
            created_at: nowIso
        });
    } catch (err) {
        console.error('Error creating prescription:', err);
        res.status(500).json({ error: 'Failed to create prescription: ' + err.message });
    }
});

// ── GET /api/prescriptions/:rxId — Get full prescription for print ──
router.get('/:rxId', async (req, res) => {
    try {
        if (useMongo()) {
            const rx = await mongo.getPrescriptionById(req.params.rxId);
            if (!rx) {
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

// ── DELETE /api/prescriptions/:rxId — Delete prescription ──
router.delete('/:rxId', async (req, res) => {
    try {
        const { rxId } = req.params;
        if (useMongo()) {
            const success = await mongo.deletePrescription(rxId);
            if (!success) {
                return res.status(404).json({ error: 'Prescription not found.' });
            }
            return res.json({ success: true, message: 'Prescription deleted successfully.' });
        }

        const rx = await db.get('SELECT id, patient_id FROM prescriptions WHERE rx_id = ? OR id = ?', [rxId, rxId]);
        if (!rx) {
            return res.status(404).json({ error: 'Prescription not found.' });
        }

        await db.run('DELETE FROM prescription_medicines WHERE prescription_id = ?', [rx.id]);
        await db.run('DELETE FROM prescriptions WHERE id = ?', [rx.id]);

        // Recalculate patient's last visit & next visit
        const lastRx = await db.get('SELECT created_at, next_visit_date FROM prescriptions WHERE patient_id = ? ORDER BY id DESC LIMIT 1', [rx.patient_id]);
        if (lastRx) {
            await db.run('UPDATE patients SET last_visit_date = ?, next_visit_date = ? WHERE id = ?', [lastRx.created_at, lastRx.next_visit_date, rx.patient_id]);
        } else {
            const pt = await db.get('SELECT created_at FROM patients WHERE id = ?', [rx.patient_id]);
            if (pt) {
                await db.run('UPDATE patients SET last_visit_date = ?, next_visit_date = NULL WHERE id = ?', [pt.created_at, rx.patient_id]);
            }
        }

        res.json({ success: true, message: 'Prescription deleted successfully.' });
    } catch (err) {
        console.error('Error deleting prescription:', err);
        res.status(500).json({ error: 'Failed to delete prescription: ' + err.message });
    }
});

module.exports = router;
