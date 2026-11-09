const express = require('express');
const router  = express.Router();
const db      = require('./database');
const { sendPushToUser } = require('./push');
const sse = require('./sseManager');
const { createNotification } = require('./notifications');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// Schema-check messages tabel eenmalig bij opstarten
{
  const cols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  if (cols.length > 0 && !cols.includes('sender_id')) {
    db.exec('DROP TABLE messages');
    db.exec(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME
    )`);
  }
}

// ── Buddies ──────────────────────────────────────────────────

// GET /api/buddies/unread → ongelezen berichten + openstaande verzoeken
router.get('/unread', requireAuth, (req, res) => {
  const me = req.session.userId;
  try {
    const msgRow = db.prepare(
      'SELECT COUNT(DISTINCT sender_id) AS count FROM messages WHERE receiver_id = ? AND read_at IS NULL'
    ).get(me);
    const reqRow = db.prepare(
      "SELECT COUNT(*) AS count FROM buddy_requests WHERE to_user_id = ? AND status = 'pending'"
    ).get(me);
    res.json({ count: msgRow?.count ?? 0, request_count: reqRow?.count ?? 0 });
  } catch (_) {
    res.json({ count: 0, request_count: 0 });
  }
});

// GET /api/buddies/requests → inkomende buddy-verzoeken
router.get('/requests', requireAuth, (req, res) => {
  const me = req.session.userId;
  const requests = db.prepare(`
    SELECT br.id, br.from_user_id, br.created_at,
           u.display_name, u.username, u.avatar, u.level
    FROM buddy_requests br
    JOIN users u ON u.id = br.from_user_id
    WHERE br.to_user_id = ? AND br.status = 'pending'
    ORDER BY br.created_at DESC
  `).all(me);
  res.json(requests);
});

// POST /api/buddies/requests/:id/accept → accepteer verzoek
router.post('/requests/:id/accept', requireAuth, (req, res) => {
  const me        = req.session.userId;
  const requestId = parseInt(req.params.id, 10);

  const request = db.prepare(
    "SELECT * FROM buddy_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(requestId, me);
  if (!request) return res.status(404).json({ error: 'Verzoek niet gevonden' });

  db.transaction(() => {
    db.prepare("UPDATE buddy_requests SET status = 'accepted' WHERE id = ?").run(requestId);
    db.prepare('INSERT OR IGNORE INTO buddies (user_id, buddy_id) VALUES (?, ?)').run(request.from_user_id, me);
    db.prepare('INSERT OR IGNORE INTO buddies (user_id, buddy_id) VALUES (?, ?)').run(me, request.from_user_id);
  })();

  // Stuur notificatie en push naar de verzoeker
  const accepter = db.prepare('SELECT display_name FROM users WHERE id = ?').get(me);
  createNotification(request.from_user_id, {
    type:  'buddy_accepted',
    title: 'Buddy-verzoek geaccepteerd',
    body:  `${accepter?.display_name} heeft je buddy-verzoek geaccepteerd`,
    url:   '/#buddies',
  });
  sendPushToUser(request.from_user_id, {
    title: 'Buddy-verzoek geaccepteerd',
    body:  `${accepter?.display_name} heeft je buddy-verzoek geaccepteerd`,
    url:   '/#buddies',
  }).catch(() => {});

  res.json({ success: true });
});

// POST /api/buddies/requests/:id/decline → weiger verzoek
router.post('/requests/:id/decline', requireAuth, (req, res) => {
  const me        = req.session.userId;
  const requestId = parseInt(req.params.id, 10);
  db.prepare("UPDATE buddy_requests SET status = 'declined' WHERE id = ? AND to_user_id = ?").run(requestId, me);
  res.json({ success: true });
});

// DELETE /api/buddies/requests/:userId/cancel → trek verzoek in
router.delete('/requests/:userId/cancel', requireAuth, (req, res) => {
  const me       = req.session.userId;
  const targetId = parseInt(req.params.userId, 10);
  db.prepare("DELETE FROM buddy_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'").run(me, targetId);
  res.json({ success: true });
});

// GET /api/buddies → mijn buddies met laatste bericht + ongelezen teller
router.get('/', requireAuth, (req, res) => {
  const me = req.session.userId;
  try {
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

    result.sort((a, b) => {
      if (!a.last_message_at && !b.last_message_at) return 0;
      if (!a.last_message_at) return 1;
      if (!b.last_message_at) return -1;
      return a.last_message_at < b.last_message_at ? 1 : -1;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/buddies/profile/:userId → publiek profiel incl. verzoekstatus
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
    FROM users u WHERE u.id = ?
  `).get(me, me, target);

  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });

  // Verzoekstatus
  const sentReq     = db.prepare("SELECT id, status FROM buddy_requests WHERE from_user_id = ? AND to_user_id = ?").get(me, target);
  const receivedReq = db.prepare("SELECT id FROM buddy_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'").get(target, me);

  res.json({
    ...user,
    request_sent:     sentReq?.status === 'pending' ? sentReq.id : null,
    request_received: receivedReq?.id ?? null,
  });
});

