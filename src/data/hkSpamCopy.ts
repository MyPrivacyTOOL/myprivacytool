// Bilingual copy for /HongKongSpam (MPC-7446): English and Traditional Chinese (Hong Kong usage).
// Facts come from the OFCA Do-not-call Registers public FAQ (https://www.dnc.gov.hk). Nothing here may claim the
// IVR menu keys work: they are unverified until MPC-7445 (see IVR_VERIFIED in src/config/hkDnc.ts).
import type { PageLang } from "@/lib/hkSpamPage";

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
  emailInvalid: string;
  consentNeeded: string;
  /** MPC-7538: the consent line at the email field. policyLink is the linked part; it points at the HK Stop Spam section of the Privacy Policy. */
  consentBefore: string;
  consentPolicyLink: string;
  reminderLabel: string;
  marketingLabel: string;
  marketingHint: string;
  doneButton: string;
  saving: string;
  resultTitle: string;
  resultBody: string;
  resultWeather: string;
  resultSaveFailed: string;
  resultReminderSaved: string;
  resultError: string;
  scanTitle: string;
  scanBody: string;
  scanButton: string;
  optOutTitle: string;
  optOutIntro: string;
  optOutCompany: string;
  optOutCompanyPlaceholder: string;
  optOutChannel: string;
  channels: { sms: string; email: string; letter: string };
  optOutGenerate: string;
  optOutCopy: string;
  optOutCopied: string;
  logTitle: string;
  logIntro: string;
  logPrivacy: string;
  logKind: string;
  logKinds: { call: string; sms: string };
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
  emailInvalid: "That email address does not look right.",
  consentNeeded: "Tick a box so we can use your email, or clear the email.",
  consentBefore:
    "We collect your email, your registration date, your phone type (Android, iPhone or other) and your language. We never collect your phone number. " +
    "We use them to send you one reminder on the day your protection starts. To unsubscribe, use the link in the email or write to privacy@myprivacytool.io. ",
  consentPolicyLink: "How we handle your data",
  reminderLabel: "Send me the reminder",
  marketingLabel: "Send me MyPrivacyTOOL privacy tips",
  marketingHint: "Optional. Not needed for the reminder. You can unsubscribe at any time.",
  doneButton: "Done: I have registered",
  saving: "Saving...",
  resultTitle: "You are registered",
  resultBody: "Your protection starts on {date}, the 10th Hong Kong working day after you registered.",
  resultWeather: "A black rainstorm or gale warning day is not a working day, so the date can move later by one day for each such day.",
  resultSaveFailed: "We could not save your reminder, but your date above is still correct.",
  resultReminderSaved: "Reminder saved. We will email you on that day.",
  resultError: "We could not work out the date for today. Please check dnc.gov.hk.",
  scanTitle: "Next: see what else is exposed",
  scanBody: "Spam often starts with your details being listed online. Run the free privacy scan to see where, then remove it.",
  scanButton: "Run the free privacy scan",
  optOutTitle: "Stop companies you said yes to",
  optOutIntro:
    "The register does not block a company you have given consent to. Write to each one to withdraw it. Add your own number before you send.",
  optOutCompany: "Company or bank",
  optOutCompanyPlaceholder: "e.g. Your bank, telco or shop",
  optOutChannel: "Send it by",
  channels: { sms: "SMS", email: "Email", letter: "Letter" },
  optOutGenerate: "Write my opt-out message",
  optOutCopy: "Copy message",
  optOutCopied: "Copied",
  logTitle: "Spam log (kept on this phone)",
  logIntro: "Note each spam call or SMS. If you complain to OFCA you will have the details ready.",
  logPrivacy: "Stored only in this browser. We never receive it.",
  logKind: "Type",
  logKinds: { call: "Call", sms: "SMS" },
  logSender: "Number or sender",
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
  emailInvalid: "電郵地址格式不正確。",
  consentNeeded: "請剔選一個方格讓我們使用你的電郵地址，或清除電郵地址。",
  consentBefore:
    "我們會收集你的電郵地址、登記日期、手機類型（Android、iPhone 或其他）及語言，但絕不收集你的電話號碼。" +
    "這些資料只用來在你的保障生效當日向你發送一封提醒電郵。如要取消訂閱，請按電郵內的連結，或電郵至 privacy@myprivacytool.io。",
  consentPolicyLink: "我們如何處理你的資料",
  reminderLabel: "請發送提醒給我",
  marketingLabel: "請向我發送 MyPrivacyTOOL 私隱貼士",
  marketingHint: "選填。接收提醒不需要剔選此項。你可隨時取消訂閱。",
  doneButton: "完成，我已登記",
  saving: "儲存中……",
  resultTitle: "你已完成登記",
  resultBody: "你的保障將於 {date}生效，即登記後第 10 個香港工作日。",
  resultWeather: "黑色暴雨警告日及烈風警告日不算工作日，每遇一日，生效日期便會順延一日。",
  resultSaveFailed: "未能儲存提醒電郵，但上面的日期仍然正確。",
  resultReminderSaved: "已儲存提醒，我們會在當日發電郵給你。",
  resultError: "未能計算今天的生效日期，請到 dnc.gov.hk 查詢。",
  scanTitle: "下一步：看看還有甚麼資料外洩",
  scanBody: "垃圾訊息往往源自你的資料被公開列出。立即免費掃描，看看在哪裏，然後移除。",
  scanButton: "免費私隱掃描",
  optOutTitle: "停止你曾答應接收的公司訊息",
  optOutIntro: "登記冊不會攔截你曾經同意接收的公司。請逐一去信撤回同意，並在發送前填上你自己的電話號碼。",
  optOutCompany: "公司或銀行",
  optOutCompanyPlaceholder: "例如：你的銀行、電訊商或商店",
  optOutChannel: "發送方式",
  channels: { sms: "短訊", email: "電郵", letter: "信件" },
  optOutGenerate: "撰寫退出通知",
  optOutCopy: "複製內容",
  optOutCopied: "已複製",
  logTitle: "垃圾來電記錄（只存於本機）",
  logIntro: "記下每次垃圾來電或短訊。日後向通訊辦投訴時，資料已準備好。",
  logPrivacy: "只儲存在此瀏覽器，我們不會收到。",
  logKind: "類別",
  logKinds: { call: "來電", sms: "短訊" },
  logSender: "號碼或發送者",
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

