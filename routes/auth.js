const express = require('express');
const router = express.Router();
const { sign, verify, requireAuth } = require('../middleware/auth');

// Default credentials (can be overridden via environment variables)
const CLINIC_PIN = process.env.CLINIC_PIN || '250717';
const CLINIC_PASSWORD = process.env.CLINIC_PASSWORD || 'drbakshi';

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { pin, password, credential, remember } = req.body || {};
    const input = (pin || password || credential || '').toString().trim();

    if (!input) {
        return res.status(400).json({ error: 'Please enter Doctor PIN or Password.' });
    }

    const isValid = (input === CLINIC_PIN) || (input === CLINIC_PASSWORD);

    if (!isValid) {
        return res.status(401).json({ error: 'Incorrect Doctor PIN or Password. Please try again.' });
    }

    // Remember for 30 days if checked, otherwise 24 hours
    const expiresInMs = remember ? (30 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const token = sign({
        role: 'doctor',
        doctorName: 'Dr. Sapan Bakshi',
        regNo: '30444'
    }, expiresInMs);

    res.json({
        ok: true,
        token,
        doctor: {
            name: 'Dr. Sapan Bakshi',
            qualification: 'BHMS (WBUMS) Kolkata',
            regNo: '30444'
        }
    });
});

// GET /api/auth/verify
router.get('/verify', requireAuth, (req, res) => {
    res.json({
        ok: true,
        authenticated: true,
        doctor: req.doctor
    });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.json({ ok: true, message: 'Logged out successfully.' });
});

module.exports = router;
