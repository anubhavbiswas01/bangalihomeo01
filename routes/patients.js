const express = require('express');
const router = express.Router();
const db = require('../db/database');

// ── Generate next patient ID (PAT-00001, PAT-00002, …) ──
function nextPatientId() {
    const row = db.get('SELECT MAX(id) AS maxId FROM patients');
    const num = ((row && row.maxId) || 0) + 1;
    return 'PAT-' + String(num).padStart(5, '0');
}

// ── POST /api/patients — Create a new patient ──
router.post('/', (req, res) => {
    try {
        const { name, age, gender, phone, address } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Patient name is required.' });
        }

        const patientId = nextPatientId();

        const result = db.run(
            `INSERT INTO patients (patient_id, name, age, gender, phone, address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [patientId, name.trim(), age || null, gender || null, phone || null, address || null]
        );

        res.status(201).json({
            id: result.lastInsertRowid,
            patient_id: patientId,
            name: name.trim(),
            age, gender, phone, address
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create patient.' });
    }
});

// ── GET /api/patients/stats — Summary counts for dashboard ──
router.get('/stats', (req, res) => {
    try {
        const pCount = db.get('SELECT COUNT(*) AS total FROM patients') || { total: 0 };
        const rxCount = db.get('SELECT COUNT(*) AS total FROM prescriptions') || { total: 0 };
        const todayCount = db.get(
            `SELECT COUNT(*) AS total FROM patients WHERE date(created_at) = date('now')`
        ) || { total: 0 };

        res.json({
            totalPatients: pCount.total || 0,
            totalPrescriptions: rxCount.total || 0,
            todayPatients: todayCount.total || 0
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// ── GET /api/patients/search?q= — Search by name, phone or patient ID (or return recent) ──
router.get('/search', (req, res) => {
    try {
        const q = (req.query.q || '').trim();

        if (!q) {
            // Return latest 25 registered patients for recent list
            const recent = db.all(
                `SELECT * FROM patients
                 ORDER BY id DESC
                 LIMIT 25`
            );
            return res.json(recent);
        }

        const patients = db.all(
            `SELECT * FROM patients
             WHERE patient_id LIKE ? OR name LIKE ? OR phone LIKE ?
             ORDER BY id DESC
             LIMIT 50`,
            [`%${q}%`, `%${q}%`, `%${q}%`]
        );

        res.json(patients);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Search failed.' });
    }
});

// ── GET /api/patients/:id — Patient details + prescription history ──
router.get('/:id', (req, res) => {
    try {
        const patient = db.get(
            'SELECT * FROM patients WHERE id = ? OR patient_id = ?',
            [req.params.id, req.params.id]
        );

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        const prescriptions = db.all(
            `SELECT * FROM prescriptions
             WHERE patient_id = ?
             ORDER BY created_at DESC`,
            [patient.id]
        );

        res.json({ ...patient, prescriptions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch patient.' });
    }
});

// ── PUT /api/patients/:id — Update existing patient details ──
router.put('/:id', (req, res) => {
    try {
        const { name, age, gender, phone, address } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Patient name is required.' });
        }

        const patient = db.get(
            'SELECT * FROM patients WHERE id = ? OR patient_id = ?',
            [req.params.id, req.params.id]
        );

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        db.run(
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

        const updated = db.get('SELECT * FROM patients WHERE id = ?', [patient.id]);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update patient details.' });
    }
});

// ── DELETE /api/patients/:id — Delete patient and related records ──
router.delete('/:id', (req, res) => {
    try {
        const patient = db.get(
            'SELECT * FROM patients WHERE id = ? OR patient_id = ?',
            [req.params.id, req.params.id]
        );

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found.' });
        }

        db.transaction(() => {
            const rxList = db.all('SELECT id FROM prescriptions WHERE patient_id = ?', [patient.id]);
            for (const rx of rxList) {
                db.run('DELETE FROM medicines WHERE prescription_id = ?', [rx.id]);
            }
            db.run('DELETE FROM prescriptions WHERE patient_id = ?', [patient.id]);
            db.run('DELETE FROM patients WHERE id = ?', [patient.id]);
        });

        res.json({ success: true, message: `Patient ${patient.patient_id} deleted successfully.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete patient.' });
    }
});

module.exports = router;


