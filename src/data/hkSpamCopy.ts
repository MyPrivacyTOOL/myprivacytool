// Bilingual copy for /HongKongSpam (MPC-7446): English and Traditional Chinese (Hong Kong usage).
// Facts come from the OFCA Do-not-call Registers public FAQ (https://www.dnc.gov.hk). Nothing here may claim the
// IVR menu keys work: they are unverified until MPC-7445 (see IVR_VERIFIED in src/config/hkDnc.ts).
import type { PageLang } from "@/lib/hkSpamPage";
import emailCopy from "./hkSpamEmailCopy.json";

export interface HkFaq {
  q: string;
  a: string;
}

export interface HkStep {
  title: string;
  body: string;
}

export interface HkCopy {
  htmlLang: string;
  toggleLabel: string;
  toggleAria: string;
  badge: string;
  heroTitle: string;
  heroSub: string;
  cta: string;
  ctaSub: string;
  needsPhone: string;
  previewBanner: string;
  stepsTitle: string;
  steps: {
    tap: HkStep;
    dial: HkStep;
    keysManual: HkStep;
    keysAuto: HkStep;
    keysHidden: HkStep;
    finish: HkStep;
  };
  keyPurpose: { language: string; menu: string; register: string; confirm: string };
  press: string;
  keysFallback: string;
  doneTitle: string;
  emailLabel: string;
  emailHint: string;
  emailInvalid: string;
  consentNeeded: string;
  consentLabel: string;
  consentPlaceholderTag: string;
  doneButton: string;
  saving: string;
  resultTitle: string;
  resultBody: string;
  resultWeather: string;
  resultSaveFailed: string;
  resultReminderSaved: string;
  resultError: string;
  didntWork: string;
  didntWorkBody: string;
  scanTitle: string;
  scanBody: string;
  scanButton: string;
  optOutTitle: string;
  optOutIntro: string;
  optOutPick: string;
  senderTypes: { banks: string; telcos: string; retailers: string; loyalty: string };
  optOutNonePicked: string;
  optOutFor: string;
  optOutChannel: string;
  channels: { sms: string; email: string; letter: string };
  optOutGenerate: string;
  optOutCopy: string;
  optOutCopied: string;
  logTitle: string;
  logIntro: string;
  logPrivacy: string;
  logKind: string;
  logKinds: { sms: string; recorded: string; live: string; call: string };
  logExport: string;
  logExportFailed: string;
  logSender: string;
  logSenderPlaceholder: string;
  logNote: string;
  logAdd: string;
  logEmpty: string;
  logRemove: string;
  logCopyAll: string;
  logClear: string;
  faqTitle: string;
  faqs: HkFaq[];
  disclaimer: string;
  disclaimerLink: string;
  card: {
    title: string;
    body: string;
    button: string;
    nonHkNote: string;
    nonHkButton: string;
    notHkButton: string;
  };
}

/**
 * The reminder-email consent wording is a PLACEHOLDER until MPC-7538 (privacy consent + policy) finalises it. While this is
 * false the page shows a visible "placeholder" tag next to the tick-box; flip it to true in the same change that
 * pastes the final wording. Launch (HK_SPAM_INDEXABLE) is gated on MPC-7538.
 */
export const CONSENT_WORDING_FINAL = false;