// POST /api/buddies/:userId → stuur buddy-verzoek
router.post('/:userId', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const buddyId = parseInt(req.params.userId, 10);
  if (!buddyId || buddyId === me) return res.status(400).json({ error: 'Ongeldig' });

  const already = db.prepare('SELECT 1 FROM buddies WHERE user_id = ? AND buddy_id = ?').get(me, buddyId);
  if (already) return res.status(409).json({ error: 'Al buddy' });

  try {
    db.prepare(`
      INSERT INTO buddy_requests (from_user_id, to_user_id, status)
      VALUES (?, ?, 'pending')
      ON CONFLICT(from_user_id, to_user_id) DO UPDATE SET status = 'pending', created_at = CURRENT_TIMESTAMP
    `).run(me, buddyId);

    const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(me);
    createNotification(buddyId, {
      type:  'buddy_request',
      title: 'Nieuw buddy-verzoek',
      body:  `${sender?.display_name} wil jou toevoegen als buddy`,
      url:   '/#buddies',
    });
    sendPushToUser(buddyId, {
      title: 'Nieuw buddy-verzoek',
      body:  `${sender?.display_name} wil jou toevoegen als buddy`,
      url:   '/#buddies',
    }).catch(() => {});

    res.json({ success: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/buddies/:userId → verwijder buddy
router.delete('/:userId', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const buddyId = parseInt(req.params.userId, 10);
  db.prepare('DELETE FROM buddies WHERE user_id = ? AND buddy_id = ?').run(me, buddyId);
  res.json({ success: true });
});

// ── Chat ─────────────────────────────────────────────────────

// GET /api/buddies/chat/:userId
router.get('/chat/:userId', requireAuth, (req, res) => {
  const me    = req.session.userId;
  const other = parseInt(req.params.userId, 10);
  if (!other) return res.status(400).json({ error: 'Ongeldig' });

  try {
    const isBuddy = db.prepare(
      'SELECT 1 FROM buddies WHERE (user_id = ? AND buddy_id = ?) OR (user_id = ? AND buddy_id = ?)'
    ).get(me, other, other, me);
    if (!isBuddy) return res.status(403).json({ error: 'Geen buddy' });

    const messages = db.prepare(`
      SELECT id, sender_id, content, created_at
      FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at ASC LIMIT 200
    `).all(me, other, other, me);

    db.prepare(
      'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
    ).run(other, me);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/buddies/chat/:userId
router.post('/chat/:userId', requireAuth, (req, res) => {
  const me    = req.session.userId;
  const other = parseInt(req.params.userId, 10);
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'Leeg bericht' });
  if (content.length > 4000) return res.status(400).json({ error: 'Bericht te lang (max 4000 tekens)' });

  try {
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

    sse.publish(sse.directKey(me, other), msg);

    const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(me);
    sendPushToUser(other, {
      title: sender?.display_name || 'Nieuw bericht',
      body:  content.trim().slice(0, 100),
      url:   '/#buddies',
    }).catch(() => {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/buddies/chat/:userId/new?after=id
router.get('/chat/:userId/new', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const other   = parseInt(req.params.userId, 10);
  const afterId = parseInt(req.query.after, 10) || 0;

  try {
    const isBuddy = db.prepare(
      'SELECT 1 FROM buddies WHERE (user_id = ? AND buddy_id = ?) OR (user_id = ? AND buddy_id = ?)'
    ).get(me, other, other, me);
    if (!isBuddy) return res.status(403).json({ error: 'Geen buddy' });

    const messages = db.prepare(`
      SELECT id, sender_id, content, created_at
      FROM messages
      WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND id > ?
      ORDER BY created_at ASC
    `).all(me, other, other, me, afterId);

    if (messages.length > 0) {
      db.prepare(
        'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
      ).run(other, me);
    }

    res.json(messages);
  } catch (_) {
    res.json([]);
  }
});

// GET /api/buddies/chat/:userId/events → SSE
router.get('/chat/:userId/events', requireAuth, (req, res) => {
  const me    = req.session.userId;
  const other = parseInt(req.params.userId, 10);
  if (!other) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsubscribe = sse.subscribe(sse.directKey(me, other), res);
  req.on('close', unsubscribe);
});

module.exports = router;
