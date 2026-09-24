// Lightweight SSE connection registry for real-time chat
// Key convention: 'direct:{minId}-{maxId}' | 'group:{groupId}'
const channels = new Map(); // key → Set<res>

function subscribe(key, res) {
  if (!channels.has(key)) channels.set(key, new Set());
  channels.get(key).add(res);
  return () => {
    channels.get(key)?.delete(res);
    if (channels.get(key)?.size === 0) channels.delete(key);
  };
}

function publish(key, data) {
  const subs = channels.get(key);
  if (!subs) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try { res.write(payload); } catch (_) {}
  }
}

function directKey(a, b) {
  return `direct:${Math.min(a, b)}-${Math.max(a, b)}`;
}

function groupKey(groupId) {
  return `group:${groupId}`;
}

module.exports = { subscribe, publish, directKey, groupKey };
