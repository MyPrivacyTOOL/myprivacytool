// MPC-10614: the 11 path tiles AHEAD of the arrival, as DATA (design brief v1 section 3, signed off 2026-11-09). One entry per tile.
// Nothing here runs a check. `handlerKey` names the handler a tile WOULD use; only keys listed in LIVE_HANDLERS (src/components/FootprintPath.tsx)
// are wired to something that really runs today. Every other tile renders disabled with its status marker. Do not add a handler until the check exists.
// Marker meanings (Build Spine F9): Live = exists and running today; In build = built or merged but off, or in this sprint; Planned = designed, not built.
// Where a tile has parts at different states the marker is the weakest part. Copy is at most 12 words and may use {handle} and {name}.
// Banned on the path (brief section 4): detected, verified, safe, clean, hidden, private. No retention or deletion line on any tile (decision 3, MPC-6798).

export type TileKind = 'GUESS' | 'PRIZE';
export type TileStatus = 'Live' | 'In build' | 'Planned';

export interface PathTile {
  n: number;
  kind: TileKind;
  /** On-tile copy, at most 12 words. */
  copy: string;
  /** Two-word label used when the tile is shown ahead of you. */
  shortLabel: string;
  status: TileStatus;
  /** What someone could do with this data, shown before any ask (Core Model section 4: education before acceptance). */
  education: string;
  /** What the person gets if they step (for the weak/disabled state this is a description, not a result). */
  ifStep: string;
  /** The ask's gate, in words. null = none beyond the yes. */
  consentGate: string | null;
  /** Key into LIVE_HANDLERS. A key that is not there means the tile is disabled. */
  handlerKey: string;
  /** A guess's confidence as a word with pips, never a number (brief tile 2). */
  confidence?: { word: string; pips: 1 | 2 | 3 | 4 | 5 };
  /** Other tiles that must be answered first. */
  needs?: number[];
  /** The print a yes / a completed step leaves. Shade is a PROPOSAL until the registry carries it (MPC-9901). */
  print?: { label: string; shade: 1 | 2 | 3 | 4 | 5; source: 'given' | 'checked' };
  /** Shown instead of a result when the tile is honest about not checking (tile 10). */
  notCheckedNote?: string;
  link?: { label: string; href: string };
  paid?: boolean;
}

