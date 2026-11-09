// MPC-9893 (Open Tracker design 1.6): the ONE pure function that turns a registry entry into words for a person. Shared by /what-we-see (every enabled
// entry), the per-scan "who saw what during this scan" panel (the entries that actually ran) and, later, the Privacy generator (MPC-9894).
// No DOM, no registry import, no I/O: it takes an entry and a locale and returns text, so the site, a Worker and Node tests can all call it.
//
// Locales: the nine site/bot locales in locales/master_keys.json besides English (ja zh ko vi es de fr pt ar) plus English. The fixed vocabulary (data
// item names, party, basis, when it runs, status chips, column headings) is translated here. An entry's own free-text sentences (purpose, retention
// text) stay as written in the registry unless the entry carries a `disclosure[locale]` override, which replaces the whole sentence: a per-entry
// translation is a registry edit, never a code edit. Until the copy task translates them the free-text parts fall back to English, which the
// functions report through `usedFallback` so a page can say so instead of pretending.
import type { DataItem, Party, Phase, Recipient, ConsentBasis } from "./registry.ts";

export const LOCALES = ["en", "ja", "zh", "ko", "vi", "es", "de", "fr", "pt", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: readonly Locale[] = ["ar"];
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English", ja: "日本語", zh: "中文", ko: "한국어", vi: "Tiếng Việt", es: "Español", de: "Deutsch", fr: "Français", pt: "Português", ar: "العربية",
};

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
/** "zh-HK" -> "zh", "pt-BR" -> "pt"; anything we do not carry -> "en". */
export function toLocale(tag: string | null | undefined): Locale {
  const base = String(tag ?? "").toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : "en";
}

/** What a scan_recipient_log / browser record can say. Mirrors RecipientLogStatus in outbound.ts. */
export type LogStatus = "ran" | "failed" | "skipped_disabled" | "skipped_country" | "refused";
/** The four chips the panel shows (design 1.6). `refused` is shown as failed: the call did not happen and did not succeed. */
export type StatusChip = "ran" | "skipped_country" | "skipped_disabled" | "failed";
export const statusChip = (s: LogStatus): StatusChip => (s === "refused" ? "failed" : s);

type Dict<K extends string> = Record<K, string>;
type L10n = {
  items: Dict<DataItem>;
  party: Dict<Party>;
  basis: Dict<ConsentBasis>;
  when: Dict<Phase>;
  status: Dict<StatusChip>;
  ui: Dict<"who" | "sees" | "why" | "howLong" | "basis" | "when" | "recipient" | "dataItems" | "purpose" | "retention" | "status" | "time" | "days" | "providerSide" | "sentence">;
};

const en: L10n = {
  items: {
    ip: "your IP address", user_agent: "your browser and device string", email: "your email address", email_hash: "a scrambled fingerprint of your email address",
    email_domain: "the domain of your email address", name: "your name", phone: "your phone number", username: "usernames you typed", country: "your country",
    city: "your city", device_profile: "your device and browser details", utm: "the campaign tags on the link you came from", referrer: "the page that sent you",
    scan_result: "your scan results", message_text: "the text of your message", plan_name: "your plan name", password_hash_prefix: "the first characters of a scrambled password check",
    page_load: "the fact that you opened a page",
  },
  party: { first: "Run by us", processor: "Holds data for us", third: "Independent company", platform: "Your own channel" },
  basis: { service: "needed to run the service", scan_consent: "your Scan me agreement", analytics_consent: "your analytics choice", user_action: "something you did", legitimate_interest: "our legitimate interest" },
  when: { pre_click: "when the page loads", post_click: "only after you press Scan me" },
  status: { ran: "Ran", skipped_country: "Skipped: off in your country", skipped_disabled: "Skipped: not enabled", failed: "Failed" },
  ui: { who: "Who", sees: "What they see", why: "Why", howLong: "How long", basis: "On what basis", when: "When it runs", recipient: "Recipient", dataItems: "Data received", purpose: "Why", retention: "Kept", status: "Status", time: "Time", days: "{n} days", providerSide: "Provider-side", sentence: "{name} receives {items}. Why: {purpose} Kept: {retention}." },
};