export const EN: HkCopy = {
  htmlLang: "en-HK",
  toggleLabel: "繁體中文",
  toggleAria: "Switch to Traditional Chinese",
  badge: "Free · Hong Kong numbers",
  heroTitle: "Stop spam calls and SMS to your Hong Kong phone",
  heroSub:
    "Register your number on the official Do-not-call registers in one tap. We show your protection date, help you withdraw old consents and keep a private spam log on your phone.",
  cta: "Stop spam to this phone",
  ctaSub: "Opens your dialer with 1357 + 1835000. Free call, no sign-up.",
  needsPhone: "You are on a computer. Open this page on the phone you want to protect: the call must come from that phone.",
  previewBanner:
    "Internal preview: the menu keys below are UNVERIFIED placeholders (MPC-7445) and must not be relied on. Public visitors do not see this.",
  stepsTitle: "4 steps, about 1 minute",
  steps: {
    tap: { title: "Tap the big button", body: "Your phone opens the dialer with the Do-not-call hotline ready. Confirm the call if your phone asks." },
    dial: { title: "Your phone dials", body: "It dials 1357 first, so your caller ID is shown, then the hotline 1835000. It must be the phone you want to protect." },
    keysManual: { title: "Press the keys shown", body: "When the recording plays, press these keys on the keypad, in this order:" },
    keysAuto: { title: "Watch the keys", body: "Some Android dialers send the keys for you after short pauses. If the menu does not respond, press them yourself:" },
    keysHidden: { title: "Follow the spoken menu", body: "Listen to the recording, choose the option to register this number (all registers if offered) and confirm when asked." },
    finish: { title: "Hang up, then tap Done", body: "Hang up after the confirmation message, come back to this page and tap Done to see your protection date." },
  },
  keyPurpose: { language: "language", menu: "register a number", register: "register", confirm: "confirm" },
  press: "Press",
  keysFallback: "Keys on screen",
  doneTitle: "Finished the call?",
  emailLabel: "Email me when I am protected (optional)",
  emailHint: "One email on your protection date. We never store your phone number.",
  emailInvalid: "That email address does not look right.",
  consentNeeded: "Tick the box to get the reminder, or clear the email.",
  consentLabel: "Yes, email me once when my protection starts. I can unsubscribe at any time.",
  consentPlaceholderTag: "PLACEHOLDER consent wording. MPC-7538 finalises it.",
  doneButton: "Done: I have registered",
  saving: "Saving...",
  resultTitle: "You're protected from {date}",
  resultBody: "That is the 10th Hong Kong working day after you registered. Until then you can still get messages.",
  resultWeather: "A black rainstorm or gale warning day is not a working day, so the date can move later by one day for each such day.",
  resultSaveFailed: "We could not save your reminder, but your date above is still correct.",
  resultReminderSaved: "Reminder saved. We will email you on that day.",
  resultError: "We could not work out the date for today. Please check dnc.gov.hk.",
  didntWork: "Didn't work?",
  didntWorkBody: "Tell us what happened. We attach your phone type and language so we can help faster.",
  scanTitle: "Next: see what else is exposed",
  scanBody: "Spam often starts with your details being listed online. Run the free privacy scan to see where, then remove it.",
  scanButton: "Run the free privacy scan",
  optOutTitle: "Stop companies you said yes to",
  optOutIntro:
    "The register does not block a company you have given consent to. Tick the kinds of sender you have said yes to, then copy a message for each. Add your own number and the sender's name before you send.",
  optOutPick: "Who have you said yes to?",
  senderTypes: { banks: "Banks", telcos: "Phone and mobile companies", retailers: "Shops and retailers", loyalty: "Loyalty and rewards schemes" },
  optOutNonePicked: "Tick at least one kind of sender.",
  optOutFor: "Message for",
  optOutChannel: "Send it by",
  channels: { sms: "SMS", email: "Email", letter: "Letter" },
  optOutGenerate: "Write my opt-out messages",
  optOutCopy: "Copy message",
  optOutCopied: "Copied",
  logTitle: "Spam log (kept on this phone)",
  logIntro: "Note each spam call or SMS. If you complain to OFCA you will have the details ready.",
  logPrivacy: "Stored only in this browser. We never receive it.",
  logKind: "Type",
  logKinds: { sms: "SMS", recorded: "Recorded call", live: "Live call", call: "Call" },
  logExport: "Export log (CSV)",
  logExportFailed: "Your browser blocked the download. Use Copy whole log instead.",
  logSender: "Number",
  logSenderPlaceholder: "e.g. +852 5555 0000 or a sender name",
  logNote: "Note (optional)",
  logAdd: "Add to log",
  logEmpty: "Nothing logged yet.",
  logRemove: "Remove",
  logCopyAll: "Copy whole log",
  logClear: "Clear log",
  faqTitle: "Questions and answers",
  faqs: [
    { q: "Is registering free?", a: "Yes. The Do-not-call registers are free, with no fee, deadline or expiry." },
    {
      q: "When am I protected?",
      a: "From the 10th working day after you register. A working day is any day except public holidays, black rainstorm days and gale warning days. Sundays are holidays, Saturdays are not. The date on this page is our calculation; weather days can push it later.",
    },
    {
      q: "Why do companies I know still message me?",
      a: "Consent beats the register. If you agreed to hear from a bank, telco or shop, it may keep messaging you until you tell that sender to stop. Use the opt-out message generator on this page for each one.",
    },
    {
      q: "Does it stop live telemarketers and scammers?",
      a: "No. The registers cover SMS and MMS, pre-recorded calls and fax. A live person calling you is not covered, and scammers ignore the rules. If you suspect a scam, call the Police Anti-Scam Helpline 18222.",
    },
    {
      q: "Which registers does this cover?",
      a: "Hong Kong has three: the Short Messages register, the Pre-recorded register and the Fax register. There is no email register.",
    },
    {
      q: "How do I check or cancel my registration?",
      a: "Call the hotline from the registered number, or check at dnc.gov.hk. To cancel, call and choose the option to cancel a registered number; it is removed by the end of the day.",
    },
    {
      q: "Do I need to register again if I change network?",
      a: "No, a ported number stays registered. If a number is terminated and later given to you again, register it again.",
    },
    {
      q: "Does MyPrivacyTOOL see my phone number?",
      a: "No. The call must come from your own phone, so we cannot register for you and we never see your number. We only record the day you tapped Done, your phone type and language.",
    },
  ],
  disclaimer:
    "MyPrivacyTOOL is not OFCA and is not a government service. We only help you make the free call yourself. The official source and the rules are at",
  disclaimerLink: "dnc.gov.hk",
  card: {
    title: "Stop spam calls and SMS in Hong Kong",
    body: "Register your Hong Kong number on the free Do-not-call registers in one tap.",
    button: "Stop spam to this phone",
    nonHkNote: "Stop Spam is for Hong Kong numbers.",
    nonHkButton: "I have a Hong Kong number",
    notHkButton: "Not a Hong Kong number",
  },
};

