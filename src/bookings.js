const express = require('express');
const crypto = require('crypto');
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
  const userId = req.session.userId;

  const bookings = db.prepare(`
    SELECT
      b.id, b.title, b.date, b.start_time, b.end_time, b.notes,
      b.created_by, b.payment_url, b.is_private,
      u.display_name AS creator_name,
      COUNT(p.id) + COALESCE((SELECT COUNT(*) FROM booking_guests bg WHERE bg.booking_id = b.id), 0) AS player_count,
      MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS user_joined,
      MAX(CASE WHEN p.user_id = ? THEN p.paid_at END) AS user_paid_at,
      MIN(u2.level) AS min_level,
      MAX(u2.level) AS max_level,
      (SELECT GROUP_CONCAT(name, '||')
       FROM (SELECT u3.display_name AS name, p3.joined_at AS ts FROM participants p3
             JOIN users u3 ON p3.user_id = u3.id WHERE p3.booking_id = b.id
             UNION ALL
             SELECT bg2.guest_name AS name, bg2.added_at AS ts
             FROM booking_guests bg2 WHERE bg2.booking_id = b.id
             ORDER BY ts ASC)) AS participants_names
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id
    LEFT JOIN users u2 ON p.user_id = u2.id
    WHERE b.date >= date('now', 'localtime')
      AND (b.is_private = 0
           OR b.created_by = ?
           OR EXISTS (SELECT 1 FROM participants WHERE booking_id = b.id AND user_id = ?))
    GROUP BY b.id
    ORDER BY b.date ASC, b.start_time ASC
  `).all(userId, userId, userId, userId);

  res.json(bookings);
});

// Boeking ophalen via uitnodigingstoken (voor privé potjes)
router.get('/invite/:token', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const booking = db.prepare(`
    SELECT
      b.id, b.title, b.date, b.start_time, b.end_time, b.notes,
      b.created_by, b.payment_url, b.is_private, b.invite_token,
      u.display_name AS creator_name,
      COUNT(p.id) AS player_count,
      MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS user_joined,
      MAX(CASE WHEN p.user_id = ? THEN p.paid_at END) AS user_paid_at,
      MIN(u2.level) AS min_level,
      MAX(u2.level) AS max_level
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id
    LEFT JOIN users u2 ON p.user_id = u2.id
    WHERE b.invite_token = ?
    GROUP BY b.id
  `).get(userId, userId, req.params.token);

  if (!booking) return res.status(404).json({ error: 'Uitnodiging niet gevonden' });

  const participants = db.prepare(`
    SELECT u.display_name, u.level, u.avatar, p.joined_at
    FROM participants p JOIN users u ON p.user_id = u.id
    WHERE p.booking_id = ? ORDER BY p.joined_at ASC
  `).all(booking.id);

  res.json({ ...booking, participants });
});

// Eén boeking ophalen met deelnemers
router.get('/:id', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const bookingId = req.params.id;
  const booking = db.prepare(`
    SELECT
      b.id, b.title, b.location, b.date, b.start_time, b.end_time, b.notes,
      b.created_by, b.payment_url, b.is_private, b.invite_token,
      u.display_name AS creator_name,
      COUNT(p.id) + COALESCE((SELECT COUNT(*) FROM booking_guests bg WHERE bg.booking_id = b.id), 0) AS player_count,
      MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS user_joined,
      MAX(CASE WHEN p.user_id = ? THEN p.paid_at END) AS user_paid_at,
      MIN(u2.level) AS min_level,
      MAX(u2.level) AS max_level
    FROM bookings b
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id
    LEFT JOIN users u2 ON p.user_id = u2.id
    WHERE b.id = ?
    GROUP BY b.id
  `).get(userId, userId, bookingId);

  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  // Privé: alleen toegankelijk voor aanmaker en deelnemers
  if (booking.is_private && booking.created_by !== userId && !booking.user_joined) {
    return res.status(403).json({ error: 'Dit is een privé potje' });
  }

  const regularPlayers = db.prepare(`
    SELECT p.id, u.display_name, u.level, u.avatar, p.joined_at,
           0 AS is_guest, NULL AS guest_name, NULL AS added_by
    FROM participants p
    JOIN users u ON p.user_id = u.id
    WHERE p.booking_id = ?
    ORDER BY p.joined_at ASC
  `).all(bookingId);

  const guests = db.prepare(`
    SELECT id, NULL AS display_name, NULL AS level, NULL AS avatar, added_at AS joined_at,
           1 AS is_guest, guest_name, added_by
    FROM booking_guests
    WHERE booking_id = ?
    ORDER BY added_at ASC
  `).all(bookingId);

  const participants = [...regularPlayers, ...guests]
    .sort((a, b) => (a.joined_at || '') < (b.joined_at || '') ? -1 : 1)
    .map(p => p.is_guest ? { ...p, display_name: p.guest_name } : p);

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
    JOIN users u ON b.created_by = u.id
    LEFT JOIN participants p ON b.id = p.booking_id AND p.user_id = ?
    LEFT JOIN participants p2 ON b.id = p2.booking_id
    WHERE b.date < date('now', 'localtime')
      AND (p.user_id IS NOT NULL OR b.created_by = ?)
    GROUP BY b.id
    ORDER BY b.date DESC, b.start_time DESC
  `).all(req.session.userId, req.session.userId);

  res.json(bookings);
});

// Nieuwe boeking aanmaken
router.post('/', requireAuth, (req, res) => {
  const { title, date, start_time, end_time, notes, is_private } = req.body;

  if (!title || !date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Vul alle verplichte velden in' });
  }

  if (date < new Date().toISOString().split('T')[0]) {
    return res.status(400).json({ error: 'Datum mag niet in het verleden liggen' });
  }

  const privateFlag = is_private ? 1 : 0;
  const inviteToken = is_private ? crypto.randomBytes(16).toString('hex') : null;

  const result = db.prepare(`
    INSERT INTO bookings (title, location, date, start_time, end_time, notes, created_by, is_private, invite_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, '', date, start_time, end_time, notes || null, req.session.userId, privateFlag, inviteToken);

  // Aanmaker automatisch inschrijven als eerste speler
  db.prepare(`
    INSERT INTO participants (booking_id, user_id, is_extra) VALUES (?, ?, 0)
  `).run(result.lastInsertRowid, req.session.userId);

  res.status(201).json({ id: result.lastInsertRowid });
});

