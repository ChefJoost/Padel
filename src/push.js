const express = require('express');
const webpush = require('web-push');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const router = express.Router();

// VAPID keys: gebruik env vars (aanbevolen voor Railway), anders genereer en sla op
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const vapidFile = path.join(dataDir, 'vapid.json');

let vapidKeys;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  // Productie: gebruik env vars (stabiel over deploys heen)
  vapidKeys = {
    publicKey:  process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  };
} else if (fs.existsSync(vapidFile)) {
  // Bestaand bestand (alleen als DATA_DIR persistent volume is)
  vapidKeys = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} else {
  // Eerste keer: genereer en sla op (werkt alleen met persistent volume)
  vapidKeys = webpush.generateVAPIDKeys();
  try { fs.writeFileSync(vapidFile, JSON.stringify(vapidKeys)); } catch (_) {}
  console.log('=== VAPID keys gegenereerd ===');
  console.log('Stel deze in als Railway environment variables om ze te bewaren:');
  console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
  console.log('==============================');
}

webpush.setVapidDetails(
  'mailto:padel@padelplanner.app',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// Publieke VAPID key ophalen (voor client-side subscribe)
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

// Push-subscription verwijderen (bijv. na intrekken toestemming)
router.delete('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint vereist' });
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(req.session.userId, endpoint);
  res.json({ success: true });
});

// Push-subscription opslaan
router.post('/subscribe', requireAuth, (req, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Ongeldige subscription data' });
  }

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
      p256dh = excluded.p256dh, auth = excluded.auth
  `).run(req.session.userId, endpoint, p256dh, auth);

  res.json({ success: true });
});

// Stuur een push naar alle subscriptions van een bepaalde gebruiker
async function sendPushToUser(userId, payload) {
  const subs = db.prepare(
    'SELECT * FROM push_subscriptions WHERE user_id = ?'
  ).all(userId);

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      ).catch(err => {
        // Verwijder ongeldige subscriptions (410 Gone)
        if (err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
        throw err;
      })
    )
  );

  return results;
}

module.exports = { router, sendPushToUser };