// ---------------------------------------------------------------------------------------------------------------------
// MPC-7538: the "HK Stop Spam" section of the Privacy Policy (src/pages/Privacy.tsx), English and Traditional Chinese (Hong Kong
// usage). Kept here with the page strings so MPC-7542 (native Chinese review) reads them in one file. DRAFT wording: Chris
// signs off at MPC-7545, and a lawyer should check it (not legal advice). Retention (90 days) must match the Supabase job
// mpt_purge_expired_hk_spam and the hk_spam_retention table.
// ---------------------------------------------------------------------------------------------------------------------
export const HK_POLICY_ANCHOR = { en: "hk-stop-spam", zh: "hk-stop-spam-zh" } as const;
export const HK_POLICY_PATH = "/privacy";
export const HK_RETENTION_DAYS = 90;

export interface HkPolicyBlock {
  heading: string;
  /** Plain paragraphs. */
  paragraphs?: string[];
  bullets?: string[];
}
export interface HkPolicyCopy {
  lang: string;
  title: string;
  intro: string;
  blocks: HkPolicyBlock[];
  /** Text before/after the two external links in the "not OFCA" block. */
  ofcaLinkText: string;
  pcpdLinkText: string;
}

export const HK_POLICY_EN: HkPolicyCopy = {
  lang: "en",
  title: "15. HK Stop Spam (Hong Kong Do-not-call page)",
  intro:
    "This section covers the Stop Spam page at myprivacytool.io/HongKongSpam. It sits alongside the rest of this policy. If it differs from another section for this page, this section applies.",
  blocks: [
    {
      heading: "15.1 What we hold",
      paragraphs: [
        "When you tap Done on the page, we save one record with your protection date (the 10th Hong Kong working day after you registered), the day you registered, your phone type (Android, iPhone or other), the page language, and the ad or link you came from if there was one.",
        "If you also enter your email address and tick a box, we save your email address and which boxes you ticked: \"Send me the reminder\" and \"Send me MyPrivacyTOOL privacy tips\".",
        "We never ask for, receive or store your phone number. You dial the hotline from your own phone, and we do not see the number. The spam log and opt-out messages you make on the page stay on your device.",
      ],
    },
    {
      heading: "15.2 Why we use it",
      bullets: [
        "To send you one reminder email on the day your protection starts, if you ticked \"Send me the reminder\".",
        "To send you MyPrivacyTOOL privacy tips, only if you ticked that box separately. We send no marketing email to anyone who has not ticked it.",
        "To count, without your email address, how many people use the page, if you accepted analytics cookies.",
      ],
    },
    {
      heading: "15.3 How long we keep it",
      paragraphs: [
        "We delete your email address and the whole record 90 days after your protection date. An automatic job runs every day to do this.",
        "The exception is if you ticked \"Send me MyPrivacyTOOL privacy tips\". Then we keep your record until you unsubscribe or ask us to delete it. Once you unsubscribe, the 90 days apply again and the record is deleted.",
      ],
    },
    {
      heading: "15.4 Your rights and how to use them",
      paragraphs: [
        "Under the Personal Data (Privacy) Ordinance (PDPO) of Hong Kong you can ask to see the personal data we hold about you, ask us to correct it, and ask us to stop using it for direct marketing. You can also ask us to delete it.",
        "To do any of these, email privacy@myprivacytool.io from the address you gave us, and say you mean HK Stop Spam. We may ask you to confirm it is your address. We aim to reply within 30 days. For a request to see your data, the PDPO allows up to 40 days.",
        "To stop emails, use the unsubscribe link in any email from us.",
      ],
    },
    {
      heading: "15.5 We are not OFCA",
      paragraphs: [
        "MyPrivacyTOOL is a private company. We are not OFCA, the Communications Authority or any part of the Hong Kong Government. The Do-not-call registers are run by OFCA. We cannot register your number for you and we never see the register.",
      ],
    },
  ],
  ofcaLinkText: "The official site is dnc.gov.hk.",
  pcpdLinkText: "You can also complain to the Office of the Privacy Commissioner for Personal Data (pcpd.org.hk).",
};

