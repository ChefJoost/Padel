const express = require('express');
const db = require('./database');
const { sendPushToUser } = require('./push');

const router = express.Router();

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  next();
}

// Alle boekingen ophalen (toekomstig + vandaag)
router.get('/', requireAuth, (req, res) => {
  const bookings = db.prepare(`
    SELECT
      b.id, b.title, b.location, b.date, b.start_time, b.end_time, b.notes,
      b.created_by, b.payment_url,
      u.display_name AS creator_name,
      COUNT(CASE WHEN p.is_extra = 0 THEN 1 END) AS player_count,
      COUNT(CASE WHEN p.is_extra = 1 THEN 1 END) AS extra_count,
      MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS user_joined,
      MAX(CASE WHEN p.user_id = ? AND p.is_extra = 1 THEN 1 ELSE 0 END) AS user_is_extra,
      MAX(CASE WHEN p.user_id = ? THEN p.paid_at END) AS user_paid_at,
      MIN(CASE WHEN p.is_extra = 0 THEN u2.level END) AS min_level,
      MAX(CASE WHEN p.is_extra = 0 THEN u2.level END) AS max_level
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id
    LEFT JOIN users u2 ON p.user_id = u2.id
    WHERE b.date >= date('now', 'localtime')
    GROUP BY b.id
    ORDER BY b.date ASC, b.start_time ASC
  `).all(req.session.userId, req.session.userId, req.session.userId);

  res.json(bookings);
});

// Eén boeking ophalen met deelnemers
router.get('/:id', requireAuth, (req, res) => {
  const booking = db.prepare(`
    SELECT
      b.id, b.title, b.location, b.date, b.start_time, b.end_time, b.notes,
      b.created_by, b.payment_url,
      u.display_name AS creator_name,
      COUNT(CASE WHEN p.is_extra = 0 THEN 1 END) AS player_count,
      COUNT(CASE WHEN p.is_extra = 1 THEN 1 END) AS extra_count,
      MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS user_joined,
      MAX(CASE WHEN p.user_id = ? AND p.is_extra = 1 THEN 1 ELSE 0 END) AS user_is_extra,
      MAX(CASE WHEN p.user_id = ? THEN p.paid_at END) AS user_paid_at,
      MIN(CASE WHEN p.is_extra = 0 THEN u2.level END) AS min_level,
      MAX(CASE WHEN p.is_extra = 0 THEN u2.level END) AS max_level
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id
    LEFT JOIN users u2 ON p.user_id = u2.id
    WHERE b.id = ?
    GROUP BY b.id
  `).get(req.session.userId, req.session.userId, req.session.userId, req.params.id);

  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  const participants = db.prepare(`
    SELECT u.display_name, u.level, p.is_extra, p.joined_at
    FROM participants p
    JOIN users u ON p.user_id = u.id
    WHERE p.booking_id = ?
    ORDER BY p.is_extra ASC, p.joined_at ASC
  `).all(req.params.id);

  res.json({ ...booking, participants });
});

// Geschiedenis: afgelopen potjes van de ingelogde gebruiker
router.get('/history', requireAuth, (req, res) => {
  const bookings = db.prepare(`
    SELECT
      b.id, b.title, b.location, b.date, b.start_time, b.end_time,
      b.created_by, b.payment_url,
      u.display_name AS creator_name,
      p.is_extra, p.paid_at,
      COUNT(CASE WHEN p2.is_extra = 0 THEN 1 END) AS player_count
    FROM bookings b
    JOIN participants p ON b.id = p.booking_id AND p.user_id = ?
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p2 ON b.id = p2.booking_id
    WHERE b.date < date('now', 'localtime')
    GROUP BY b.id
    ORDER BY b.date DESC, b.start_time DESC
  `).all(req.session.userId);

  res.json(bookings);
});

