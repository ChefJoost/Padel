const express = require('express');
const router  = express.Router();
const db      = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// GET /api/groups/unread → count of groups with unread messages
router.get('/unread', requireAuth, (req, res) => {
  const me = req.session.userId;
  try {
    const row = db.prepare(`
      SELECT COUNT(DISTINCT gm.group_id) AS count
      FROM group_messages gm
      JOIN group_members mem ON mem.group_id = gm.group_id AND mem.user_id = ?
      LEFT JOIN group_message_reads r ON r.group_id = gm.group_id AND r.user_id = ?
      WHERE gm.sender_id != ?
        AND gm.id > COALESCE(r.last_read_id, 0)
    `).get(me, me, me);
    res.json({ count: row?.count ?? 0 });
  } catch (_) {
    res.json({ count: 0 });
  }
});

// GET /api/groups → mijn groepen met laatste bericht + ongelezen teller
router.get('/', requireAuth, (req, res) => {
  const me = req.session.userId;
  try {
    const groups = db.prepare(`
      SELECT g.id, g.name, g.created_by,
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
      FROM chat_groups g
      JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      ORDER BY g.created_at DESC
    `).all(me);

    const result = groups.map(g => {
      try {
        const last = db.prepare(
          'SELECT id, content, created_at FROM group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(g.id);
        const readRow = db.prepare(
          'SELECT last_read_id FROM group_message_reads WHERE group_id = ? AND user_id = ?'
        ).get(g.id, me);
        const lastReadId = readRow?.last_read_id ?? 0;
        const unread = db.prepare(
          'SELECT COUNT(*) AS cnt FROM group_messages WHERE group_id = ? AND sender_id != ? AND id > ?'
        ).get(g.id, me, lastReadId);
        const members = db.prepare(
          'SELECT u.id, u.display_name, u.avatar FROM group_members mem JOIN users u ON u.id = mem.user_id WHERE mem.group_id = ? LIMIT 3'
        ).all(g.id);
        return {
          ...g,
          last_message:    last?.content ?? null,
          last_message_at: last?.created_at ?? null,
          unread_count:    unread?.cnt ?? 0,
          members,
        };
      } catch (_) {
        return { ...g, last_message: null, last_message_at: null, unread_count: 0, members: [] };
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

// POST /api/groups → maak groep aan
router.post('/', requireAuth, (req, res) => {
  const me = req.session.userId;
  const { name, memberIds } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  if (!Array.isArray(memberIds) || memberIds.length === 0)
    return res.status(400).json({ error: 'Kies minstens één lid' });

  try {
    const result = db.prepare('INSERT INTO chat_groups (name, created_by) VALUES (?, ?)').run(name.trim(), me);
    const groupId = result.lastInsertRowid;

    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, me);
    for (const uid of memberIds) {
      if (Number(uid) !== me) {
        db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, Number(uid));
      }
    }

    res.json({ id: groupId, name: name.trim(), created_by: me });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id → groepsinfo + leden
router.get('/:id', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);

  const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, me);
  if (!isMember) return res.status(403).json({ error: 'Geen lid van deze groep' });

  const group = db.prepare('SELECT id, name, created_by FROM chat_groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Groep niet gevonden' });

  const members = db.prepare(
    'SELECT u.id, u.display_name, u.avatar, u.level FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.display_name ASC'
  ).all(groupId);

  res.json({ ...group, members });
});

// DELETE /api/groups/:id → verwijder groep (alleen maker)
router.delete('/:id', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);
  const group   = db.prepare('SELECT created_by FROM chat_groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Niet gevonden' });
  if (group.created_by !== me) return res.status(403).json({ error: 'Alleen de maker kan de groep verwijderen' });

  db.prepare('DELETE FROM chat_groups WHERE id = ?').run(groupId);
  res.json({ success: true });
});

// DELETE /api/groups/:id/leave → groep verlaten
router.delete('/:id/leave', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, me);
  res.json({ success: true });
});

// POST /api/groups/:id/members → lid toevoegen
router.post('/:id/members', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId verplicht' });

  const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, me);
  if (!isMember) return res.status(403).json({ error: 'Geen lid' });

  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, Number(userId));
  res.json({ success: true });
});

// GET /api/groups/:id/chat → berichten ophalen (markeer als gelezen)
router.get('/:id/chat', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);

  try {
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, me);
    if (!isMember) return res.status(403).json({ error: 'Geen lid' });

    const messages = db.prepare(`
      SELECT m.id, m.sender_id, m.content, m.created_at, u.display_name AS sender_name
      FROM group_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.group_id = ?
      ORDER BY m.created_at ASC
      LIMIT 200
    `).all(groupId);

    if (messages.length > 0) {
      const lastId = messages[messages.length - 1].id;
      db.prepare(`
        INSERT INTO group_message_reads (group_id, user_id, last_read_id) VALUES (?, ?, ?)
        ON CONFLICT(group_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
      `).run(groupId, me, lastId);
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/chat → stuur bericht
router.post('/:id/chat', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'Leeg bericht' });

  try {
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, me);
    if (!isMember) return res.status(403).json({ error: 'Geen lid' });

    const result = db.prepare(
      'INSERT INTO group_messages (group_id, sender_id, content) VALUES (?, ?, ?)'
    ).run(groupId, me, content.trim());

    db.prepare(`
      INSERT INTO group_message_reads (group_id, user_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(group_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
    `).run(groupId, me, result.lastInsertRowid);

    const msg = db.prepare(
      'SELECT m.id, m.sender_id, m.content, m.created_at, u.display_name AS sender_name FROM group_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?'
    ).get(result.lastInsertRowid);

    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/chat/new?after=id → poll nieuwe berichten
router.get('/:id/chat/new', requireAuth, (req, res) => {
  const me      = req.session.userId;
  const groupId = parseInt(req.params.id, 10);
  const afterId = parseInt(req.query.after, 10) || 0;

  try {
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, me);
    if (!isMember) return res.json([]);

    const messages = db.prepare(`
      SELECT m.id, m.sender_id, m.content, m.created_at, u.display_name AS sender_name
      FROM group_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.group_id = ? AND m.id > ?
      ORDER BY m.created_at ASC
    `).all(groupId, afterId);

    if (messages.length > 0) {
      const lastId = messages[messages.length - 1].id;
      db.prepare(`
        INSERT INTO group_message_reads (group_id, user_id, last_read_id) VALUES (?, ?, ?)
        ON CONFLICT(group_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
      `).run(groupId, me, lastId);
    }

    res.json(messages);
  } catch (err) {
    res.json([]);
  }
});

module.exports = router;
