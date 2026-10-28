// Who is typing to whom right now. Kept in memory only: it is gone in a few seconds anyway,
// and nothing about it needs to survive a restart.
const TYPING_TTL_MS = 6000;

const lastTyped = new Map<string, number>();

const key = (fromUserId: number, toUserId: number) => `${fromUserId}:${toUserId}`;

export function setTyping(fromUserId: number, toUserId: number, typing: boolean, now = Date.now()) {
  if (typing) lastTyped.set(key(fromUserId, toUserId), now);
  else lastTyped.delete(key(fromUserId, toUserId));
}

export function isTyping(fromUserId: number, toUserId: number, now = Date.now()) {
  const at = lastTyped.get(key(fromUserId, toUserId));
  if (at === undefined) return false;
  if (now - at > TYPING_TTL_MS) {
    lastTyped.delete(key(fromUserId, toUserId));
    return false;
  }
  return true;
}
