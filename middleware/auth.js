const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'bengali-homeo-clinic-secure-doctor-secret-key-30444';

function base64url(str) {
    return Buffer.from(str).toString('base64url');
}

function unbase64url(str) {
    return Buffer.from(str, 'base64url').toString('utf8');
}

function sign(payload, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
    const data = {
        ...payload,
        iat: Date.now(),
        exp: Date.now() + expiresInMs
    };
    const payloadStr = base64url(JSON.stringify(data));
    const hmac = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
    return `${payloadStr}.${hmac}`;
}

function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadStr, expectedHmac] = parts;
    const actualHmac = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');

    try {
        const bufA = Buffer.from(expectedHmac);
        const bufB = Buffer.from(actualHmac);
        if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
            return null;
        }
    } catch {
        return null;
    }

    try {
        const payload = JSON.parse(unbase64url(payloadStr));
        if (payload.exp && payload.exp < Date.now()) {
            return null; // Expired
        }
        return payload;
    } catch {
        return null;
    }
}

// Express middleware
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'Doctor login required' });
    }

    const doctor = verify(token);
    if (!doctor) {
        return res.status(401).json({ error: 'Session expired or invalid. Please login again.' });
    }

    req.doctor = doctor;
    next();
}

module.exports = {
    sign,
    verify,
    requireAuth
};
