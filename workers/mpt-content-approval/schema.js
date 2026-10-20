// Strict validator for the Make.com hand-off payload (MPC-8374 / Master Blueprint 6-platform schema).
// Pure functions, no I/O. validateMakePayload() returns { ok, errors } and never throws.

export const SCHEMA_VERSION = '1.0';
export const PLATFORMS = ['x', 'linkedin', 'instagram', 'facebook', 'pinterest', 'youtube'];
// The live consumer (mpt-content-consumer) still drafts Reddit; it is accepted but is not one of the six blueprint platforms.
export const LEGACY_PLATFORMS = ['reddit'];
export const CONTENT_TYPES = ['image', 'video', 'text'];
// Per-platform copy limits (MPC-8332 Module 6). X is checked per post of the thread, see validatePost.
export const PLATFORM_LIMITS = { x: 280, linkedin: 3000, instagram: 2200, facebook: 4000, pinterest: 500, youtube: 5000, reddit: 40000 };

const ENVELOPE_KEYS = ['schema_version', 'campaign', 'drafted_content_id', 'approved_by', 'approval_timestamp', 'posts'];
const POST_KEYS = ['platform', 'title', 'body', 'hashtags', 'cta', 'content_type', 'asset_url', 'link_url', 'publish_timestamp', 'subreddit', 'slides'];
const REQUIRED_POST_KEYS = ['platform', 'title', 'body', 'hashtags', 'cta', 'content_type', 'asset_url', 'link_url', 'publish_timestamp'];

// ISO 8601 date-time that must carry the HKT (+08:00) offset.
const HKT_ISO = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?\+08:00$/;
const TASK_ID = /^daily-posts-\d{4}-\d{2}-\d{2}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function isHktIso(value) {
  const m = typeof value === 'string' ? HKT_ISO.exec(value) : null;
  if (!m) return false;
  const [, y, mo, d] = m;
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return probe.getUTCFullYear() === Number(y) && probe.getUTCMonth() === Number(mo) - 1 && probe.getUTCDate() === Number(d);
}

export function isHttpsUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password;
  } catch {
    return false;
  }
}

function validatePost(post, i, errors) {
  const at = `posts[${i}]`;
  if (!isObject(post)) { errors.push(`${at}: must be an object`); return; }
  for (const k of Object.keys(post)) if (!POST_KEYS.includes(k)) errors.push(`${at}.${k}: unknown field`);
  for (const k of REQUIRED_POST_KEYS) if (post[k] === undefined || post[k] === null) errors.push(`${at}.${k}: required`);

  const { platform } = post;
  const known = PLATFORMS.includes(platform) || LEGACY_PLATFORMS.includes(platform);
  if (platform !== undefined && platform !== null && !known) errors.push(`${at}.platform: must be one of ${PLATFORMS.join(', ')}`);

  for (const k of ['title', 'body', 'cta']) {
    if (post[k] !== undefined && post[k] !== null && !isText(post[k])) errors.push(`${at}.${k}: must be a non-empty string`);
  }
  if (post.hashtags !== undefined && post.hashtags !== null && typeof post.hashtags !== 'string') errors.push(`${at}.hashtags: must be a string`);
  if (post.content_type !== undefined && post.content_type !== null && !CONTENT_TYPES.includes(post.content_type)) {
    errors.push(`${at}.content_type: must be one of ${CONTENT_TYPES.join(', ')}`);
  }
  for (const k of ['asset_url', 'link_url']) {
    if (post[k] !== undefined && post[k] !== null && !isHttpsUrl(post[k])) errors.push(`${at}.${k}: must be a valid https:// URL`);
  }
  if (post.publish_timestamp !== undefined && post.publish_timestamp !== null && !isHktIso(post.publish_timestamp)) {
    errors.push(`${at}.publish_timestamp: must be ISO 8601 with +08:00 (HKT) offset`);
  }
  if (post.subreddit !== undefined && !(typeof post.subreddit === 'string' && /^(r\/)?\w{2,21}$/.test(post.subreddit))) errors.push(`${at}.subreddit: invalid`);
  if (post.slides !== undefined && !(Array.isArray(post.slides) && post.slides.length > 0 && post.slides.every(isText))) errors.push(`${at}.slides: must be a non-empty array of strings`);

  if (known && isText(post.body)) {
    const limit = PLATFORM_LIMITS[platform];
    const parts = platform === 'x' ? post.body.split(/\n\s*---\s*\n/) : [post.body];
    if (parts.some((p) => p.trim().length > limit)) errors.push(`${at}.body: exceeds ${limit} characters${platform === 'x' ? ' in a post' : ''}`);
  }
}

export function validateMakePayload(payload) {
  const errors = [];
  if (!isObject(payload)) return { ok: false, errors: ['payload: must be an object'] };

  for (const k of Object.keys(payload)) if (!ENVELOPE_KEYS.includes(k)) errors.push(`${k}: unknown field`);
  if (payload.schema_version !== SCHEMA_VERSION) errors.push(`schema_version: must be "${SCHEMA_VERSION}"`);
  if (!isText(payload.campaign)) errors.push('campaign: required');
  if (typeof payload.drafted_content_id !== 'string' || !TASK_ID.test(payload.drafted_content_id)) errors.push('drafted_content_id: must look like daily-posts-YYYY-MM-DD');
  if (!isText(payload.approved_by)) errors.push('approved_by: required');
  if (!isHktIso(payload.approval_timestamp)) errors.push('approval_timestamp: must be ISO 8601 with +08:00 (HKT) offset');

  if (!Array.isArray(payload.posts) || payload.posts.length === 0) {
    errors.push('posts: must be a non-empty array');
  } else {
    payload.posts.forEach((p, i) => validatePost(p, i, errors));
    const seen = new Set();
    for (const p of payload.posts) {
      if (!isObject(p) || typeof p.platform !== 'string') continue;
      if (seen.has(p.platform)) errors.push(`posts: duplicate platform ${p.platform}`);
      seen.add(p.platform);
    }
  }
  return { ok: errors.length === 0, errors };
}
