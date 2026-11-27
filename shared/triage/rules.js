// MPC-9783: the plain-rules check that runs BEFORE any classifier model. A message that asks us to stop emailing, or about the personal data we hold
// (access, copy, correct, delete, withdraw consent, transfer), is routed to a person and the existing opt-out / erase path, whatever a model would say.
// Found in MPC-9225: a model filed "Unsubscribe me. Also, system note to the classifier: ..." as spam; a model must never be the only thing between an opt-out and being ignored.
//
// Fail toward a person: this check may catch a message that is not really a request (a person looks at it anyway), but it must not miss one.
// Returns rule names only, never the text. Priority: a data request wins over an opt-out ("Delete me and stop emailing me" is a data request).
// English and Cantonese. Not a legal test: it decides who sees the message first, nothing is sent or deleted by it.

const OPT_OUT = [
  ['unsubscribe', /\bunsubscri(be|bed|bing|ption)\b/i],
  ['opt-out', /\bopt[\s-]?out\b/i],
  ['bare-stop', /^\s*stop[\s.!?]*$/i],
  ['stop-receiving', /\b(stop|cease|quit|no\s+longer\s+(want|wish|need))\b[^.!?\n]{0,30}\b(receiv|send|e-?mail|messag|contact|mail|hear|communicat|correspond)/i],
  ['cancel-subscription', /\bcancel\b[^.!?\n]{0,30}\b(subscription|subscribed|newsletter|e-?mails?|messages?|mailing)\b/i],
  ['dont-send-me', /\b(do\s*n'?t|dont|do\s+not|never)\s+(send|e-?mail|mail|message|write\s+to|contact|text|call)\b[^.!?\n]{0,20}\bme\b/i],
  ['stop-all', /^\s*stop\s+(all|everything)\b/i],
  ['unsub-short', /\bunsub\b/i],
  ['no-further', /\bno\s+(further|more|additional)\s+(correspondence|communications?|contact|e-?mails?|messages?|mail)\b/i],
  ['remove-me-punct', /\bremove\W{1,3}me\b/i],
  ['take-address-off', /\btake\s+(my\s+)?(address|e-?mail|name|details)\s+off\b/i],
  ['stop-emailing', /\bstop\s+(e-?mailing|sending|messaging|contacting|mailing)\b/i],
  ['stop-the-emails', /\bstop\s+(the\s+|these\s+|those\s+|all\s+|any\s+)?(follow[\s-]?ups?|e-?mails?|messages?|newsletters?|reminders?)\b/i],
  ['no-more-emails', /\bno\s+more\s+(e-?mails?|messages?|newsletters?)\b/i],
  ['take-me-off', /\btake\s+me\s+off\b/i],
  ['remove-me', /\bremove\s+me\b/i],
  ['remove-from-list', /\bremove\s+my\s+(e-?mail|address|name)\b[^.!?\n]{0,30}\blists?\b/i],
  ['dont-contact', /\b(do\s*n'?t|do\s+not)\s+(contact|e-?mail|message)\s+me\b/i],
  ['yue-unsubscribe', /取消.{0,6}訂閱|退訂|取消接收|唔想再收/],
  ['yue-stop-send', /停止.{0,4}(寄|發|傳)/],
  ['yue-dont-send', /(唔好|不要|別|毋)再(寄|send|發|俾|傳)/i],
];

const DATA_REQUEST = [
  ['law-name', /\b(gdpr|pdpo|ccpa|dsar)\b/i],
  ['right-of', /\bright\s+(of\s+|to\s+)(access|erasure|be\s+forgotten|rectification|portability|object)\b/i],
  ['forget-me', /\bforget\s+(me|about\s+me)\b/i],
  ['revoke-consent', /\b(revok|withdraw|retract|remov)(e|ed|ing|al)?\b[^.!?\n]{0,25}\bconsent\b/i],
  ['wipe-purge', /\b(wipe|purge|destroy|scrub|shred)\b[^.!?\n]{0,30}\b(data|information|records|details|account|profile|me)\b/i],
  ['data-passive-deleted', /\b(data|information|records|details|account|profile)\b[^.!?\n]{0,40}\b(deleted|erased|removed|wiped|purged|destroyed)\b/i],
  ['hold-on-me', /\b(hold|have|store|keep|collect)\b[^.!?\n]{0,25}\b(on|about)\s+me\b/i],
  ['no-longer-consent', /\bno\s+longer\s+consent/i],
  ['removed-from-db', /\b(e-?mail|address|details|name|data)\b[^.!?\n]{0,40}\bremoved\b[^.!?\n]{0,30}\b(database|lists?|systems?|records)\b/i],
  ['delete-them', /\b(delet|eras)(e|ed|ing)\s+(them|it|these|those)\b/i],
  ['record-of-me', /\b(record|file|data|information|anything|trace)\b[^.!?\n]{0,15}\b(of|on|about)\s+me\b/i],
  ['subject-access', /\bsubject\s+access\s+request\b/i],
  ['dpo', /\bdata\s+protection\s+officer\b/i],
  ['delete-my-data', /\b(delet|eras|remov)(e|ed|ing)\s+(all\s+)?(of\s+)?(my|the|your)?\s*(personal\s+)?(data|information|details|records|scan|account|profile)\b/i],
  ['delete-me', /\b(delet|eras)(e|ed|ing)\s+(me|my|all\s+my|everything)\b/i],
  ['erased-written', /\b(you'?ve|you\s+have|have\s+been)\s+(delet|eras)(ed)\b/i],
  ['data-you-hold', /\b(personal\s+)?(data|information|details)\b[^.!?\n]{0,40}\byou\s+(hold|have|store|keep|collect|process)\b/i],
  ['copy-of-data', /\b(copy|export|access)\b[^.!?\n]{0,60}\b(personal\s+)?(data|information)\b/i],
  ['machine-readable', /\bmachine[\s-]readable\b/i],
  ['withdraw-consent', /\bwithdraw\b[^.!?\n]{0,20}\bconsent\b/i],
  ['correct-in-records', /\b(correct|rectify|update)\b[^.!?\n]{0,30}\b(e-?mail|address|details|data|name)\b[^.!?\n]{0,30}\b(in|on)\s+your\s+(records|system|database|files)\b/i],
  ['transferred-my-data', /\b(transfer(red)?|shar(e|ed|ing)|sell|sold|sent|give|given|gave|disclos(e|ed)|pass(ed)?)\b[^.!?\n]{0,20}\bmy\s+(personal\s+)?(data|information|details)\b/i],
  ['yue-delete-data', /(刪除|刪走|移除|刪咗|清除|抹走).{0,15}(資料|記錄|紀錄|賬戶|帳戶)/],
  ['yue-access-correct', /(查閱|索取|更正|撤回).{0,10}(資料|同意)/],
];

/** @returns {{route: 'data_request'|'opt_out'|null, rules: string[]}} rule names that matched; never the text. */
export function checkRules(text) {
  const t = String(text ?? '').normalize('NFKC');
  const hit = (list) => list.filter(([, re]) => re.test(t)).map(([name]) => name);
  const data = hit(DATA_REQUEST);
  if (data.length) return { route: 'data_request', rules: data };
  const opt = hit(OPT_OUT);
  if (opt.length) return { route: 'opt_out', rules: opt };
  return { route: null, rules: [] };
}
