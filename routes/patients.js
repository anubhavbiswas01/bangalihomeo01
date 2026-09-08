const express = require('express');
const router = express.Router();
const db = require('../db/database');
const gsheet = require('../db/gsheet');

const useGSheet = () => gsheet.isConfigured();

// ── Generate next patient ID (PAT-00001, PAT-00002, …) ──
async function nextPatientId() {
    const row = await db.get('SELECT MAX(id) AS maxId FROM patients');
    const num = ((row && row.maxId) || 0) + 1;
    return 'PAT-' + String(num).padStart(5, '0');
}

// ── POST /api/patients — Create a new patient ──
router.post('/', async (req, res) => {
    try {
        const { name, age, gender, phone, address } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Patient name is required.' });
        }

        if (useGSheet()) {
            const newPt = await gsheet.createPatient({
                name: name.trim(),
                age: age ? parseInt(age, 10) : null,
                gender: gender || null,
                phone: phone ? phone.trim() : null,
                address: address ? address.trim() : null
            });
            return res.status(201).json(newPt);
        }

        const patientId = await nextPatientId();

        const result = await db.run(
            `INSERT INTO patients (patient_id, name, age, gender, phone, address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [patientId, name.trim(), age ? parseInt(age, 10) : null, gender || null, phone || null, address || null]
        );

        res.status(201).json({
            id: result.lastInsertRowid,
            patient_id: patientId,
            name: name.trim(),
            age, gender, phone, address
        });
    } catch (err) {
        console.error('Error creating patient:', err);
        res.status(500).json({ error: 'Failed to create patient: ' + err.message });
    }
});

// ── GET /api/patients — Return all registered patients ──
router.get('/', async (req, res) => {
    try {
        if (useGSheet()) {
            const patients = await gsheet.getAllPatients();
            return res.json(patients);
        }

        const patients = await db.all(
            `SELECT p.*,
                    COALESCE((SELECT MAX(created_at) FROM prescriptions WHERE patient_id = p.id OR patient_id = p.patient_id), p.created_at) AS last_visit_date
             FROM patients p
             ORDER BY p.id DESC`
        );
        res.json(patients);
    } catch (err) {
        console.error('Error fetching patients:', err);
        res.status(500).json({ error: 'Failed to fetch all patients.' });
    }
});

// ── GET /api/patients/stats — Summary counts for dashboard ──
router.get('/stats', async (req, res) => {
    try {
        if (useGSheet()) {
            const stats = await gsheet.getStats();
            return res.json(stats);
        }

        const pCount = (await db.get('SELECT COUNT(*) AS total FROM patients')) || { total: 0 };
        const rxCount = (await db.get('SELECT COUNT(*) AS total FROM prescriptions')) || { total: 0 };
        const todayCount = (await db.get(
            `SELECT COUNT(*) AS total FROM patients WHERE date(created_at) = date('now')`
        )) || { total: 0 };

        res.json({
            totalPatients: Number(pCount.total || 0),
            totalPrescriptions: Number(rxCount.total || 0),
            todayPatients: Number(todayCount.total || 0)
        });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// ── GET /api/patients/search?q= — Search by name, phone or patient ID (or return recent) ──
router.get('/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        const showAll = req.query.all === 'true';

        if (useGSheet()) {
            const patients = await gsheet.searchPatients(q, showAll);
            return res.json(patients);
        }

        if (!q) {
            if (showAll) {
                const allPatients = await db.all(
                    `SELECT p.*,
                            COALESCE((SELECT MAX(created_at) FROM prescriptions WHERE patient_id = p.id OR patient_id = p.patient_id), p.created_at) AS last_visit_date
                     FROM patients p
                     ORDER BY p.id DESC`
                );
                return res.json(allPatients);
            }
            // Return latest 25 registered patients for recent list
            const recent = await db.all(
                `SELECT p.*,
                        COALESCE((SELECT MAX(created_at) FROM prescriptions WHERE patient_id = p.id OR patient_id = p.patient_id), p.created_at) AS last_visit_date
                 FROM patients p
                 ORDER BY p.id DESC`
            );
            return res.json(recent.slice(0, 25));
        }

        const patients = await db.all(
            `SELECT p.*,
                    COALESCE((SELECT MAX(created_at) FROM prescriptions WHERE patient_id = p.id OR patient_id = p.patient_id), p.created_at) AS last_visit_date
             FROM patients p
             WHERE p.patient_id LIKE ? OR p.name LIKE ? OR p.phone LIKE ? OR p.address LIKE ?
             ORDER BY p.id DESC
             LIMIT 100`,
            [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
        );

        res.json(patients);
    } catch (err) {
        console.error('Error in search:', err);
        res.status(500).json({ error: 'Search failed.' });
    }
});

// ── GET /api/patients/:id — Patient details + prescription history ──
router.get('/:id', async (req, res) => {
    try {
        if (useGSheet()) {
            const patient = await gsheet.getPatientById(req.params.id);
            if (!patient || patient.error) {
                return res.status(404).json({ error: 'Patient not found.' });
            }
            return res.json(patient);
        }

        const patient = await db.get(
            'SELECT * FROM patients WHERE id = ? OR patient_id = ?',
            [req.params.id, req.params.id]
        );

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        const prescriptions = await db.all(
            `SELECT * FROM prescriptions
             WHERE patient_id = ? OR patient_id = ?
             ORDER BY created_at DESC`,
            [patient.id, patient.patient_id]
        );

        for (const rx of prescriptions) {
            rx.medicines = await db.all(
                'SELECT * FROM prescription_medicines WHERE prescription_id = ?',
                [rx.id]
            );
        }

        const lastVisitDate = (prescriptions && prescriptions.length > 0 && prescriptions[0].created_at)
            ? prescriptions[0].created_at
            : (patient.last_visit_date || patient.created_at);

        res.json({ ...patient, last_visit_date: lastVisitDate, prescriptions });
    } catch (err) {
        console.error('Error fetching patient:', err);
        res.status(500).json({ error: 'Failed to fetch patient.' });
    }
});

// ── PUT /api/patients/:id — Update existing patient details ──
router.put('/:id', async (req, res) => {
    try {
        const { name, age, gender, phone, address } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Patient name is required.' });
        }

        if (useGSheet()) {
            await gsheet.updatePatient(req.params.id, {
                name: name.trim(),
                age: age ? parseInt(age, 10) : null,
                gender: gender || null,
                phone: phone ? phone.trim() : null,
                address: address ? address.trim() : null
            });
            const updated = await gsheet.getPatientById(req.params.id);
            return res.json(updated);
        }

        const patient = await db.get(
            'SELECT * FROM patients WHERE id = ? OR patient_id = ?',
            [req.params.id, req.params.id]
        );

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        await db.run(
            `UPDATE patients
             SET name = ?, age = ?, gender = ?, phone = ?, address = ?
             WHERE id = ?`,
            [
                name.trim(),
                age ? parseInt(age, 10) : null,
                gender || null,
                phone ? phone.trim() : null,
                address ? address.trim() : null,
                patient.id
            ]
        );

        const updated = await db.get('SELECT * FROM patients WHERE id = ?', [patient.id]);
        res.json(updated);
    } catch (err) {
        console.error('Error updating patient:', err);
        res.status(500).json({ error: 'Failed to update patient details.' });
    }
});

// ── DELETE /api/patients/:id — Delete patient and related records ──
router.delete('/:id', async (req, res) => {
    try {
        if (useGSheet()) {
            await gsheet.deletePatient(req.params.id);
            return res.json({ success: true, message: `Patient ${req.params.id} deleted successfully.` });
        }

        const patient = await db.get(
            'SELECT * FROM patients WHERE id = ? OR patient_id = ?',
            [req.params.id, req.params.id]
        );

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        await db.transaction(async (tx) => {
            const rxList = await tx.all('SELECT id FROM prescriptions WHERE patient_id = ?', [patient.id]);
            for (const rx of rxList) {
                await tx.run('DELETE FROM prescription_medicines WHERE prescription_id = ?', [rx.id]);
            }
            await tx.run('DELETE FROM prescriptions WHERE patient_id = ?', [patient.id]);
            await tx.run('DELETE FROM patients WHERE id = ?', [patient.id]);
        });

        res.json({ success: true, message: `Patient ${patient.patient_id} deleted successfully.` });
    } catch (err) {
        console.error('Error deleting patient:', err);
        res.status(500).json({ error: 'Failed to delete patient.' });
    }
});

module.exports = router;
