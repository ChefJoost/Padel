const express = require('express');
const router  = express.Router();
const db      = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

function requireAdmin(req, res, next) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user?.is_admin) return res.status(403).json({ error: 'Geen admin-rechten' });
  next();
}

// GET /api/communities/search?q=  → zoek op naam
router.get('/search', requireAuth, (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT c.id, c.name,
      (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) AS member_count,
      EXISTS(SELECT 1 FROM community_members WHERE community_id = c.id AND user_id = ?) AS is_member,
      (c.created_by = ?) AS is_creator
    FROM communities c
    WHERE c.name LIKE ?
    ORDER BY c.name ASC
    LIMIT 20
  `).all(me, me, q);
  res.json(rows);
});

// GET /api/communities/mine  → mijn speelgroepen
router.get('/mine', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT c.id, c.name,
      (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) AS member_count
    FROM communities c
    JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = ?
    ORDER BY cm.joined_at ASC
  `).all(me);
  res.json(rows);
});

// GET /api/communities  → alle (admin)
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.created_at,
      (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) AS member_count
    FROM communities c
    ORDER BY c.name ASC
  `).all();
  res.json(rows);
});

// POST /api/communities  → aanmaken (iedereen) + automatisch lid worden
router.post('/', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  try {
    const result = db.prepare('INSERT INTO communities (name, created_by) VALUES (?, ?)').run(name.trim(), req.session.userId);
    const id = result.lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id) VALUES (?, ?)').run(id, req.session.userId);
    res.status(201).json({ id, name: name.trim() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Naam al in gebruik' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/communities/:id/join
router.post('/:id/join', requireAuth, (req, res) => {
  const communityId = parseInt(req.params.id, 10);
  const me = req.session.userId;
  const community = db.prepare('SELECT id FROM communities WHERE id = ?').get(communityId);
  if (!community) return res.status(404).json({ error: 'Speelgroep niet gevonden' });
  db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id) VALUES (?, ?)').run(communityId, me);
  res.json({ success: true });
});

// PUT /api/communities/:id  → hernoemen (aanmaker of admin)
router.put('/:id', requireAuth, (req, res) => {
  const communityId = parseInt(req.params.id, 10);
  const me = req.session.userId;
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Naam is verplicht' });

  const community = db.prepare('SELECT id, created_by FROM communities WHERE id = ?').get(communityId);
  if (!community) return res.status(404).json({ error: 'Speelgroep niet gevonden' });

  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(me);
  if (community.created_by !== me && !user?.is_admin) {
    return res.status(403).json({ error: 'Alleen de aanmaker kan de naam wijzigen' });
  }

  try {
    db.prepare('UPDATE communities SET name = ? WHERE id = ?').run(name.trim(), communityId);
    res.json({ success: true, name: name.trim() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Naam al in gebruik' });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/communities/:id/members  → leden ophalen (aanmaker of admin)
router.get('/:id/members', requireAuth, (req, res) => {
  const communityId = parseInt(req.params.id, 10);
  const me = req.session.userId;

  const community = db.prepare('SELECT id, created_by FROM communities WHERE id = ?').get(communityId);
  if (!community) return res.status(404).json({ error: 'Niet gevonden' });

  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(me);
  if (community.created_by !== me && !user?.is_admin) {
    return res.status(403).json({ error: 'Geen toegang' });
  }

  const members = db.prepare(`
    SELECT u.id, u.display_name, u.username, u.avatar, u.level,
      (cm.user_id = ?) AS is_creator
    FROM community_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.community_id = ?
    ORDER BY u.display_name ASC
  `).all(community.created_by, communityId);

  res.json({ members, created_by: community.created_by });
});

// DELETE /api/communities/:id/members/:userId  → lid verwijderen (aanmaker of admin)
router.delete('/:id/members/:userId', requireAuth, (req, res) => {
  const communityId = parseInt(req.params.id, 10);
  const targetId    = parseInt(req.params.userId, 10);
  const me = req.session.userId;

  const community = db.prepare('SELECT id, created_by FROM communities WHERE id = ?').get(communityId);
  if (!community) return res.status(404).json({ error: 'Niet gevonden' });

  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(me);
  if (community.created_by !== me && !user?.is_admin) {
    return res.status(403).json({ error: 'Geen toegang' });
  }
  if (targetId === community.created_by) {
    return res.status(400).json({ error: 'De aanmaker kan niet verwijderd worden' });
  }

  db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(communityId, targetId);
  res.json({ success: true });
});

// DELETE /api/communities/:id/leave
router.delete('/:id/leave', requireAuth, (req, res) => {
  const communityId = parseInt(req.params.id, 10);
  const me = req.session.userId;

  const community = db.prepare('SELECT id, created_by FROM communities WHERE id = ?').get(communityId);
  if (!community) return res.status(404).json({ error: 'Speelgroep niet gevonden' });

  // Aanmaker kan zijn eigen groep niet verlaten (#5)
  if (community.created_by === me) {
    return res.status(400).json({ error: 'Als aanmaker kun je de groep niet verlaten. Verwijder de groep of draag hem over aan een andere beheerder.' });
  }

  // Minimaal één groep verplicht
  const myGroupCount = db.prepare('SELECT COUNT(*) AS c FROM community_members WHERE user_id = ?').get(me)?.c ?? 0;
  if (myGroupCount <= 1) {
    return res.status(400).json({ error: 'Je moet lid zijn van minimaal één speelgroep' });
  }

  db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(communityId, me);
  res.json({ success: true });
});

// DELETE /api/communities/:id  → verwijderen (admin)
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const communityId = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM communities WHERE id = ?').run(communityId);
  res.json({ success: true });
});

module.exports = router;
