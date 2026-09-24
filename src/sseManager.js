// Lightweight SSE connection registry for real-time chat
// Key convention: 'direct:{minId}-{maxId}' | 'group:{groupId}'
const channels = new Map(); // key → Set<res>

// Heartbeat elke 25 seconden om proxy-timeouts te voorkomen (#6)
const HEARTBEAT_INTERVAL = 25 * 1000;

function subscribe(key, res) {
  if (!channels.has(key)) channels.set(key, new Set());
  channels.get(key).add(res);

  const timer = setInterval(() => {
    try {
      res.write(':\n\n'); // SSE comment als keepalive
    } catch (_) {
      unsubscribe(); // dode verbinding opruimen (#7)
    }
  }, HEARTBEAT_INTERVAL);

  function unsubscribe() {
    clearInterval(timer);
    channels.get(key)?.delete(res);
    if (channels.get(key)?.size === 0) channels.delete(key);
  }

  return unsubscribe;
}

function publish(key, data) {
  const subs = channels.get(key);
  if (!subs) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try {
      res.write(payload);
    } catch (_) {
      // Dode verbinding verwijderen (#7)
      subs.delete(res);
      if (subs.size === 0) channels.delete(key);
    }
  }
}

function directKey(a, b) {
  return `direct:${Math.min(a, b)}-${Math.max(a, b)}`;
}

function groupKey(groupId) {
  return `group:${groupId}`;
}

module.exports = { subscribe, publish, directKey, groupKey };
