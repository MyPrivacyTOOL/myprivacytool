// MPC-9888 (Open Tracker design 2.2): the consent wording, in the ONE place the site, the tests and (later) a channel bot read it from.
//
// Wording A (107 words in English) is the text Chris signed off on 2026-11-08 13:15 HKT (DECIDED 1). Wording B is not shipped. {N} is not typed
// here: it renders from CONSENT_CONFIG.n_hours (168 h = "7 days", DECIDED 2). The text carries one link: the words marked [[...]] go to /what-we-see.
//
// What is hashed. consent_text_sha256 is the SHA-256 of the exact string the visitor saw, with {N} filled in and the [[ ]] markers removed, in UTF-8.
// consent_version names this wording. Change a word => change CONSENT_CONFIG.consent_version (the Worker refuses an unknown version).
//
// Translations: the English text is the signed-off one. The nine other locales (the site's other bot/page locales) are working translations made
// for this task; the lawyer packet (MPC-6798) carries all ten with their hashes, and a native review can change a word by bumping consent_version.
import { CONSENT_CONFIG } from "./consent-config.ts";

export const CONSENT_LOCALES = ["en", "es", "fr", "de", "pt", "ja", "ko", "zh", "ar", "vi"] as const;
export type ConsentLocale = (typeof CONSENT_LOCALES)[number];

interface LocaleText {
  /** The button the consent belongs to. Pressing it is the agreement (the text says so). */
  button: string;
  /** The wording with {N} and one [[link]] marker. */
  text: string;
  /** "7 days" / "24 hours" in this language. */
  period: (hours: number) => string;
}

const days = (h: number) => h / 24;
const isDays = (h: number) => h >= 24 && h % 24 === 0;