export const HK_POLICY_ZH: HkPolicyCopy = {
  lang: "zh-HK",
  title: "15. 香港拒收垃圾訊息頁面（HK Stop Spam）",
  intro:
    "本節適用於 myprivacytool.io/HongKongSpam 的拒收垃圾訊息頁面，並與本私隱政策其他部分一併適用。就此頁面而言，如本節與其他部分有不同，以本節為準。",
  blocks: [
    {
      heading: "15.1 我們持有的資料",
      paragraphs: [
        "當你在頁面按「完成」，我們會儲存一筆紀錄，內容包括：你的保障生效日期（登記後第 10 個香港工作天）、登記日期、手機類型（Android、iPhone 或其他）、頁面語言，以及你是經哪個廣告或連結進入（如有）。",
        "如你同時輸入電郵地址並剔選方格，我們會儲存你的電郵地址，以及你剔選了哪些方格：「請發送提醒給我」及「請向我發送 MyPrivacyTOOL 私隱貼士」。",
        "我們從不索取、接收或儲存你的電話號碼。你是用自己的手機撥打熱線，我們看不到該號碼。你在頁面建立的垃圾訊息紀錄及取消訂閱訊息只會留在你的裝置上。",
      ],
    },
    {
      heading: "15.2 我們如何使用這些資料",
      bullets: [
        "如你剔選「請發送提醒給我」，我們會在你的保障生效當日向你發送一封提醒電郵。",
        "只有在你另外剔選「私隱貼士」方格時，我們才會向你發送 MyPrivacyTOOL 私隱貼士。沒有剔選的人，我們不會發送任何推廣電郵。",
        "如你已接受分析 Cookie，我們會在不涉及你電郵地址的情況下，統計有多少人使用此頁面。",
      ],
    },
    {
      heading: "15.3 保存期限",
      paragraphs: [
        "在你的保障生效日期後 90 日，我們會刪除你的電郵地址及整筆紀錄。系統每日自動執行刪除。",
        "例外情況：如你剔選了「請向我發送 MyPrivacyTOOL 私隱貼士」，我們會保留你的紀錄，直至你取消訂閱或要求我們刪除為止。你取消訂閱後，90 日的期限會重新適用，紀錄會被刪除。",
      ],
    },
    {
      heading: "15.4 你的權利及行使方法",
      paragraphs: [
        "根據香港《個人資料（私隱）條例》，你可以要求查閱我們持有的你的個人資料、要求更正，並要求我們停止將你的資料用於直接促銷。你亦可以要求我們刪除有關資料。",
        "如要提出以上任何要求，請用你提供給我們的電郵地址，電郵至 privacy@myprivacytool.io，並註明是「HK Stop Spam」。我們可能會要求你確認該電郵地址屬於你。我們會盡量在 30 日內回覆；就查閱資料的要求，條例容許最長 40 日。",
        "如要停止接收電郵，請按我們任何一封電郵內的取消訂閱連結。",
      ],
    },
    {
      heading: "15.5 我們不是通訊辦",
      paragraphs: [
        "MyPrivacyTOOL 是私人公司，並非通訊辦（OFCA）、通訊事務管理局或香港政府任何部門。「拒收訊息登記冊」由通訊辦營運。我們不能代你登記電話號碼，也看不到登記冊內的資料。",
      ],
    },
  ],
  ofcaLinkText: "官方網站為 dnc.gov.hk。",
  pcpdLinkText: "你亦可向個人資料私隱專員公署（pcpd.org.hk）作出投訴。",
};
