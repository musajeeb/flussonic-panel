/**
 * Single source of truth for "may this subscriber watch this channel?".
 * Used by both the Flussonic authorization backend and the M3U playlist builder,
 * so a customer can never see a channel in their playlist that they cannot play.
 */

export function evaluateSubscriber(user, now = new Date()) {
  if (!user) return { allowed: false, reason: 'unknown_token' };
  if (user.status !== 'active') return { allowed: false, reason: 'suspended' };
  if (user.expiresAt && new Date(user.expiresAt).getTime() < now.getTime()) {
    return { allowed: false, reason: 'expired' };
  }
  return { allowed: true, reason: 'ok' };
}

export function canAccessChannel(user, channel) {
  if (!channel || channel.enabled === false) return false;
  const cats = user.allowedCategories || [];
  const servers = user.allowedServerIds || [];
  // An empty allow-list means "everything" — that is the common case for a
  // single-package operator and avoids forcing them to tick every category.
  if (cats.length > 0 && !cats.includes(channel.category)) return false;
  if (servers.length > 0 && !servers.includes(String(channel.serverId))) return false;
  return true;
}

/** Returns the channels a subscriber is entitled to, given all channels. */
export function entitledChannels(user, channels) {
  return channels.filter((c) => canAccessChannel(user, c));
}
