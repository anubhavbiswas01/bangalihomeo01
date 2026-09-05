const express = require('express');
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/patients', require('./routes/patients'));
app.use('/api/prescriptions', require('./routes/prescriptions'));

// Ensure DB is initialized before requests (especially on serverless Vercel)
let dbReady = false;
let dbInitPromise = null;
app.use(async (req, res, next) => {
    if (!dbReady) {
        if (!dbInitPromise) dbInitPromise = db.init();
        await dbInitPromise;
        dbReady = true;
    }
    next();
});

// Fallback — serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Standalone start (for local and platforms like Render)
if (require.main === module) {
    db.init().then(() => {
        app.listen(PORT, () => {
            console.log(`✅ Prescription Manager running at http://localhost:${PORT}`);
        });
    }).catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });
}

module.exports = app;

