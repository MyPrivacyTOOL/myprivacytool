// MPC-7557: static checks on an email's HTML and plain text, shared by CI (email-render.test.mjs, every change to the email code) and the nightly chain test.
// What these CAN prove: size under Gmail's clipping limit, no markup mail clients drop or block, the plain-text part carries the same content as the HTML.
// What they CANNOT prove: how Gmail, Outlook or Apple Mail actually draw it. That stays a human check (MPC-7471 did it once, by hand, in Apple Mail and Gmail web).
export const HARD_LIMIT_BYTES = 100000;   // Gmail clips a message body near 102 KB; D4 holds every email under 100 KB
export const TARGET_BYTES = 80000;

const bytes = (s) => new TextEncoder().encode(String(s)).length;
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Elements that Gmail, Outlook (Word engine) or Apple Mail strip, block or render unpredictably in an email body.
const UNSUPPORTED_TAGS = ['script', 'iframe', 'frame', 'frameset', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'source', 'object', 'embed', 'applet', 'svg', 'canvas', 'link', 'base', 'meta http-equiv'];
// CSS that Outlook's Word engine ignores or breaks. Layout here is tables and inline styles only.
const UNSUPPORTED_CSS = [/display\s*:\s*(flex|grid|inline-flex|inline-grid)/i, /position\s*:\s*(absolute|fixed|sticky)/i, /\bfloat\s*:/i, /background(-image)?\s*:[^;"]*url\(/i, /@import/i, /var\(--/i, /calc\(/i];

export function unsupportedMarkup(html) {
  const found = [];
  for (const t of UNSUPPORTED_TAGS) {
    const re = t.includes(' ') ? new RegExp(`<${t}`, 'i') : new RegExp(`<${t}[\\s>/]`, 'i');
    if (re.test(html)) found.push(`<${t.split(' ')[0]}>`);
  }
  for (const re of UNSUPPORTED_CSS) if (re.test(html)) found.push(`css ${re.source.slice(0, 24)}`);
  if (/\son[a-z]+\s*=/i.test(html)) found.push('inline event handler');
  if (/href\s*=\s*"\s*javascript:/i.test(html)) found.push('javascript: link');
  return found;
}

/** Every https link in the HTML, entity-decoded. mailto and tel links are left out (they have no plain-text twin to compare). */
export function htmlLinks(html) {
  return [...String(html).matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => decode(m[1]));
}

const tags = (s) => (String(s).match(/FOUND · ESTIMATE|CHECKED AND CLEAR|NOT CHECKED|FOUND/g) || []);

/**
 * Checks one email. Returns a list of problems (empty = all good). `kind` 'report' also expects the two parts, the bridge line and honest status tags.
 * Plain-text parity: every link in the HTML appears in the text, and the status tags of a report appear in the same numbers in both.
 */
export function checkEmail({ html, text, kind = 'other', limit = HARD_LIMIT_BYTES, scanNumber = null, bridge = null }) {
  const problems = [];
  if (typeof html !== 'string' || !html) return ['no HTML part'];
  if (typeof text !== 'string' || !text.trim()) problems.push('no plain-text part');
  const size = bytes(html);
  if (size >= limit) problems.push(`HTML is ${size} bytes, limit ${limit}`);
  if (!/^<!DOCTYPE html>/i.test(html.trim()) || !/<html[\s>]/i.test(html) || !/<title>[^<]+<\/title>/i.test(html)) problems.push('HTML is missing doctype, <html> or <title>');
  if (!/<meta[^>]+name="viewport"/i.test(html)) problems.push('no viewport meta (phones)');
  for (const bad of unsupportedMarkup(html)) problems.push(`unsupported markup: ${bad}`);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  for (const img of imgs) { if (!/\balt=/i.test(img)) problems.push('image without alt text'); if (!/src="https:\/\//i.test(img)) problems.push('image not hosted over https (data: or cid: images are blocked or clipped)'); }
  if (typeof text === 'string' && text.trim()) {
    // The brand header link (the bare site root, with or without its utm tags, wrapping the logo) is decoration; its plain-text twin is the sign-off, so it is exempt from parity.
    for (const l of new Set(htmlLinks(html))) if (!/^https:\/\/(www\.)?myprivacytool\.io\/?(\?utm_[^#]*)?$/.test(l) && !text.includes(l.replace(/&/g, '&')) && !text.includes(l)) problems.push(`plain text lacks link ${l.replace(/[?#].*/, '')}`);
    if (kind === 'report') {
      const h = tags(html).sort().join('|'), t = tags(text).sort().join('|');
      if (h !== t) problems.push(`status tags differ: HTML has ${tags(html).length}, plain text has ${tags(text).length}`);
    }
    if (scanNumber && (!html.includes(scanNumber) || !text.includes(scanNumber))) problems.push('scan number missing from the HTML or the plain text');
  }
  if (kind === 'report') {
    if (!/Part 1/i.test(html) || !/Part 2/i.test(html)) problems.push('report: Part 1 / Part 2 headings missing from the HTML');
    if (typeof text === 'string' && (!/PART 1/.test(text) || !/PART 2/.test(text))) problems.push('report: PART 1 / PART 2 missing from the plain text');
    if (bridge && (!html.includes(bridge) || !(text || '').includes(bridge))) problems.push('report: bridge line missing');
    if (!tags(html).length) problems.push('report: no status tags (FOUND / CHECKED AND CLEAR / NOT CHECKED)');
  }
  return problems;
}
