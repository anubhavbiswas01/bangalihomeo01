const express = require('express');
const router = express.Router();
const mongo = require('../db/mongodb');

// ── GET /api/medicines — Get all medicines for catalog and autocomplete ──
router.get('/', async (req, res) => {
    try {
        if (mongo.isConfigured()) {
            try {
                const meds = await mongo.getAllMedicines();
                return res.json(meds);
            } catch (err) {
                console.warn('MongoDB getAllMedicines error, using default list:', err.message);
            }
        }
        // Fallback default list
        res.json(mongo.DEFAULT_MEDICINES || []);
    } catch (err) {
        console.error('Error fetching medicines:', err);
        res.status(500).json({ error: 'Failed to fetch medicines: ' + err.message });
    }
});

// ── POST /api/medicines — Add a new medicine to the database ──
router.post('/', async (req, res) => {
    try {
        const { name, common_potencies, default_dosage, default_frequency, default_duration, indication } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Medicine name is required.' });
        }

        if (mongo.isConfigured()) {
            const newMed = await mongo.addMedicine({
                name: name.trim(),
                common_potencies: Array.isArray(common_potencies) ? common_potencies : (common_potencies ? [common_potencies] : ['30C', '200C', '1M', 'Q']),
                default_dosage: default_dosage || '4 pills',
                default_frequency: default_frequency || '3 times daily',
                default_duration: default_duration || '7 Days',
                indication: indication || ''
            });
            return res.status(201).json(newMed);
        }

        res.status(201).json({
            name: name.trim(),
            common_potencies: ['30C', '200C', '1M', 'Q'],
            default_dosage: default_dosage || '4 pills',
            default_frequency: default_frequency || '3 times daily',
            default_duration: default_duration || '7 Days',
            indication: indication || ''
        });
    } catch (err) {
        console.error('Error adding medicine:', err);
        res.status(400).json({ error: err.message });
    }
});

// ── DELETE /api/medicines/:name — Delete a medicine from the database ──
router.delete('/:name', async (req, res) => {
    try {
        const name = req.params.name;
        if (mongo.isConfigured()) {
            const deleted = await mongo.deleteMedicine(name);
            if (!deleted) {
                return res.status(404).json({ error: 'Medicine not found.' });
            }
            return res.json({ success: true, message: `Medicine "${name}" deleted.` });
        }
        res.json({ success: true, message: `Medicine "${name}" deleted.` });
    } catch (err) {
        console.error('Error deleting medicine:', err);
        res.status(500).json({ error: 'Failed to delete medicine: ' + err.message });
    }
});

module.exports = router;