const ja: L10n = {
  items: {
    ip: "IPアドレス", user_agent: "ブラウザと端末の識別文字列", email: "メールアドレス", email_hash: "メールアドレスの暗号化した指紋", email_domain: "メールアドレスのドメイン", name: "お名前",
    phone: "電話番号", username: "入力したユーザー名", country: "国", city: "都市", device_profile: "端末とブラウザの情報", utm: "リンクのキャンペーンタグ", referrer: "遷移元のページ",
    scan_result: "スキャン結果", message_text: "メッセージの本文", plan_name: "プラン名", password_hash_prefix: "暗号化したパスワード照合の先頭部分", page_load: "ページを開いた事実",
  },
  party: { first: "当社が運営", processor: "当社のためにデータを預かる", third: "独立した企業", platform: "お客様ご自身のチャンネル" },
  basis: { service: "サービス提供に必要", scan_consent: "「スキャン」への同意", analytics_consent: "分析の選択", user_action: "お客様の操作", legitimate_interest: "正当な利益" },
  when: { pre_click: "ページの読み込み時", post_click: "「スキャン」を押した後のみ" },
  status: { ran: "実行済み", skipped_country: "スキップ: お住まいの国ではオフ", skipped_disabled: "スキップ: 無効", failed: "失敗" },
  ui: { who: "誰が", sees: "何が見えるか", why: "理由", howLong: "保存期間", basis: "根拠", when: "実行されるとき", recipient: "送信先", dataItems: "受け取るデータ", purpose: "理由", retention: "保存", status: "状態", time: "時刻", days: "{n}日", providerSide: "提供元で保管", sentence: "{name}が受け取るもの: {items}。理由: {purpose} 保存: {retention}。" },
};

const zh: L10n = {
  items: {
    ip: "您的 IP 地址", user_agent: "您的浏览器和设备标识", email: "您的电子邮件地址", email_hash: "电子邮件地址的加密指纹", email_domain: "电子邮件地址的域名", name: "您的姓名",
    phone: "您的电话号码", username: "您输入的用户名", country: "您所在的国家或地区", city: "您所在的城市", device_profile: "您的设备和浏览器信息", utm: "来源链接上的推广标记", referrer: "带您来的页面",
    scan_result: "您的扫描结果", message_text: "您的消息内容", plan_name: "您的套餐名称", password_hash_prefix: "加密密码核对的前几位", page_load: "您打开了页面这一事实",
  },
  party: { first: "由我们运营", processor: "替我们保管数据", third: "独立公司", platform: "您自己的渠道" },
  basis: { service: "提供服务所需", scan_consent: "您对“扫描”的同意", analytics_consent: "您的分析选择", user_action: "您的操作", legitimate_interest: "我们的正当利益" },
  when: { pre_click: "页面加载时", post_click: "仅在您按下“扫描”之后" },
  status: { ran: "已运行", skipped_country: "已跳过：在您所在地区未启用", skipped_disabled: "已跳过：未启用", failed: "失败" },
  ui: { who: "谁", sees: "能看到什么", why: "原因", howLong: "保存多久", basis: "依据", when: "何时运行", recipient: "接收方", dataItems: "收到的数据", purpose: "原因", retention: "保存", status: "状态", time: "时间", days: "{n} 天", providerSide: "由服务商保存", sentence: "{name}会收到：{items}。原因：{purpose} 保存：{retention}。" },
};

const ko: L10n = {
  items: {
    ip: "IP 주소", user_agent: "브라우저 및 기기 식별 문자열", email: "이메일 주소", email_hash: "이메일 주소의 암호화된 지문", email_domain: "이메일 주소의 도메인", name: "이름",
    phone: "전화번호", username: "입력한 사용자 이름", country: "국가", city: "도시", device_profile: "기기 및 브라우저 정보", utm: "링크의 캠페인 태그", referrer: "방문 경로가 된 페이지",
    scan_result: "스캔 결과", message_text: "메시지 내용", plan_name: "요금제 이름", password_hash_prefix: "암호화된 비밀번호 확인값의 앞부분", page_load: "페이지를 열었다는 사실",
  },
  party: { first: "저희가 운영", processor: "저희를 위해 데이터를 보관", third: "독립 회사", platform: "본인의 채널" },
  basis: { service: "서비스 제공에 필요", scan_consent: "'스캔' 동의", analytics_consent: "분석 선택", user_action: "본인의 행동", legitimate_interest: "정당한 이익" },
  when: { pre_click: "페이지가 열릴 때", post_click: "'스캔'을 누른 뒤에만" },
  status: { ran: "실행됨", skipped_country: "건너뜀: 사용자 국가에서는 꺼짐", skipped_disabled: "건너뜀: 사용 안 함", failed: "실패" },
  ui: { who: "누가", sees: "무엇을 보는지", why: "이유", howLong: "보관 기간", basis: "근거", when: "실행 시점", recipient: "수신자", dataItems: "받은 데이터", purpose: "이유", retention: "보관", status: "상태", time: "시간", days: "{n}일", providerSide: "제공업체에서 보관", sentence: "{name}이(가) 받는 것: {items}. 이유: {purpose} 보관: {retention}." },
};

