const express = require('express');
const router = express.Router();
const mongo = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');

function getTodayIST() {
    const d = new Date();
    const istTime = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
    return istTime.toISOString().split('T')[0];
}

// ── POST /api/appointments — PUBLIC: Book an appointment ──
router.post('/', async (req, res) => {
    try {
        const { name, age, gender, mobile, preferred_date, reason } = req.body || {};

        // 1. Full Name validation
        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return res.status(400).json({ error: 'Please enter a valid Full Name (at least 2 characters).' });
        }

        // 2. Age validation
        const parsedAge = parseInt(age, 10);
        if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
            return res.status(400).json({ error: 'Please enter a valid age between 1 and 120.' });
        }

        // 3. Gender validation
        const validGenders = ['Male', 'Female', 'Other'];
        if (!gender || !validGenders.includes(gender)) {
            return res.status(400).json({ error: 'Please select a valid gender (Male, Female, or Other).' });
        }

        // 4. Mobile Number validation (Indian 10-digit format starting with 6-9)
        const cleanMobile = String(mobile || '').replace(/[\s\-+]/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
            return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9).' });
        }

        // 5. Preferred Date validation (YYYY-MM-DD, cannot be in the past)
        if (!preferred_date || !/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) {
            return res.status(400).json({ error: 'Please select a valid preferred date.' });
        }
        const todayIST = getTodayIST();
        if (preferred_date < todayIST) {
            return res.status(400).json({ error: 'Appointment date cannot be in the past. Please select today or a future date.' });
        }

        // 6. Reason for Visit validation
        if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
            return res.status(400).json({ error: 'Please enter the reason for your visit (e.g. Fever, Acidity, Joint Pain, Checkup).' });
        }

        if (!mongo.isConfigured()) {
            return res.status(503).json({ error: 'Database service is currently unavailable. Please call the clinic directly at 93042 75795.' });
        }

        const appointment = await mongo.createAppointment({
            name: name.trim(),
            age: parsedAge,
            gender: gender,
            mobile: cleanMobile,
            preferred_date: preferred_date,
            reason: reason.trim()
        });

        return res.status(201).json({
            ok: true,
            message: 'Appointment request submitted successfully!',
            reference_no: appointment.reference_no,
            appointment: {
                reference_no: appointment.reference_no,
                name: appointment.name,
                age: appointment.age,
                gender: appointment.gender,
                mobile: appointment.mobile,
                preferred_date: appointment.preferred_date,
                reason: appointment.reason,
                status: appointment.status,
                created_at: appointment.created_at
            }
        });
    } catch (err) {
        console.error('Error booking appointment:', err);
        return res.status(500).json({ error: 'Failed to process appointment request: ' + err.message });
    }
});

// ── GET /api/appointments — DOCTOR ONLY: List all appointments with filtering ──
router.get('/', requireAuth, async (req, res) => {
    try {
        if (!mongo.isConfigured()) {
            return res.status(503).json({ error: 'Database is not configured' });
        }
        const { status, date, q } = req.query;
        const appointments = await mongo.getAllAppointments({ status, date, q });
        res.json(appointments);
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).json({ error: 'Failed to fetch appointments: ' + err.message });
    }
});

// ── PATCH /api/appointments/:ref/status — DOCTOR ONLY: Update appointment status ──
router.patch('/:ref/status', requireAuth, async (req, res) => {
    try {
        const { ref } = req.params;
        const { status, notes } = req.body;

        const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        if (!mongo.isConfigured()) {
            return res.status(503).json({ error: 'Database is not configured' });
        }

        const updated = await mongo.updateAppointmentStatus(ref, status, notes);
        if (!updated) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        res.json({ ok: true, appointment: updated });
    } catch (err) {
        console.error('Error updating appointment status:', err);
        res.status(500).json({ error: 'Failed to update appointment: ' + err.message });
    }
});

// ── DELETE /api/appointments/:ref — DOCTOR ONLY: Delete an appointment ──
router.delete('/:ref', requireAuth, async (req, res) => {
    try {
        const { ref } = req.params;
        if (!mongo.isConfigured()) {
            return res.status(503).json({ error: 'Database is not configured' });
        }
        const deleted = await mongo.deleteAppointment(ref);
        if (!deleted) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        res.json({ ok: true, message: 'Appointment deleted successfully' });
    } catch (err) {
        console.error('Error deleting appointment:', err);
        res.status(500).json({ error: 'Failed to delete appointment: ' + err.message });
    }
});

module.exports = router;
