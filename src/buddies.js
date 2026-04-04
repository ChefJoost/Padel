const express = require('express');
const db = require('./database');
const { sendPushToUser } = require('./push');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

function areBuddies(userId, otherId) {
  return !!db.prepare(`
    SELECT id FROM buddy_requests
    WHERE status = 'accepted'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
  `).get(userId, otherId, otherId, userId);
}

// Zoek gebruikers om toe te voegen
router.get('/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const userId = req.session.userId;
  const like = `%${q}%`;

  const users = db.prepare(`
    SELECT id, display_name, username, level, avatar FROM users
    WHERE id != ? AND (display_name LIKE ? OR username LIKE ?)
    LIMIT 10
  `).all(userId, like, like);

  const result = users.map(u => {
    const existing = db.prepare(`
      SELECT id, status, from_user_id FROM buddy_requests
      WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
    `).get(userId, u.id, u.id, userId);
    let relation = 'none';
    if (existing) {
      if (existing.status === 'accepted') relation = 'buddy';
      else if (existing.from_user_id === userId) relation = 'sent';
      else relation = 'received';
    }
    return { ...u, relation, request_id: existing?.id || null };
  });

  res.json(result);
});

// Badge counts voor tab-icoon
router.get('/badge', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const requests = db.prepare(`
    SELECT COUNT(*) AS cnt FROM buddy_requests WHERE to_user_id = ? AND status = 'pending'
  `).get(userId).cnt;
  const messages = db.prepare(`
    SELECT COUNT(*) AS cnt FROM messages WHERE to_user_id = ? AND read_at IS NULL
  `).get(userId).cnt;
  res.json({ requests, messages });
});

// Lijst van buddies
router.get('/', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const buddies = db.prepare(`
    SELECT
      u.id, u.display_name, u.username, u.level, u.avatar,
      br.created_at AS buddy_since,
      (SELECT COUNT(*) FROM messages m
       WHERE m.from_user_id = u.id AND m.to_user_id = ? AND m.read_at IS NULL) AS unread,
      (SELECT content FROM messages ml
       WHERE (ml.from_user_id = u.id AND ml.to_user_id = ?)
          OR (ml.from_user_id = ? AND ml.to_user_id = u.id)
       ORDER BY ml.created_at DESC LIMIT 1) AS last_message,
      (SELECT ml2.created_at FROM messages ml2
       WHERE (ml2.from_user_id = u.id AND ml2.to_user_id = ?)
          OR (ml2.from_user_id = ? AND ml2.to_user_id = u.id)
       ORDER BY ml2.created_at DESC LIMIT 1) AS last_message_at
    FROM buddy_requests br
    JOIN users u ON (CASE WHEN br.from_user_id = ? THEN br.to_user_id ELSE br.from_user_id END) = u.id
    WHERE br.status = 'accepted'
      AND (br.from_user_id = ? OR br.to_user_id = ?)
    ORDER BY COALESCE(last_message_at, br.created_at) DESC
  `).all(userId, userId, userId, userId, userId, userId, userId, userId);
  res.json(buddies);
});

// Inkomende verzoeken
router.get('/requests', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const requests = db.prepare(`
    SELECT br.id, br.created_at,
           u.id AS user_id, u.display_name, u.username, u.level, u.avatar
    FROM buddy_requests br
    JOIN users u ON br.from_user_id = u.id
    WHERE br.to_user_id = ? AND br.status = 'pending'
    ORDER BY br.created_at DESC
  `).all(userId);
  res.json(requests);
});