const vi: L10n = {
  items: {
    ip: "địa chỉ IP của bạn", user_agent: "chuỗi nhận dạng trình duyệt và thiết bị", email: "địa chỉ email của bạn", email_hash: "dấu vân tay đã mã hóa của địa chỉ email", email_domain: "tên miền của địa chỉ email",
    name: "tên của bạn", phone: "số điện thoại của bạn", username: "tên người dùng bạn nhập", country: "quốc gia của bạn", city: "thành phố của bạn", device_profile: "thông tin thiết bị và trình duyệt",
    utm: "thẻ chiến dịch trên liên kết bạn bấm vào", referrer: "trang đã đưa bạn đến", scan_result: "kết quả quét của bạn", message_text: "nội dung tin nhắn của bạn", plan_name: "tên gói của bạn",
    password_hash_prefix: "vài ký tự đầu của bản kiểm tra mật khẩu đã mã hóa", page_load: "việc bạn đã mở một trang",
  },
  party: { first: "Do chúng tôi vận hành", processor: "Giữ dữ liệu cho chúng tôi", third: "Công ty độc lập", platform: "Kênh của chính bạn" },
  basis: { service: "cần để vận hành dịch vụ", scan_consent: "đồng ý khi bấm Quét", analytics_consent: "lựa chọn phân tích của bạn", user_action: "điều bạn đã làm", legitimate_interest: "lợi ích hợp pháp của chúng tôi" },
  when: { pre_click: "khi trang tải", post_click: "chỉ sau khi bạn bấm Quét" },
  status: { ran: "Đã chạy", skipped_country: "Bỏ qua: tắt ở quốc gia của bạn", skipped_disabled: "Bỏ qua: chưa bật", failed: "Thất bại" },
  ui: { who: "Ai", sees: "Họ thấy gì", why: "Vì sao", howLong: "Giữ bao lâu", basis: "Căn cứ", when: "Khi nào chạy", recipient: "Bên nhận", dataItems: "Dữ liệu nhận", purpose: "Vì sao", retention: "Lưu giữ", status: "Trạng thái", time: "Thời gian", days: "{n} ngày", providerSide: "Do nhà cung cấp giữ", sentence: "{name} nhận: {items}. Lý do: {purpose} Lưu giữ: {retention}." },
};

const es: L10n = {
  items: {
    ip: "tu dirección IP", user_agent: "la cadena que identifica tu navegador y dispositivo", email: "tu correo electrónico", email_hash: "una huella cifrada de tu correo", email_domain: "el dominio de tu correo",
    name: "tu nombre", phone: "tu número de teléfono", username: "nombres de usuario que escribiste", country: "tu país", city: "tu ciudad", device_profile: "datos de tu dispositivo y navegador",
    utm: "las etiquetas de campaña del enlace", referrer: "la página desde la que llegaste", scan_result: "los resultados de tu análisis", message_text: "el texto de tu mensaje", plan_name: "el nombre de tu plan",
    password_hash_prefix: "los primeros caracteres de una comprobación cifrada de contraseña", page_load: "el hecho de que abriste una página",
  },
  party: { first: "Lo gestionamos nosotros", processor: "Guarda datos para nosotros", third: "Empresa independiente", platform: "Tu propio canal" },
  basis: { service: "necesario para prestar el servicio", scan_consent: "tu acuerdo al pulsar Escanear", analytics_consent: "tu elección sobre analítica", user_action: "algo que hiciste", legitimate_interest: "nuestro interés legítimo" },
  when: { pre_click: "al cargar la página", post_click: "solo después de pulsar Escanear" },
  status: { ran: "Ejecutado", skipped_country: "Omitido: desactivado en tu país", skipped_disabled: "Omitido: no activado", failed: "Falló" },
  ui: { who: "Quién", sees: "Qué ve", why: "Por qué", howLong: "Cuánto tiempo", basis: "Base", when: "Cuándo se ejecuta", recipient: "Destinatario", dataItems: "Datos recibidos", purpose: "Por qué", retention: "Se conserva", status: "Estado", time: "Hora", days: "{n} días", providerSide: "En el proveedor", sentence: "{name} recibe {items}. Motivo: {purpose} Se conserva: {retention}." },
};