// Nieuwe boeking aanmaken
router.post('/', requireAuth, (req, res) => {
  const { title, location, date, start_time, end_time, notes } = req.body;

  if (!title || !location || !date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Vul alle verplichte velden in' });
  }

  if (date < new Date().toISOString().split('T')[0]) {
    return res.status(400).json({ error: 'Datum mag niet in het verleden liggen' });
  }

  const result = db.prepare(`
    INSERT INTO bookings (title, location, date, start_time, end_time, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, location, date, start_time, end_time, notes || null, req.session.userId);

  // Aanmaker automatisch inschrijven als eerste speler
  db.prepare(`
    INSERT INTO participants (booking_id, user_id, is_extra) VALUES (?, ?, 0)
  `).run(result.lastInsertRowid, req.session.userId);

  res.status(201).json({ id: result.lastInsertRowid });
});

// Betaallink instellen/bijwerken (alleen aanmaker)
router.put('/:id/payment', requireAuth, async (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;
  const { payment_url } = req.body;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });
  if (booking.created_by !== userId) {
    return res.status(403).json({ error: 'Alleen de aanmaker kan de betaallink instellen' });
  }

  // Valideer URL
  if (payment_url) {
    try {
      const url = new URL(payment_url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: 'Ongeldige URL. Gebruik https://...' });
    }
  }

  db.prepare('UPDATE bookings SET payment_url = ? WHERE id = ?')
    .run(payment_url || null, bookingId);

  // Stuur push-notificatie naar alle andere deelnemers als er een URL is ingesteld
  if (payment_url) {
    const participants = db.prepare(`
      SELECT DISTINCT user_id FROM participants WHERE booking_id = ? AND user_id != ?
    `).all(bookingId, userId);

    const creatorName = db.prepare('SELECT display_name FROM users WHERE id = ?')
      .get(userId)?.display_name || 'De organisator';

    await Promise.allSettled(
      participants.map(p =>
        sendPushToUser(p.user_id, {
          title: '💳 Betaallink beschikbaar',
          body: `${creatorName} heeft een betaallink toegevoegd voor "${booking.title}"`,
          url: '/',
        })
      )
    );
  }

  res.json({ success: true });
});

// Betaling markeren als voldaan
router.post('/:id/pay', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;

  const participant = db.prepare(
    'SELECT * FROM participants WHERE booking_id = ? AND user_id = ?'
  ).get(bookingId, userId);

  if (!participant) return res.status(404).json({ error: 'Je bent niet ingeschreven voor deze boeking' });

  db.prepare('UPDATE participants SET paid_at = CURRENT_TIMESTAMP WHERE booking_id = ? AND user_id = ?')
    .run(bookingId, userId);

  res.json({ success: true });
});

// Inschrijven voor een boeking
router.post('/:id/join', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  // Al ingeschreven?
  const existing = db.prepare(
    'SELECT * FROM participants WHERE booking_id = ? AND user_id = ?'
  ).get(bookingId, userId);
  if (existing) return res.status(409).json({ error: 'Je bent al ingeschreven' });

  // Tel huidige spelers
  const counts = db.prepare(`
    SELECT
      COUNT(CASE WHEN is_extra = 0 THEN 1 END) AS players,
      COUNT(CASE WHEN is_extra = 1 THEN 1 END) AS extras
    FROM participants WHERE booking_id = ?
  `).get(bookingId);

  let isExtra = 0;
  if (counts.players >= 4) {
    if (counts.extras >= 1) {
      return res.status(409).json({ error: 'De boeking is vol (4 spelers + 1 extra)' });
    }
    isExtra = 1;
  }

  // Niveau-check: max 2 aansluitende niveaus toegestaan
  const user = db.prepare('SELECT level FROM users WHERE id = ?').get(userId);
  if (user.level) {
    const levelRange = db.prepare(`
      SELECT
        MIN(u.level) AS min_level,
        MAX(u.level) AS max_level
      FROM participants p
      JOIN users u ON p.user_id = u.id
      WHERE p.booking_id = ? AND p.is_extra = 0 AND u.level IS NOT NULL
    `).get(bookingId);

    if (levelRange.min_level !== null) {
      const newMin = Math.min(user.level, levelRange.min_level);
      const newMax = Math.max(user.level, levelRange.max_level);
      if (newMax - newMin > 1) {
        return res.status(400).json({
          error: `Jouw niveau (${user.level}) past niet bij dit potje (niveaus ${levelRange.min_level}–${levelRange.max_level}). Maximaal 2 aansluitende niveaus toegestaan.`,
        });
      }
    }
  }

  db.prepare(
    'INSERT INTO participants (booking_id, user_id, is_extra) VALUES (?, ?, ?)'
  ).run(bookingId, userId, isExtra);

  res.json({ success: true, is_extra: isExtra === 1 });
});

// Uitschrijven uit een boeking
router.delete('/:id/join', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  if (booking.created_by === userId) {
    return res.status(400).json({ error: 'Als aanmaker kun je niet uitschrijven. Verwijder de boeking.' });
  }

  const result = db.prepare(
    'DELETE FROM participants WHERE booking_id = ? AND user_id = ?'
  ).run(bookingId, userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Je bent niet ingeschreven voor deze boeking' });
  }

  // Als een reguliere speler uitschrijft, promoveer extra naar regulier
  const extra = db.prepare(
    'SELECT * FROM participants WHERE booking_id = ? AND is_extra = 1 ORDER BY joined_at ASC LIMIT 1'
  ).get(bookingId);

  if (extra) {
    db.prepare('UPDATE participants SET is_extra = 0 WHERE id = ?').run(extra.id);
  }

  res.json({ success: true });
});

// Boeking verwijderen (alleen aanmaker)
router.delete('/:id', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  if (booking.created_by !== userId) {
    return res.status(403).json({ error: 'Alleen de aanmaker kan de boeking verwijderen' });
  }

  db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
  res.json({ success: true });
});

module.exports = router;