export const PATH_TILES: PathTile[] = [
  { n: 1, kind: 'GUESS', copy: '{name} looks like a real name. Is that you?', shortLabel: 'Real name', status: 'Planned',
    education: 'A real name lets someone search for you on other sites.', ifStep: 'A "real name" print, you told us.',
    consentGate: null, handlerKey: 'name_pattern_guess', confidence: { word: 'probably', pips: 3 }, print: { label: 'Real name (you told us)', shade: 2, source: 'given' } },
  { n: 2, kind: 'GUESS', copy: 'You probably use {handle} on other sites too. True?', shortLabel: 'Same handle', status: 'Planned',
    education: 'One handle used in many places links your accounts together.', ifStep: 'The handle is marked as yours. Nothing is searched.',
    consentGate: null, handlerKey: 'handle_self_report', confidence: { word: 'probably', pips: 3 }, print: { label: 'Handle is yours (you told us)', shade: 4, source: 'given' } },
  { n: 3, kind: 'PRIZE', copy: 'Share your number: see where it was issued.', shortLabel: 'Phone number', status: 'Planned',
    education: 'A phone number links you across services and can be used to impersonate you.', ifStep: 'A print saying where the number was issued, from its prefix only.',
    consentGate: 'You tap Telegram\'s share-contact button after a one-line consent. Wording needs MPC-6798.', handlerKey: 'phone_share_contact',
    print: { label: 'Number issued in Hong Kong (+852)', shade: 4, source: 'given' } },
  { n: 4, kind: 'PRIZE', copy: 'Add your email: see what it gives away.', shortLabel: 'Your email', status: 'Planned',
    education: 'An email address can be matched to profile pictures, domains and accounts.', ifStep: 'Prints for mail provider, public profile pictures, website records and a name-in-address guess.',
    consentGate: 'Double opt-in email (MPC-9224); the GitHub commit search needs its own consent.', handlerKey: 'email_checks' },
  { n: 5, kind: 'PRIZE', copy: 'Open your browser view: see where you appear to be.', shortLabel: 'Browser view', status: 'In build',
    education: 'Your browser tells every site your approximate city, device and browser.', ifStep: 'Prints for approximate city (an estimate), device, browser and provider, from your browser, not Telegram. The web checks go to the technical panel.',
    consentGate: 'Opening the one-time link is the scan consent. Privacy 2.3 wording is open (MPC-9828).', handlerKey: 'telegram_web_handoff' },
  { n: 6, kind: 'PRIZE', copy: 'Find where {handle} also appears online.', shortLabel: 'Handle search', status: 'Planned', paid: true, needs: [2],
    education: 'Where a handle appears shows how far your accounts can be followed.', ifStep: 'One print per site where the handle exists.',
    consentGate: 'Separate external-search consent, proof the handle is yours, provider and budget review.', handlerKey: 'handle_site_search' },
  { n: 7, kind: 'PRIZE', copy: 'Check where else this photo appears online.', shortLabel: 'Photo search', status: 'Planned', paid: true,
    education: 'A photo that appears in many places can be used to find or imitate you.', ifStep: 'Prints for any matching pages found. No face matching.',
    consentGate: 'External-search consent, proof the photo is yours, terms and cost review.', handlerKey: 'photo_reverse_search' },
  { n: 8, kind: 'PRIZE', copy: 'Change a setting, then see what we still see.', shortLabel: 'Before, after', status: 'Planned',
    education: 'Your own Telegram settings decide what a bot like this one can read.', ifStep: 'Before and after, scoped: returned to this bot before, not returned in the latest check.',
    consentGate: 'Lookup consent. MPT never asks for a login and never changes settings.', handlerKey: 'setting_recheck' },
  { n: 9, kind: 'GUESS', copy: 'Your account looks a few years old. Right?', shortLabel: 'Account age', status: 'Planned',
    education: 'The age of an account is a small clue that helps tell real from fake.', ifStep: 'An "account age (estimate)" print.',
    consentGate: null, handlerKey: 'account_age_guess', confidence: { word: 'maybe', pips: 2 }, print: { label: 'Account age (estimate)', shade: 1, source: 'given' } },
  { n: 10, kind: 'PRIZE', copy: 'Is your email in a known breach? Find out.', shortLabel: 'Breach check', status: 'Planned', paid: true, needs: [4],
    education: 'Leaked emails are used to try your passwords on other sites.', ifStep: 'Not checked here. You can check yourself with the free service linked on the tile.',
    consentGate: 'Email-ownership proof, scan consent, provider named in Privacy and the registry; paid tier.', handlerKey: 'breach_lookup',
    notCheckedNote: 'Not checked here.', link: { label: 'Check yourself at Have I Been Pwned', href: 'https://haveibeenpwned.com/' } },
  { n: 11, kind: 'PRIZE', copy: 'Tell us who can see your number. We cannot check.', shortLabel: 'Number setting', status: 'Planned',
    education: 'If strangers can see your number, they can use it to find or contact you.', ifStep: 'A plain guide to the setting. Recorded as you told us.',
    consentGate: null, handlerKey: 'number_visibility_note' },
];

/** Shade rule (brief section 5, PROPOSED): base sensitivity 1-3, +1 if anyone can see it, +1 if it links across services, capped at 5. Pips and the word always accompany the colour. */
export const SHADES = {
  1: { hex: '#FDE6E3', word: 'Slight', meaning: 'Little can be done with it', dark: false },
  2: { hex: '#F8BDB5', word: 'Mild', meaning: 'Mildly identifying', dark: false },
  3: { hex: '#EE847A', word: 'Moderate', meaning: 'Useful to someone profiling you', dark: false },
  4: { hex: '#D3433A', word: 'Strong', meaning: 'Strongly identifying or linkable', dark: true },
  5: { hex: '#8F1812', word: 'Severe', meaning: 'Directly harmful in the wrong hands', dark: true },
} as const;
export type Shade = keyof typeof SHADES;

/** The arrival prints (brief section 2). Proposed shades per tg.* hexagon until MPC-9901 puts a sensitivity in the registry. `profile` prints are conditional (decision 4). */
export interface ArrivalPrintDef { key: string; label: string; ids: string[]; shade: Shade; source: 'taken' | 'checked'; profile?: boolean }
export const ARRIVAL_PRINTS: ArrivalPrintDef[] = [
  { key: 'username', label: '@username', ids: ['tg.username'], shade: 4, source: 'taken' },
  { key: 'name', label: 'Name you show', ids: ['tg.first_name', 'tg.last_name'], shade: 2, source: 'taken' },
  { key: 'language', label: 'Language setting', ids: ['tg.language'], shade: 1, source: 'taken' },
  { key: 'numeric_id', label: 'Telegram ID', ids: ['tg.numeric_id'], shade: 3, source: 'taken' },
  { key: 'profile', label: 'Public profile', ids: ['tg.photo_current', 'tg.bio', 'tg.birthday'], shade: 4, source: 'checked', profile: true },
];