const de: L10n = {
  items: {
    ip: "Ihre IP-Adresse", user_agent: "die Kennung Ihres Browsers und Geräts", email: "Ihre E-Mail-Adresse", email_hash: "ein verschlüsselter Fingerabdruck Ihrer E-Mail-Adresse", email_domain: "die Domain Ihrer E-Mail-Adresse",
    name: "Ihren Namen", phone: "Ihre Telefonnummer", username: "eingegebene Benutzernamen", country: "Ihr Land", city: "Ihre Stadt", device_profile: "Angaben zu Ihrem Gerät und Browser",
    utm: "die Kampagnen-Tags des Links", referrer: "die Seite, von der Sie kamen", scan_result: "Ihre Scan-Ergebnisse", message_text: "den Text Ihrer Nachricht", plan_name: "den Namen Ihres Tarifs",
    password_hash_prefix: "die ersten Zeichen einer verschlüsselten Passwortprüfung", page_load: "dass Sie eine Seite geöffnet haben",
  },
  party: { first: "Von uns betrieben", processor: "Speichert Daten für uns", third: "Unabhängiges Unternehmen", platform: "Ihr eigener Kanal" },
  basis: { service: "für den Betrieb des Dienstes nötig", scan_consent: "Ihre Zustimmung beim Klick auf Scannen", analytics_consent: "Ihre Analyse-Auswahl", user_action: "etwas, das Sie getan haben", legitimate_interest: "unser berechtigtes Interesse" },
  when: { pre_click: "beim Laden der Seite", post_click: "erst nach dem Klick auf Scannen" },
  status: { ran: "Ausgeführt", skipped_country: "Übersprungen: in Ihrem Land aus", skipped_disabled: "Übersprungen: nicht aktiviert", failed: "Fehlgeschlagen" },
  ui: { who: "Wer", sees: "Was sie sehen", why: "Warum", howLong: "Wie lange", basis: "Grundlage", when: "Wann es läuft", recipient: "Empfänger", dataItems: "Erhaltene Daten", purpose: "Warum", retention: "Aufbewahrung", status: "Status", time: "Zeit", days: "{n} Tage", providerSide: "Beim Anbieter", sentence: "{name} erhält {items}. Grund: {purpose} Aufbewahrung: {retention}." },
};

const fr: L10n = {
  items: {
    ip: "votre adresse IP", user_agent: "la chaîne qui identifie votre navigateur et appareil", email: "votre adresse e-mail", email_hash: "une empreinte chiffrée de votre adresse e-mail", email_domain: "le domaine de votre adresse e-mail",
    name: "votre nom", phone: "votre numéro de téléphone", username: "des noms d'utilisateur saisis", country: "votre pays", city: "votre ville", device_profile: "des informations sur votre appareil et navigateur",
    utm: "les balises de campagne du lien", referrer: "la page qui vous a amené", scan_result: "vos résultats d'analyse", message_text: "le texte de votre message", plan_name: "le nom de votre formule",
    password_hash_prefix: "les premiers caractères d'une vérification chiffrée de mot de passe", page_load: "le fait que vous avez ouvert une page",
  },
  party: { first: "Géré par nous", processor: "Conserve des données pour nous", third: "Entreprise indépendante", platform: "Votre propre canal" },
  basis: { service: "nécessaire au service", scan_consent: "votre accord en appuyant sur Analyser", analytics_consent: "votre choix sur les statistiques", user_action: "une action de votre part", legitimate_interest: "notre intérêt légitime" },
  when: { pre_click: "au chargement de la page", post_click: "seulement après avoir appuyé sur Analyser" },
  status: { ran: "Exécuté", skipped_country: "Ignoré : désactivé dans votre pays", skipped_disabled: "Ignoré : non activé", failed: "Échec" },
  ui: { who: "Qui", sees: "Ce qu'il voit", why: "Pourquoi", howLong: "Combien de temps", basis: "Base", when: "Quand cela s'exécute", recipient: "Destinataire", dataItems: "Données reçues", purpose: "Pourquoi", retention: "Conservé", status: "Statut", time: "Heure", days: "{n} jours", providerSide: "Chez le prestataire", sentence: "{name} reçoit {items}. Motif : {purpose} Conservé : {retention}." },
};