const TEXT: Record<ConsentLocale, LocaleText> = {
  en: {
    button: "Scan me",
    text: "When you press Scan me, MyPrivacyTOOL does what trackers do, in the open. We look up the details you give us (email, name, phone, usernames) in outside services such as breach databases and public sites. We record your device and network details, including your IP address. Then we show you what each one found, [[who saw what]], and how to stop it. If you sign up, we keep a record so we can keep watching for you. If you don't, we delete your personal record {N} after your report is delivered, and you can delete it sooner, free, any time. Pressing Scan me means you agree.",
    period: (h) => (isDays(h) ? `${days(h)} ${days(h) === 1 ? "day" : "days"}` : `${h} hours`),
  },
  es: {
    button: "Escanéame",
    text: "Cuando pulsas Escanéame, MyPrivacyTOOL hace lo que hacen los rastreadores, pero a la vista. Buscamos los datos que nos das (correo, nombre, teléfono, nombres de usuario) en servicios externos, como bases de datos de filtraciones y sitios públicos. Registramos los datos de tu dispositivo y de tu red, incluida tu dirección IP. Después te mostramos qué encontró cada uno, [[quién vio qué]] y cómo frenarlo. Si te registras, guardamos un registro para seguir vigilando por ti. Si no, eliminamos tu registro personal {N} después de entregarte el informe, y puedes eliminarlo antes, gratis y cuando quieras. Pulsar Escanéame significa que aceptas.",
    period: (h) => (isDays(h) ? `${days(h)} ${days(h) === 1 ? "día" : "días"}` : `${h} horas`),
  },
  fr: {
    button: "Scannez-moi",
    text: "Quand vous appuyez sur Scannez-moi, MyPrivacyTOOL fait ce que font les traqueurs, mais au grand jour. Nous recherchons les informations que vous nous donnez (e-mail, nom, téléphone, noms d'utilisateur) auprès de services extérieurs, comme des bases de fuites de données et des sites publics. Nous enregistrons les détails de votre appareil et de votre réseau, y compris votre adresse IP. Ensuite, nous vous montrons ce que chacun a trouvé, [[qui a vu quoi]], et comment y mettre fin. Si vous vous inscrivez, nous conservons un dossier pour continuer à veiller pour vous. Sinon, nous supprimons votre dossier personnel {N} après l'envoi de votre rapport, et vous pouvez le supprimer plus tôt, gratuitement, à tout moment. Appuyer sur Scannez-moi vaut accord.",
    period: (h) => (isDays(h) ? `${days(h)} ${days(h) === 1 ? "jour" : "jours"}` : `${h} heures`),
  },
  de: {
    button: "Scanne mich",
    text: "Wenn du auf Scanne mich drückst, tut MyPrivacyTOOL, was Tracker tun, nur offen. Wir schlagen die Angaben, die du uns gibst (E-Mail, Name, Telefon, Benutzernamen), in externen Diensten nach, etwa in Datenleck-Datenbanken und auf öffentlichen Seiten. Wir erfassen die Daten deines Geräts und Netzwerks, einschließlich deiner IP-Adresse. Dann zeigen wir dir, was jeder Dienst gefunden hat, [[wer was gesehen hat]] und wie du es stoppst. Wenn du dich anmeldest, speichern wir einen Datensatz, damit wir weiter für dich wachen. Wenn nicht, löschen wir deinen persönlichen Datensatz {N} nach der Zustellung deines Berichts, und du kannst ihn jederzeit früher und kostenlos löschen. Mit dem Druck auf Scanne mich stimmst du zu.",
    period: (h) => (isDays(h) ? `${days(h)} ${days(h) === 1 ? "Tag" : "Tage"}` : `${h} Stunden`),
  },
  pt: {
    button: "Escaneie-me",
    text: "Quando você aperta Escaneie-me, o MyPrivacyTOOL faz o que os rastreadores fazem, mas às claras. Procuramos os dados que você nos dá (e-mail, nome, telefone, nomes de usuário) em serviços externos, como bases de vazamentos e sites públicos. Registramos os dados do seu dispositivo e da sua rede, incluindo o seu endereço IP. Depois mostramos o que cada um encontrou, [[quem viu o quê]] e como impedir. Se você se cadastrar, guardamos um registro para continuar vigiando por você. Se não, apagamos o seu registro pessoal {N} depois que o relatório for entregue, e você pode apagá-lo antes, de graça, a qualquer momento. Apertar Escaneie-me significa que você concorda.",
    period: (h) => (isDays(h) ? `${days(h)} ${days(h) === 1 ? "dia" : "dias"}` : `${h} horas`),
  },
  ja: {
    button: "スキャンする",
    text: "「スキャンする」を押すと、MyPrivacyTOOLはトラッカーと同じことを、隠さずに行います。あなたが入力した情報（メール、名前、電話番号、ユーザー名）を、漏えいデータベースや公開サイトなどの外部サービスで調べます。IPアドレスを含む、お使いの端末とネットワークの情報を記録します。そのうえで、それぞれが何を見つけたか、[[誰が何を見たか]]、そしてどう止めるかをお見せします。登録された場合は、見守りを続けるために記録を保管します。登録されない場合は、レポートの配信から{N}後にあなたの個人記録を削除し、それより早く、無料でいつでも削除することもできます。「スキャンする」を押すことは、同意を意味します。",
    period: (h) => (isDays(h) ? `${days(h)}日` : `${h}時間`),
  },
  ko: {
    button: "스캔하기",
    text: "'스캔하기'를 누르면 MyPrivacyTOOL은 트래커가 하는 일을 숨김없이 합니다. 입력하신 정보(이메일, 이름, 전화번호, 사용자 이름)를 유출 데이터베이스와 공개 사이트 같은 외부 서비스에서 조회합니다. IP 주소를 포함해 기기와 네트워크 정보를 기록합니다. 그런 다음 각각이 무엇을 찾았는지, [[누가 무엇을 보았는지]], 그리고 어떻게 막을 수 있는지 보여 드립니다. 가입하시면 계속 지켜볼 수 있도록 기록을 보관합니다. 가입하지 않으시면 보고서가 전달된 뒤 {N} 후에 개인 기록을 삭제하며, 언제든 더 일찍 무료로 삭제하실 수도 있습니다. '스캔하기'를 누르면 동의하신 것입니다.",
    period: (h) => (isDays(h) ? `${days(h)}일` : `${h}시간`),
  },
  zh: {
    button: "扫描我",
    text: "当你点击“扫描我”，MyPrivacyTOOL 会公开地做追踪器所做的事。我们会在外部服务（如泄露数据库和公开网站）中查询你提供的信息（邮箱、姓名、电话、用户名）。我们会记录你的设备和网络信息，包括你的 IP 地址。然后我们会告诉你每一项查到了什么、[[谁看到了什么]]，以及如何阻止。如果你注册，我们会保留一份记录，以便继续为你守望。如果你不注册，我们会在报告送达{N}后删除你的个人记录，你也可以随时提前免费删除。点击“扫描我”即表示你同意。",
    period: (h) => (isDays(h) ? `${days(h)}天` : `${h}小时`),
  },
  ar: {
    button: "افحصني",
    text: "عندما تضغط على افحصني، يفعل MyPrivacyTOOL ما تفعله أدوات التتبع، لكن علنًا. نبحث عن البيانات التي تقدمها لنا (البريد الإلكتروني والاسم والهاتف وأسماء المستخدمين) في خدمات خارجية مثل قواعد بيانات التسريبات والمواقع العامة. نسجّل تفاصيل جهازك وشبكتك، بما فيها عنوان IP الخاص بك. ثم نعرض لك ما وجده كل منها، و[[من رأى ماذا]]، وكيف توقف ذلك. إذا سجّلت، نحتفظ بسجل لنواصل المراقبة من أجلك. وإن لم تسجّل، فسنحذف سجلك الشخصي بعد {N} من تسليم تقريرك، ويمكنك حذفه قبل ذلك مجانًا في أي وقت. الضغط على افحصني يعني موافقتك.",
    period: (h) => (isDays(h) ? (days(h) === 1 ? "يوم" : days(h) === 2 ? "يومين" : `${days(h)} ${days(h) <= 10 ? "أيام" : "يومًا"}`) : `${h} ساعة`),
  },
  vi: {
    button: "Quét tôi",
    text: "Khi bạn bấm Quét tôi, MyPrivacyTOOL làm điều mà các công cụ theo dõi vẫn làm, nhưng công khai. Chúng tôi tra cứu những thông tin bạn cung cấp (email, tên, số điện thoại, tên người dùng) trong các dịch vụ bên ngoài như cơ sở dữ liệu rò rỉ và các trang công khai. Chúng tôi ghi lại thông tin thiết bị và mạng của bạn, bao gồm địa chỉ IP. Sau đó chúng tôi cho bạn thấy mỗi nơi đã tìm thấy gì, [[ai đã thấy gì]], và cách chặn lại. Nếu bạn đăng ký, chúng tôi giữ một bản ghi để tiếp tục theo dõi giúp bạn. Nếu không, chúng tôi xóa bản ghi cá nhân của bạn sau {N} kể từ khi báo cáo được gửi, và bạn có thể xóa sớm hơn, miễn phí, bất cứ lúc nào. Bấm Quét tôi nghĩa là bạn đồng ý.",
    period: (h) => (isDays(h) ? `${days(h)} ngày` : `${h} giờ`),
  },
};

