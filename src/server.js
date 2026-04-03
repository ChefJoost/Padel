const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();

// DATA_DIR env var voor cloud deployments (bijv. Railway persistent volume)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const SqliteStore = require('connect-sqlite3')(session);

// Weiger te starten zonder veilige session secret in productie
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is niet ingesteld. Gebruik een veilige willekeurige string in productie.');
}

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Beveiligingsheaders
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── In-memory rate limiter (geen extra dependency nodig) ──────────────────
// windowMs: tijdvenster in ms, maxRequests: max pogingen per IP per venster
function createRateLimiter(maxRequests, windowMs, message) {
  const store = new Map();
  // Periodiek verlopen entries opruimen
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of store.entries()) {
      const remaining = times.filter(t => t > cutoff);
      if (remaining.length === 0) store.delete(ip);
      else store.set(ip, remaining);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const times = (store.get(ip) || []).filter(t => t > cutoff);
    if (times.length >= maxRequests) {
      return res.status(429).json({ error: message });
    }
    times.push(now);
    store.set(ip, times);
    next();
  };
}

// Max 10 inlogpogingen per 15 minuten per IP
const loginLimiter = createRateLimiter(
  10, 15 * 60 * 1000,
  'Te veel inlogpogingen. Probeer het over 15 minuten opnieuw.'
);
// Max 5 registraties per uur per IP
const registerLimiter = createRateLimiter(
  5, 60 * 60 * 1000,
  'Te veel registratiepogingen. Probeer het later opnieuw.'
);

app.use(session({
  store: new SqliteStore({
    db: 'sessions.db',
    dir: dataDir,
  }),
  secret: process.env.SESSION_SECRET || 'padel-dev-only-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dagen
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Routes — rate limiters vóór de auth-routes
const authRouter = require('./auth');
app.post('/api/auth/login',    loginLimiter,    (req, res, next) => next());
app.post('/api/auth/register', registerLimiter, (req, res, next) => next());
app.use('/api/auth', authRouter);
app.use('/api/bookings', require('./bookings'));
app.use('/api/push', require('./push').router);
app.use('/api/admin', require('./admin'));

// Alle andere routes → index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Padel booking app draait op http://localhost:${PORT}`);
});