const pt: L10n = {
  items: {
    ip: "o seu endereço IP", user_agent: "a identificação do seu navegador e dispositivo", email: "o seu e-mail", email_hash: "uma impressão cifrada do seu e-mail", email_domain: "o domínio do seu e-mail",
    name: "o seu nome", phone: "o seu número de telefone", username: "nomes de utilizador que escreveu", country: "o seu país", city: "a sua cidade", device_profile: "dados do seu dispositivo e navegador",
    utm: "as etiquetas de campanha do link", referrer: "a página que o trouxe", scan_result: "os resultados da sua análise", message_text: "o texto da sua mensagem", plan_name: "o nome do seu plano",
    password_hash_prefix: "os primeiros caracteres de uma verificação cifrada de palavra-passe", page_load: "o facto de ter aberto uma página",
  },
  party: { first: "Gerido por nós", processor: "Guarda dados para nós", third: "Empresa independente", platform: "O seu próprio canal" },
  basis: { service: "necessário para prestar o serviço", scan_consent: "o seu acordo ao carregar em Analisar", analytics_consent: "a sua escolha sobre estatísticas", user_action: "algo que fez", legitimate_interest: "o nosso interesse legítimo" },
  when: { pre_click: "quando a página carrega", post_click: "só depois de carregar em Analisar" },
  status: { ran: "Executado", skipped_country: "Ignorado: desligado no seu país", skipped_disabled: "Ignorado: não ativado", failed: "Falhou" },
  ui: { who: "Quem", sees: "O que vê", why: "Porquê", howLong: "Quanto tempo", basis: "Base", when: "Quando corre", recipient: "Destinatário", dataItems: "Dados recebidos", purpose: "Porquê", retention: "Guardado", status: "Estado", time: "Hora", days: "{n} dias", providerSide: "No fornecedor", sentence: "{name} recebe {items}. Motivo: {purpose} Guardado: {retention}." },
};

const ar: L10n = {
  items: {
    ip: "عنوان IP الخاص بك", user_agent: "معرّف المتصفح والجهاز", email: "بريدك الإلكتروني", email_hash: "بصمة مشفّرة لبريدك الإلكتروني", email_domain: "نطاق بريدك الإلكتروني", name: "اسمك",
    phone: "رقم هاتفك", username: "أسماء المستخدمين التي كتبتها", country: "بلدك", city: "مدينتك", device_profile: "تفاصيل جهازك ومتصفحك", utm: "وسوم الحملة في الرابط", referrer: "الصفحة التي أحالتك",
    scan_result: "نتائج الفحص", message_text: "نص رسالتك", plan_name: "اسم باقتك", password_hash_prefix: "الأحرف الأولى من فحص مشفّر لكلمة المرور", page_load: "أنك فتحت صفحة",
  },
  party: { first: "نديره نحن", processor: "يحفظ البيانات لأجلنا", third: "شركة مستقلة", platform: "قناتك الخاصة" },
  basis: { service: "لازم لتشغيل الخدمة", scan_consent: "موافقتك عند الضغط على فحص", analytics_consent: "اختيارك بشأن التحليلات", user_action: "شيء قمت به", legitimate_interest: "مصلحتنا المشروعة" },
  when: { pre_click: "عند تحميل الصفحة", post_click: "فقط بعد الضغط على فحص" },
  status: { ran: "تم التنفيذ", skipped_country: "تم التخطي: متوقف في بلدك", skipped_disabled: "تم التخطي: غير مفعّل", failed: "فشل" },
  ui: { who: "من", sees: "ماذا يرى", why: "لماذا", howLong: "إلى متى", basis: "الأساس", when: "متى يعمل", recipient: "الجهة", dataItems: "البيانات المستلمة", purpose: "لماذا", retention: "الاحتفاظ", status: "الحالة", time: "الوقت", days: "{n} أيام", providerSide: "لدى المزوّد", sentence: "{name} يستلم: {items}. السبب: {purpose} الاحتفاظ: {retention}." },
};

