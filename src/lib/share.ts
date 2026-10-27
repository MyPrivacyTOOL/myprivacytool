// MPC-8451: share the scan. Plain links only: no third-party share widget or script is loaded, so nothing is sent to a network until the visitor
// clicks. The shared URL is always the public scan page: never the visitor's email, scan number, results or referral code. Each channel gets
// its own utm_medium so shares show up in analytics by channel. The wording is a first draft and needs Chris's approval.
export const SHARE_PAGE = "https://www.myprivacytool.io/scan";
export const SHARE_TEXT = "I just checked what the internet knows about me with MyPrivacyTOOL. It is free and needs no card. Worth a look:";
export const SHARE_SUBJECT = "Check what the internet knows about you";

export type ShareChannel = "native" | "whatsapp" | "x" | "linkedin" | "facebook" | "email" | "copy";

/** The public scan page tagged for one channel. */
export function shareUrl(channel: ShareChannel): string {
  return `${SHARE_PAGE}?utm_source=share&utm_medium=${channel}&utm_campaign=scan_share`;
}

export type ShareLink = { id: Exclude<ShareChannel, "native" | "copy">; label: string; href: string };

export function shareLinks(): ShareLink[] {
  const t = (c: ShareChannel) => encodeURIComponent(`${SHARE_TEXT} ${shareUrl(c)}`);
  const u = (c: ShareChannel) => encodeURIComponent(shareUrl(c));
  return [
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${t("whatsapp")}` },
    { id: "x", label: "X", href: `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}&url=${u("x")}` },
    { id: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u("linkedin")}` },
    { id: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u("facebook")}` },
    { id: "email", label: "Email", href: `mailto:?subject=${encodeURIComponent(SHARE_SUBJECT)}&body=${t("email")}` },
  ];
}
