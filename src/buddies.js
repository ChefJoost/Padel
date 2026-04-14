const express = require('express');
const router  = express.Router();
const db      = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// ── Buddies ──────────────────────────────────────────────────

// GET /api/buddies  → mijn buddies met laatste bericht + ongelezen teller
router.get('/', requireAuth, (req, res) => {
  const me = req.session.userId;
  console.log('[buddies GET /] userId:', me);
  try {
    // Haal eerst de buddies op (eenvoudige query zonder messages)
    const buddies = db.prepare(`
      SELECT
        u.id, u.display_name, u.username, u.level, u.avatar,
        (SELECT COUNT(DISTINCT p1.booking_id)
         FROM participants p1
         JOIN participants p2 ON p2.booking_id = p1.booking_id AND p2.user_id = ?
         WHERE p1.user_id = u.id) AS games_together
      FROM buddies b
      JOIN users u ON u.id = b.buddy_id
      WHERE b.user_id = ?
      ORDER BY u.display_name ASC
    `).all(me, me);

    console.log('[buddies GET /] gevonden:', buddies.length);

    // Voeg message-stats toe per buddy (aparte query om SQLite-versie problemen te vermijden)
    const result = buddies.map(buddy => {
      try {
        const unread = db.prepare(
          'SELECT COUNT(*) AS cnt FROM messages WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
        ).get(buddy.id, me);
        const last = db.prepare(
          'SELECT content, created_at FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at DESC LIMIT 1'
        ).get(buddy.id, me, me, buddy.id);
        return {
          ...buddy,
          unread_count:    unread?.cnt ?? 0,
          last_message:    last?.content ?? null,
          last_message_at: last?.created_at ?? null,
        };
      } catch (_) {
        return { ...buddy, unread_count: 0, last_message: null, last_message_at: null };
      }
    });

    // Sorteer: buddies met recente berichten eerst
    result.sort((a, b) => {
      if (!a.last_message_at && !b.last_message_at) return 0;
      if (!a.last_message_at) return 1;
      if (!b.last_message_at) return -1;
      return a.last_message_at < b.last_message_at ? 1 : -1;
    });

    res.json(result);
  } catch (err) {
    console.error('[buddies GET /] fout:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/buddies/profile/:userId  → publiek profiel van een speler
router.get('/profile/:userId', requireAuth, (req, res) => {
  const me     = req.session.userId;
  const target = parseInt(req.params.userId, 10);
  if (!target || target === me) return res.status(400).json({ error: 'Ongeldig gebruiker' });

  const user = db.prepare(`
    SELECT
      u.id, u.display_name, u.username, u.level, u.avatar,
      (SELECT COUNT(DISTINCT p1.booking_id)
       FROM participants p1
       JOIN participants p2 ON p2.booking_id = p1.booking_id AND p2.user_id = ?
       WHERE p1.user_id = u.id) AS games_together,
      EXISTS(SELECT 1 FROM buddies WHERE user_id = ? AND buddy_id = u.id) AS is_my_buddy
    FROM users u
    WHERE u.id = ?
  `).get(me, me, target);

  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json(user);
});

// POST /api/buddies/:userId  → voeg toe als buddy
router.post('/:userId', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const buddyId = parseInt(req.params.userId, 10);
  if (!buddyId || buddyId === me) return res.status(400).json({ error: 'Ongeldig' });
  db.prepare('INSERT OR IGNORE INTO buddies (user_id, buddy_id) VALUES (?, ?)').run(me, buddyId);
  res.json({ success: true });
});

// DELETE /api/buddies/:userId  → verwijder buddy
router.delete('/:userId', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const buddyId = parseInt(req.params.userId, 10);
  db.prepare('DELETE FROM buddies WHERE user_id = ? AND buddy_id = ?').run(me, buddyId);
  res.json({ success: true });
});

// ── Chat ─────────────────────────────────────────────────────

// GET /api/buddies/chat/:userId  → gesprek ophalen + markeer als gelezen
router.get('/chat/:userId', requireAuth, (req, res) => {
  const me    = req.session.userId;
  const other = parseInt(req.params.userId, 10);
  if (!other) return res.status(400).json({ error: 'Ongeldig' });

  // Controleer buddy-relatie (beide richtingen: één van de twee is genoeg)
  const isBuddy = db.prepare(
    'SELECT 1 FROM buddies WHERE (user_id = ? AND buddy_id = ?) OR (user_id = ? AND buddy_id = ?)'
  ).get(me, other, other, me);
  if (!isBuddy) return res.status(403).json({ error: 'Geen buddy' });

  const messages = db.prepare(`
    SELECT id, sender_id, content, created_at
    FROM messages
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
    LIMIT 200
  `).all(me, other, other, me);

  // Markeer inkomende berichten als gelezen
  db.prepare(`
    UPDATE messages SET read_at = CURRENT_TIMESTAMP
    WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
  `).run(other, me);

  res.json(messages);
});

// POST /api/buddies/chat/:userId  → stuur bericht
router.post('/chat/:userId', requireAuth, (req, res) => {
  const me    = req.session.userId;
  const other = parseInt(req.params.userId, 10);
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'Leeg bericht' });

  const isBuddy = db.prepare(
    'SELECT 1 FROM buddies WHERE (user_id = ? AND buddy_id = ?) OR (user_id = ? AND buddy_id = ?)'
  ).get(me, other, other, me);
  if (!isBuddy) return res.status(403).json({ error: 'Geen buddy' });

  const result = db.prepare(
    'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)'
  ).run(me, other, content.trim());

  const msg = db.prepare(
    'SELECT id, sender_id, content, created_at FROM messages WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.json(msg);
});

// GET /api/buddies/chat/:userId/new?after=id  → alleen nieuwe berichten (polling)
router.get('/chat/:userId/new', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const other   = parseInt(req.params.userId, 10);
  const afterId = parseInt(req.query.after, 10) || 0;

  const messages = db.prepare(`
    SELECT id, sender_id, content, created_at
    FROM messages
    WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
      AND id > ?
    ORDER BY created_at ASC
  `).all(me, other, other, me, afterId);

  // Markeer nieuwe inkomende als gelezen
  if (messages.length > 0) {
    db.prepare(`
      UPDATE messages SET read_at = CURRENT_TIMESTAMP
      WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
    `).run(other, me);
  }

  res.json(messages);
});

module.exports = router;
