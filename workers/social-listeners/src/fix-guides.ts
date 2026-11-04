// MPC-7894 fix wizard guides. A guide with `evidence: null` has not been checked against a real Telegram client and is shown with DRAFT_BANNER. Chris reviewed the
// 9 published guides on 27th October 2026 on an iPhone 14 (all steps matched); app version 11.2. The user changes their own
// settings; nothing here changes an account. "api" issues can be re-checked through getChat/getUserProfilePhotos; "self" issues can only be self-confirmed.
export interface GuideEvidence { client: string; platform: string; version: string; reviewedOn: string }
export interface Option { label: string; advice: string }
export interface Guide {
  code: string; label: string; kind: "api" | "self"; hexagon: string | null;
  question: string; options: [Option, Option]; steps: string[];
  /** null until reviewed against a real client. */
  evidence: GuideEvidence | null;
  /** false = listed feature could not be verified; kept out of the keyboard and recorded as a specification conflict. */
  available: boolean; conflict?: string;
}

/** Review of the 9 published guides by Chris (owner). Version 11.2 as given by Chris. No Android client was reviewed. */
const REVIEW: GuideEvidence = { client: "Telegram iPhone app", platform: "iOS, iPhone 14", version: "11.2", reviewedOn: "27th October 2026" };

export const DRAFT_BANNER = "Draft guide: these steps have not been checked against the current Telegram app yet, and menu names differ by app version. If something looks different, skip it.";

export const GUIDES: Guide[] = [
  { code: "un", label: "Username", kind: "api", hexagon: "tg.username", evidence: REVIEW, available: true,
    question: "Do you need a public @username, for example so people can find you for work or networking?",
    options: [
      { label: "Yes, I need it", advice: "You can keep it. Consider a handle that is not your real name or used on other sites, and keep it out of places you do not want linked to you." },
      { label: "No, remove it", advice: "Removing it means people can no longer find you by @name." },
    ],
    steps: ["Open Telegram > Settings.", "Open Username (or Edit profile, depending on your app).", "Change it, or clear it to remove it.", "Come back and tap \"I fixed it\"."] },
  { code: "bi", label: "Bio", kind: "api", hexagon: "tg.bio", evidence: REVIEW, available: true,
    question: "Does your bio contain anything you would not want a stranger to read (employer, city, links)?",
    options: [
      { label: "Yes", advice: "Remove or shorten those parts." },
      { label: "No, but I want it empty", advice: "Clearing the bio is optional; an empty bio gives nothing to read." },
    ],
    steps: ["Open Telegram > Settings > Edit profile.", "Edit the Bio field, or clear it.", "Save, then tap \"I fixed it\"."] },
  { code: "bd", label: "Birthday", kind: "api", hexagon: "tg.birthday", evidence: REVIEW, available: true,
    question: "Do you want friends or contacts to see your birthday?",
    options: [
      { label: "Yes, contacts only", advice: "Keep the birthday but limit who can see it in the birthday privacy setting." },
      { label: "No, nobody", advice: "Remove the birthday or set its visibility to nobody." },
    ],
    steps: ["Open Telegram > Settings > Edit profile > Birthday (add/remove).", "Open Settings > Privacy and Security > Birthday to choose who can see it.", "Then tap \"I fixed it\"."] },
  { code: "ph", label: "Profile photo", kind: "api", hexagon: "tg.photo_current", evidence: REVIEW, available: true,
    question: "Do you want a profile photo visible to people who are not your contacts?",
    options: [
      { label: "Yes", advice: "Choose a photo that does not show your location, workplace or children, and limit who can see it in Privacy settings." },
      { label: "No", advice: "Remove the photo, or restrict it to contacts." },
    ],
    steps: ["Open Telegram > Settings > Edit profile to change or remove the photo.", "Open Settings > Privacy and Security > Profile Photos to choose who can see it.", "Then tap \"I fixed it\"."] },
  { code: "pn", label: "Phone number", kind: "self", hexagon: null, evidence: REVIEW, available: true,
    question: "Do people who have your number need to find you on Telegram by it?",
    options: [
      { label: "Yes, contacts", advice: "Limit who can see it to My Contacts, and limit who can find you by number." },
      { label: "No", advice: "Set both to Nobody." },
    ],
    steps: ["Open Telegram > Settings > Privacy and Security > Phone Number.", "Choose who can see your number and who can find you by it.", "Then tap \"I fixed it\". I cannot check this setting, so it stays self-confirmed."] },
  { code: "ls", label: "Last seen", kind: "self", hexagon: null, evidence: REVIEW, available: true,
    question: "Is it fine for contacts to see when you were last online?",
    options: [
      { label: "Yes, contacts", advice: "Set Last Seen & Online to My Contacts." },
      { label: "No", advice: "Set Last Seen & Online to Nobody (you will not see others' either)." },
    ],
    steps: ["Open Telegram > Settings > Privacy and Security > Last Seen & Online.", "Choose who can see it.", "Then tap \"I fixed it\". I cannot check this setting, so it stays self-confirmed."] },
  { code: "fw", label: "Forwarded messages", kind: "self", hexagon: null, evidence: REVIEW, available: true,
    question: "Should people be able to link a message you send back to your profile when it is forwarded?",
    options: [
      { label: "Yes", advice: "Leave it as it is." },
      { label: "No", advice: "Set Forwarded Messages so your name is not linked when messages are forwarded." },
    ],
    steps: ["Open Telegram > Settings > Privacy and Security > Forwarded Messages.", "Choose who can link to your account when you forward.", "Then tap \"I fixed it\". I do not treat this as verified, so it stays self-confirmed."] },
  { code: "gp", label: "Groups", kind: "self", hexagon: null, evidence: REVIEW, available: true,
    question: "Should anyone be able to add you to groups?",
    options: [
      { label: "Yes", advice: "Leave it as it is." },
      { label: "No, contacts only", advice: "Restrict who can add you to groups." },
    ],
    steps: ["Open Telegram > Settings > Privacy and Security > Groups & Channels.", "Choose who can add you.", "Then tap \"I fixed it\". I cannot check this setting, so it stays self-confirmed."] },
  { code: "nb", label: "People Nearby", kind: "self", hexagon: null, evidence: null, available: false,
    conflict: "MPC-7894 lists People Nearby. Whether the feature exists in current Telegram clients has not been verified, so no guide is published. Decision needed: drop it or supply a verified client and version.",
    question: "", options: [{ label: "", advice: "" }, { label: "", advice: "" }], steps: [] },
  { code: "ad", label: "Auto-download", kind: "self", hexagon: null, evidence: REVIEW, available: true,
    question: "Do you want photos and files from other people downloaded automatically?",
    options: [
      { label: "Yes", advice: "Leave it as it is." },
      { label: "No", advice: "Turn off auto-download for chats you do not trust." },
    ],
    steps: ["Open Telegram > Settings > Data and Storage > Auto-Download Media.", "Change what downloads automatically.", "Then tap \"I fixed it\". I cannot check this setting, so it stays self-confirmed."] },
];

export const guideFor = (code: string): Guide | undefined => GUIDES.find((g) => g.code === code);
export const listedGuides = (): Guide[] => GUIDES.filter((g) => g.available);
