// Consent clean-up opt-out text generator (MPC-7446). Registering on the Do-not-call registers does NOT stop
// senders the user has consented to; the user must withdraw consent with each sender. This builds that message.
// Nothing is stored or sent: the text is built in the browser and the user copies it.
export type OptOutChannel = "sms" | "email" | "letter";

export interface OptOutInput {
  company: string;
  channel: OptOutChannel;
  lang: "en" | "zh";
}

const NUMBER_PLACEHOLDER = { en: "[my phone number]", zh: "[我的電話號碼]" } as const;

export function buildOptOutText({ company, channel, lang }: OptOutInput): string {
  const name = company.trim().slice(0, 80) || (lang === "zh" ? "貴公司" : "your company");
  const num = NUMBER_PLACEHOLDER[lang];
  if (lang === "zh") {
    if (channel === "sms") {
      return `${name}：我撤回先前給予的同意，請即停止向 ${num} 發送任何商業電子訊息（包括推銷短訊及來電），並將我從所有推廣名單中移除。請回覆確認。`;
    }
    const head = channel === "email" ? "主旨：撤回同意及取消接收推廣訊息\n\n" : "";
    return `${head}${name} 負責人：\n\n本人 ${num} 現根據《非應邀電子訊息條例》，撤回先前給予貴公司的一切同意，要求貴公司即日起停止向上述號碼發送商業電子訊息，並停止使用本人的個人資料作直接促銷用途。請於收到本函後以書面確認已處理。\n\n謝謝。`;
  }
  if (channel === "sms") {
    return `${name}: I withdraw any consent I gave you. Please stop sending commercial messages and marketing calls to ${num} and remove me from all marketing lists. Please confirm.`;
  }
  const head = channel === "email" ? "Subject: Withdrawal of consent and unsubscribe request\n\n" : "";
  return `${head}Dear ${name},\n\nUnder the Unsolicited Electronic Messages Ordinance, I withdraw all consent I have previously given you to send commercial electronic messages to ${num}. Please stop sending them from today and stop using my personal data for direct marketing. Please confirm in writing once this is done.\n\nThank you.`;
}
