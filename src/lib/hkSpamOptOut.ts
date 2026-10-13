// Consent clean-up opt-out text generator (MPC-7446). Registering on the Do-not-call registers does NOT stop
// senders the user has consented to; the user must withdraw consent with each sender. This builds that message.
// Wording is generic on purpose: sender TYPES only, no company names or logos. Nothing is stored or sent: the text
// is built in the browser and the user copies it.
export type OptOutChannel = "sms" | "email" | "letter";
export type SenderType = "banks" | "telcos" | "retailers" | "loyalty";
export const SENDER_TYPES: readonly SenderType[] = ["banks", "telcos", "retailers", "loyalty"];

export interface OptOutInput {
  sender: SenderType;
  channel: OptOutChannel;
  lang: "en" | "zh";
}

const NUMBER_PLACEHOLDER = { en: "[my phone number]", zh: "[我的電話號碼]" } as const;
const ACCOUNT_PLACEHOLDER = { en: "[my account or member number, if any]", zh: "[我的帳戶或會員編號（如有）]" } as const;

/** Salutation per sender type: the user replaces it with the real name before sending. */
const SENDER_NAME = {
  en: { banks: "my bank", telcos: "my mobile or phone company", retailers: "the shop", loyalty: "the rewards programme" },
  zh: { banks: "我的銀行", telcos: "我的電訊商", retailers: "商店", loyalty: "會員積分計劃" },
} as const;

export function buildOptOutText({ sender, channel, lang }: OptOutInput): string {
  const who = SENDER_NAME[lang][sender];
  const num = NUMBER_PLACEHOLDER[lang];
  const acct = ACCOUNT_PLACEHOLDER[lang];
  if (lang === "zh") {
    if (channel === "sms") {
      return `致${who}：我撤回先前給予的同意，請即停止向 ${num} 發送任何商業電子訊息（包括推銷短訊及來電），並將我從所有推廣名單中移除。${acct}。請回覆確認。`;
    }
    const head = channel === "email" ? "主旨：撤回同意及取消接收推廣訊息\n\n" : "";
    return `${head}${who}負責人：\n\n本人 ${num}（${acct}）現根據《非應邀電子訊息條例》，撤回先前給予貴方的一切同意，要求貴方即日起停止向上述號碼發送商業電子訊息，並停止使用本人的個人資料作直接促銷用途。請於收到本函後以書面確認已處理。\n\n謝謝。`;
  }
  if (channel === "sms") {
    return `To ${who}: I withdraw any consent I gave you. Please stop sending commercial messages and marketing calls to ${num} and remove me from all marketing lists. ${acct}. Please confirm.`;
  }
  const head = channel === "email" ? "Subject: Withdrawal of consent and unsubscribe request\n\n" : "";
  return `${head}Dear ${who},\n\nUnder the Unsolicited Electronic Messages Ordinance, I withdraw all consent I have previously given you to send commercial electronic messages to ${num} (${acct}). Please stop sending them from today and stop using my personal data for direct marketing. Please confirm in writing once this is done.\n\nThank you.`;
}