export interface RenderedConsent {
  locale: ConsentLocale;
  consentVersion: string;
  nHours: number;
  button: string;
  /** Split for rendering: plain text before the link, the link words, plain text after. */
  before: string;
  link: string;
  after: string;
  /** The exact string the visitor reads (no markers). This is what is hashed. */
  plain: string;
}

/** The best supported locale for a BCP-47 tag such as "pt-BR" or "zh-Hant-HK"; English when nothing matches. */
export function pickConsentLocale(tag: string | null | undefined): ConsentLocale {
  const base = String(tag ?? "").toLowerCase().split(/[-_]/)[0];
  return (CONSENT_LOCALES as readonly string[]).includes(base) ? (base as ConsentLocale) : "en";
}

export function renderConsent(locale: ConsentLocale = "en", nHours: number = CONSENT_CONFIG.n_hours): RenderedConsent {
  const t = TEXT[locale] ?? TEXT.en;
  const filled = t.text.replace("{N}", t.period(nHours));
  const m = /^(.*?)\[\[(.+?)\]\](.*)$/s.exec(filled);
  if (!m) throw new Error(`consent text for ${locale} has no [[link]] marker`);
  return {
    locale: TEXT[locale] ? locale : "en",
    consentVersion: CONSENT_CONFIG.consent_version,
    nHours,
    button: t.button,
    before: m[1],
    link: m[2],
    after: m[3],
    plain: `${m[1]}${m[2]}${m[3]}`,
  };
}

/** SHA-256 (lowercase hex) of the exact rendered text, UTF-8. Web-standard crypto only, so it runs in the browser, Workers and Node. */
export async function consentTextSha256(plain: string): Promise<string> {
  const bytes = new TextEncoder().encode(plain);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const CONSENT_PATH = "/what-we-see";