const L10N: Record<Locale, L10n> = { en, ja, zh, ko, vi, es, de, fr, pt, ar };

export type UiKey = keyof L10n["ui"];
export const t = (locale: Locale, key: UiKey): string => L10N[locale].ui[key];
export const itemLabel = (item: DataItem, locale: Locale): string => L10N[locale].items[item] ?? item;
export const partyLabel = (p: Party, locale: Locale): string => L10N[locale].party[p];
export const basisLabel = (b: ConsentBasis, locale: Locale): string => L10N[locale].basis[b];
export const whenLabel = (p: Phase, locale: Locale): string => L10N[locale].when[p];
export const statusLabel = (s: LogStatus | StatusChip, locale: Locale): string => L10N[locale].status[statusChip(s as LogStatus)];

/** "a, b and c" without a locale-specific conjunction table: a plain separator list reads correctly in all ten. */
const SEP: Record<Locale, string> = { en: ", ", ja: "、", zh: "、", ko: ", ", vi: ", ", es: ", ", de: ", ", fr: ", ", pt: ", ", ar: "، " };
export const joinItems = (items: readonly DataItem[], locale: Locale): string => items.map((i) => itemLabel(i, locale)).join(SEP[locale]);

const fill = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

export interface DisclosureParts {
  who: string;
  party: string;
  sees: string;
  why: string;
  howLong: string;
  basis: string;
  when: string;
  /** True when `why` or `howLong` is English because the entry has no text for this locale. */
  usedFallback: boolean;
}

/** The data items an entry can receive in `country` once its country override is applied (design 1.3 check 6). */
export function itemsFor(entry: Recipient, country?: string | null): DataItem[] {
  const ex = country ? entry.country_overrides?.[country.toUpperCase()]?.data_items_exclude ?? [] : [];
  return entry.data_items.filter((d) => !ex.includes(d));
}

/** Each column of /what-we-see and each field of a panel row, in `locale`. `items` narrows to what actually ran (the panel passes the logged names). */
export function describeEntry(entry: Recipient, locale: Locale, items: readonly DataItem[] = entry.data_items): DisclosureParts {
  const o = entry.disclosure?.[locale];
  const retention = locale !== "en" && entry.retention.days !== null ? fill(L10N[locale].ui.days, { n: String(entry.retention.days) }) : entry.retention.text;
  const usedFallback = locale !== "en" && !o;   // the purpose sentence is the registry's English one
  return {
    who: entry.name,
    party: partyLabel(entry.party, locale),
    sees: items.length ? joinItems(items, locale) : "—",
    why: o ?? entry.purpose,
    howLong: retention,
    basis: basisLabel(entry.consent_basis, locale),
    when: whenLabel(entry.phase, locale),
    usedFallback,
  };
}

/**
 * The one-sentence disclosure for an entry. An entry's own `disclosure[locale]` sentence wins outright; otherwise the sentence is built from the
 * entry's fields with the locale's template and vocabulary.
 */
export function renderDisclosure(entry: Recipient, locale: Locale, items: readonly DataItem[] = entry.data_items): string {
  const override = entry.disclosure?.[locale];
  if (override) return override;
  const p = describeEntry(entry, locale, items);
  return fill(L10N[locale].ui.sentence, { name: p.who, items: p.sees, purpose: p.why.replace(/\s+$/, ""), retention: p.howLong });
}

/** True once an entry's `until` date has been reached: it no longer appears among the live recipients and is listed as removed instead. */
export const isRemoved = (entry: Recipient, today: string): boolean => entry.until !== null && entry.until <= today;
/** Live now: switched on, not removed. */
export const isLive = (entry: Recipient, today: string): boolean => entry.enabled && !isRemoved(entry, today);

export const PARTY_ORDER: readonly Party[] = ["first", "processor", "platform", "third"];

/** The most recent date the registry mentions (any `since` or `until`). Deterministic, so a page built from the same file shows the same date. */
export function registryDate(entries: readonly Recipient[]): string {
  let d = "";
  for (const e of entries) for (const v of [e.since, e.until]) if (v && v > d) d = v;
  return d;
}