// Boeking bewerken (alleen aanmaker)
router.put('/:id', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;
  const { title, date, start_time, end_time, notes, is_private } = req.body;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });
  if (booking.created_by !== userId) {
    return res.status(403).json({ error: 'Alleen de aanmaker kan de boeking bewerken' });
  }

  if (!title || !date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Vul alle verplichte velden in' });
  }

  // Privé-status kan wijzigen: genereer token als nieuw privé, wis token als openbaar gemaakt
  const privateFlag = is_private ? 1 : 0;
  let inviteToken = booking.invite_token;
  if (is_private && !inviteToken) {
    inviteToken = crypto.randomBytes(16).toString('hex');
  } else if (!is_private) {
    inviteToken = null;
  }

  db.prepare(`
    UPDATE bookings SET title=?, date=?, start_time=?, end_time=?, notes=?, is_private=?, invite_token=? WHERE id=?
  `).run(title, date, start_time, end_time, notes || null, privateFlag, inviteToken, bookingId);

  res.json({ success: true });
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
  const token = req.query.token || null;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  // Privé: token verplicht (tenzij aanmaker of al deelnemer)
  if (booking.is_private && booking.created_by !== userId) {
    const isParticipant = db.prepare(
      'SELECT 1 FROM participants WHERE booking_id = ? AND user_id = ?'
    ).get(bookingId, userId);
    if (!isParticipant && booking.invite_token !== token) {
      return res.status(403).json({ error: 'Geen toegang. Gebruik de uitnodigingslink.' });
    }
  }

  // Al ingeschreven?
  const existing = db.prepare(
    'SELECT * FROM participants WHERE booking_id = ? AND user_id = ?'
  ).get(bookingId, userId);
  if (existing) return res.status(409).json({ error: 'Je bent al ingeschreven' });

  // Tel huidige spelers (inclusief gasten)
  const counts = db.prepare(`
    SELECT (SELECT COUNT(*) FROM participants WHERE booking_id = ?)
         + (SELECT COUNT(*) FROM booking_guests WHERE booking_id = ?) AS total
  `).get(bookingId, bookingId);

  if (counts.total >= 4) {
    return res.status(409).json({ error: 'De boeking is vol (4 spelers)' });
  }

  // Niveau-check: max 2 aansluitende niveaus toegestaan
  const user = db.prepare('SELECT level FROM users WHERE id = ?').get(userId);
  if (user.level) {
    const levelRange = db.prepare(`
      SELECT MIN(u.level) AS min_level, MAX(u.level) AS max_level
      FROM participants p
      JOIN users u ON p.user_id = u.id
      WHERE p.booking_id = ? AND u.level IS NOT NULL
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
    'INSERT INTO participants (booking_id, user_id, is_extra) VALUES (?, ?, 0)'
  ).run(bookingId, userId);

  res.json({ success: true });
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

  res.json({ success: true });
});

// Gast toevoegen (organisator of deelnemer)
router.post('/:id/guests', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const userId = req.session.userId;
  const { guest_name } = req.body;

  if (!guest_name || !guest_name.trim()) {
    return res.status(400).json({ error: 'Naam is verplicht' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Boeking niet gevonden' });

  // Alleen organisator of ingeschreven deelnemer mag een gast toevoegen
  const isParticipant = db.prepare(
    'SELECT 1 FROM participants WHERE booking_id = ? AND user_id = ?'
  ).get(bookingId, userId);
  if (booking.created_by !== userId && !isParticipant) {
    return res.status(403).json({ error: 'Alleen deelnemers kunnen een gast toevoegen' });
  }

  // Capaciteitscheck
  const counts = db.prepare(`
    SELECT (SELECT COUNT(*) FROM participants WHERE booking_id = ?)
         + (SELECT COUNT(*) FROM booking_guests WHERE booking_id = ?) AS total
  `).get(bookingId, bookingId);
  if (counts.total >= 4) {
    return res.status(409).json({ error: 'De boeking is vol (4 spelers)' });
  }

  const result = db.prepare(
    'INSERT INTO booking_guests (booking_id, guest_name, added_by) VALUES (?, ?, ?)'
  ).run(bookingId, guest_name.trim(), userId);

  res.status(201).json({ id: result.lastInsertRowid });
});

// Gast verwijderen (organisator of degene die gast toevoegde)
router.delete('/:id/guests/:guestId', requireAuth, (req, res) => {
  const bookingId = req.params.id;
  const guestId   = req.params.guestId;
  const userId    = req.session.userId;

  const guest = db.prepare(
    'SELECT * FROM booking_guests WHERE id = ? AND booking_id = ?'
  ).get(guestId, bookingId);
  if (!guest) return res.status(404).json({ error: 'Gast niet gevonden' });

  const booking = db.prepare('SELECT created_by FROM bookings WHERE id = ?').get(bookingId);
  if (booking.created_by !== userId && guest.added_by !== userId) {
    return res.status(403).json({ error: 'Geen rechten om deze gast te verwijderen' });
  }

  db.prepare('DELETE FROM booking_guests WHERE id = ?').run(guestId);
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