// Stuur buddyverzoek
router.post('/request', requireAuth, (req, res) => {
  const fromId = req.session.userId;
  const toId = parseInt(req.body.user_id, 10);
  if (!toId || isNaN(toId)) return res.status(400).json({ error: 'Ongeldig gebruikers-ID' });
  if (toId === fromId) return res.status(400).json({ error: 'Je kunt jezelf niet als buddy toevoegen' });

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(toId);
  if (!target) return res.status(404).json({ error: 'Gebruiker niet gevonden' });

  const existing = db.prepare(`
    SELECT id, status FROM buddy_requests
    WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
  `).get(fromId, toId, toId, fromId);

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Jullie zijn al buddies' });
    return res.status(409).json({ error: 'Er is al een verzoek uitstaand' });
  }

  db.prepare(`INSERT INTO buddy_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')`)
    .run(fromId, toId);

  const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(fromId);
  sendPushToUser(toId, {
    title: 'Nieuw buddyverzoek',
    body: `${sender.display_name} wil je buddy worden`,
    url: '/',
  }).catch(() => {});

  res.json({ success: true });
});

// Accepteer verzoek
router.post('/requests/:id/accept', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const requestId = parseInt(req.params.id, 10);

  const request = db.prepare(`
    SELECT * FROM buddy_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'
  `).get(requestId, userId);
  if (!request) return res.status(404).json({ error: 'Verzoek niet gevonden' });

  db.prepare(`UPDATE buddy_requests SET status = 'accepted' WHERE id = ?`).run(requestId);

  const accepter = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
  sendPushToUser(request.from_user_id, {
    title: 'Buddyverzoek geaccepteerd',
    body: `${accepter.display_name} heeft je buddyverzoek geaccepteerd`,
    url: '/',
  }).catch(() => {});

  res.json({ success: true });
});

// Weiger of intrek verzoek
router.post('/requests/:id/reject', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const requestId = parseInt(req.params.id, 10);

  const request = db.prepare('SELECT * FROM buddy_requests WHERE id = ?').get(requestId);
  if (!request || (request.to_user_id !== userId && request.from_user_id !== userId))
    return res.status(404).json({ error: 'Verzoek niet gevonden' });

  db.prepare('DELETE FROM buddy_requests WHERE id = ?').run(requestId);
  res.json({ success: true });
});

// Verwijder buddy
router.delete('/:userId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const otherId = parseInt(req.params.userId, 10);

  db.prepare(`
    DELETE FROM buddy_requests
    WHERE status = 'accepted'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
  `).run(userId, otherId, otherId, userId);

  res.json({ success: true });
});

// Berichten ophalen
router.get('/messages/:userId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const otherId = parseInt(req.params.userId, 10);
  if (!areBuddies(userId, otherId)) return res.status(403).json({ error: 'Niet bevriend' });

  const msgs = db.prepare(`
    SELECT id, from_user_id, content, read_at, created_at FROM messages
    WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
    ORDER BY created_at ASC
    LIMIT 100
  `).all(userId, otherId, otherId, userId);

  res.json(msgs);
});

// Bericht sturen
router.post('/messages/:userId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const otherId = parseInt(req.params.userId, 10);
  const content = String(req.body.content || '').trim();

  if (!content) return res.status(400).json({ error: 'Bericht mag niet leeg zijn' });
  if (content.length > 1000) return res.status(400).json({ error: 'Bericht te lang (max 1000 tekens)' });
  if (!areBuddies(userId, otherId)) return res.status(403).json({ error: 'Niet bevriend' });

  const result = db.prepare(
    'INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)'
  ).run(userId, otherId, content);

  const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
  sendPushToUser(otherId, {
    title: sender.display_name,
    body: content.length > 80 ? content.slice(0, 80) + '…' : content,
    url: '/',
  }).catch(() => {});

  const msg = db.prepare(
    'SELECT id, from_user_id, content, read_at, created_at FROM messages WHERE id = ?'
  ).get(result.lastInsertRowid);
  res.json(msg);
});

// Markeer berichten als gelezen
router.post('/messages/:userId/read', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const otherId = parseInt(req.params.userId, 10);

  db.prepare(`
    UPDATE messages SET read_at = CURRENT_TIMESTAMP
    WHERE from_user_id = ? AND to_user_id = ? AND read_at IS NULL
  `).run(otherId, userId);

  res.json({ success: true });
});

module.exports = router;