export const ZH: HkCopy = {
  htmlLang: "zh-HK",
  toggleLabel: "English",
  toggleAria: "切換至英文",
  badge: "免費 · 香港號碼",
  heroTitle: "一鍵拒收香港垃圾來電及短訊",
  heroSub: "一鍵登記「拒收訊息登記冊」。我們會計算保障生效日期，協助你撤回過往的同意，並在你的手機內記錄垃圾來電及短訊。",
  cta: "停止這部手機收到垃圾訊息",
  ctaSub: "會開啟撥號介面，號碼為 1357 + 1835000。免費，無須註冊。",
  needsPhone: "你正使用電腦。請在需要保障的手機上開啟本頁，因為必須由該部手機撥打。",
  previewBanner: "內部預覽：以下選單按鍵為「未核實」的暫代數字（MPC-7445），不可依賴。一般訪客不會看到此提示。",
  stepsTitle: "4 個步驟，約 1 分鐘",
  steps: {
    tap: { title: "按下大按鈕", body: "手機會開啟撥號介面並填好拒收訊息登記冊熱線。如手機詢問，請確認撥出。" },
    dial: { title: "手機自動撥號", body: "先撥 1357 以顯示你的來電號碼，再撥熱線 1835000。必須使用你想登記的手機。" },
    keysManual: { title: "按下顯示的數字", body: "錄音播出時，請按次序在數字鍵盤按下：" },
    keysAuto: { title: "留意按鍵", body: "部分 Android 撥號程式會在短暫停頓後自動送出按鍵。如選單沒有反應，請自行按下：" },
    keysHidden: { title: "跟隨語音選單", body: "留心收聽錄音，選擇登記此號碼的選項（如有提供，請選擇所有登記冊），並在提示時確認。" },
    finish: { title: "掛線，然後按「完成」", body: "聽到確認訊息後掛線，返回本頁並按「完成」，便可看到保障生效日期。" },
  },
  keyPurpose: { language: "語言", menu: "登記號碼", register: "登記冊", confirm: "確認" },
  press: "按",
  keysFallback: "畫面顯示的按鍵",
  doneTitle: "通話完成了嗎？",
  emailLabel: "保障生效時以電郵通知我（選填）",
  emailHint: "只會在生效當日發送一封電郵。我們不會儲存你的電話號碼。",
  emailInvalid: "電郵地址格式不正確。",
  consentNeeded: "請剔選方格以接收提醒，或清除電郵地址。",
  consentLabel: "是，請在保障生效時發電郵通知我一次。我可隨時取消訂閱。",
  consentPlaceholderTag: "暫代的同意聲明文字，最終內容由 MPC-7538 確定。",
  doneButton: "完成，我已登記",
  saving: "儲存中……",
  resultTitle: "你由 {date}起受保障",
  resultBody: "即登記後第 10 個香港工作日。在此之前，你仍可能收到訊息。",
  resultWeather: "黑色暴雨警告日及烈風警告日不算工作日，每遇一日，生效日期便會順延一日。",
  resultSaveFailed: "未能儲存提醒電郵，但上面的日期仍然正確。",
  resultReminderSaved: "已儲存提醒，我們會在當日發電郵給你。",
  resultError: "未能計算今天的生效日期，請到 dnc.gov.hk 查詢。",
  didntWork: "不成功？",
  didntWorkBody: "告訴我們發生了甚麼事。我們會附上你的手機類型及語言，以便更快協助你。",
  scanTitle: "下一步：看看還有甚麼資料外洩",
  scanBody: "垃圾訊息往往源自你的資料被公開列出。立即免費掃描，看看在哪裏，然後移除。",
  scanButton: "免費私隱掃描",
  optOutTitle: "停止你曾答應接收的公司訊息",
  optOutIntro: "登記冊不會攔截你曾經同意接收的公司。請剔選你曾答應接收訊息的發送者類別，再逐一複製通知。發送前請填上你自己的電話號碼及發送者名稱。",
  optOutPick: "你曾答應哪些類別接收訊息？",
  senderTypes: { banks: "銀行", telcos: "電訊及流動電話公司", retailers: "商店及零售商", loyalty: "會員及積分計劃" },
  optOutNonePicked: "請至少剔選一個類別。",
  optOutFor: "通知對象：",
  optOutChannel: "發送方式",
  channels: { sms: "短訊", email: "電郵", letter: "信件" },
  optOutGenerate: "撰寫退出通知",
  optOutCopy: "複製內容",
  optOutCopied: "已複製",
  logTitle: "垃圾來電記錄（只存於本機）",
  logIntro: "記下每次垃圾來電或短訊。日後向通訊辦投訴時，資料已準備好。",
  logPrivacy: "只儲存在此瀏覽器，我們不會收到。",
  logKind: "類別",
  logKinds: { sms: "短訊", recorded: "錄音來電", live: "真人來電", call: "來電" },
  logExport: "匯出記錄（CSV）",
  logExportFailed: "瀏覽器封鎖了下載。請改用「複製全部記錄」。",
  logSender: "號碼",
  logSenderPlaceholder: "例如 +852 5555 0000 或發送者名稱",
  logNote: "備註（選填）",
  logAdd: "加入記錄",
  logEmpty: "暫時沒有記錄。",
  logRemove: "刪除",
  logCopyAll: "複製全部記錄",
  logClear: "清除記錄",
  faqTitle: "常見問題",
  faqs: [
    { q: "登記要收費嗎？", a: "免費。拒收訊息登記冊不收費，沒有期限，也不會過期。" },
    {
      q: "我何時開始受保障？",
      a: "由登記後第 10 個工作日起生效。工作日指公眾假期、黑色暴雨警告日及烈風警告日以外的日子；星期日屬假期，星期六不是。本頁的日期是我們計算所得，遇上惡劣天氣日可能順延。",
    },
    {
      q: "為何我認識的公司仍然傳訊息給我？",
      a: "同意優先於登記冊。如你曾同意銀行、電訊商或商店向你發送訊息，在你要求該發送者停止之前，它仍可繼續發送。請用本頁的退出通知為每間公司撰寫通知。",
    },
    {
      q: "可以阻止真人電話推銷和詐騙來電嗎？",
      a: "不可以。登記冊涵蓋短訊及多媒體訊息、預錄電話訊息和傳真。真人撥打的電話不在範圍內，詐騙分子亦不會理會規則。如懷疑受騙，請致電警方反詐騙協調中心熱線 18222。",
    },
    {
      q: "這涵蓋哪些登記冊？",
      a: "香港設有三個登記冊：短訊登記冊、預錄訊息登記冊和傳真登記冊。沒有電郵登記冊。",
    },
    {
      q: "如何查詢或取消登記？",
      a: "用已登記的號碼致電熱線，或到 dnc.gov.hk 查詢。如要取消，致電後選擇取消已登記號碼的選項，號碼會在當日完結前移除。",
    },
    {
      q: "轉台後要重新登記嗎？",
      a: "不用，攜號轉台後號碼仍然登記。如號碼被終止後再次分配給你，便需要重新登記。",
    },
    {
      q: "MyPrivacyTOOL 會看到我的電話號碼嗎？",
      a: "不會。通話必須由你自己的手機撥出，所以我們無法代你登記，也看不到你的號碼。我們只記錄你按「完成」的日子、手機類型和語言。",
    },
  ],
  disclaimer: "MyPrivacyTOOL 並非通訊辦（OFCA），也不是政府服務。我們只協助你自己撥打這個免費熱線。官方資料及規定請見",
  disclaimerLink: "dnc.gov.hk",
  card: {
    title: "拒收香港垃圾來電及短訊",
    body: "一鍵把你的香港號碼登記到免費的拒收訊息登記冊。",
    button: "停止這部手機收到垃圾訊息",
    nonHkNote: "「拒收垃圾訊息」只適用於香港電話號碼。",
    nonHkButton: "我有香港電話號碼",
    notHkButton: "我沒有香港電話號碼",
  },
};

export const HK_COPY: Record<PageLang, HkCopy> = { en: EN, zh: ZH };

/**
 * MPC-7448: the day-10 "you are now protected" email strings (English and Traditional Chinese). They live in hkSpamEmailCopy.json
 * so the Worker can use the same text (workers/scan-report/scripts/sync-hk-email-copy.mjs); they are part of the MPC-7542 Chinese review.
 */
export const HK_EMAIL_COPY = emailCopy;
