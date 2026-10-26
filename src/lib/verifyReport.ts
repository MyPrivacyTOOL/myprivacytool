// Check an uploaded signed report against /api/verify-report (MPC-8281). Takes the files a person chose, works out which kind of check it is
// (a signed .json, or a .pdf plus its .pdf.sig.json) and turns the server's answer into plain words. Nothing is stored or kept.

import { bytesToBase64 } from '@/lib/signedReport';

export type Verdict =
  | { kind: 'verified'; signedAt: string | null; timestamped: boolean }
  | { kind: 'not_verified'; reasons: string[] }
  | { kind: 'need_more'; message: string }
  | { kind: 'error'; message: string };

// The server accepts about 1 MB of JSON, and base64 makes a PDF a third bigger.
const MAX_PDF_BYTES = 700_000;
const MAX_JSON_BYTES = 900_000;

interface ServerAnswer {
  verified?: boolean;
  signature_valid?: boolean;
  issuer_key_trusted?: boolean;
  file_matches?: boolean;
  signed_at?: string | null;
  timestamped?: boolean;
}

export function reasonsFrom(a: ServerAnswer): string[] {
  const reasons: string[] = [];
  if (a.signature_valid === false) reasons.push('The signature does not match the file. It may have been changed after it was signed.');
  if (a.file_matches === false) reasons.push('This PDF is not the one the signature was made for.');
  if (a.signature_valid && a.issuer_key_trusted === false) reasons.push('The signature is intact, but it was not made with a key MyPrivacyTOOL has published.');
  return reasons.length ? reasons : ['We could not confirm this file.'];
}

async function readText(f: File): Promise<string> {
  return await f.text();
}

export async function verifyUploaded(files: File[], fetchImpl: typeof fetch = fetch): Promise<Verdict> {
  const pdf = files.find((f) => f.name.toLowerCase().endsWith('.pdf'));
  const jsons = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
  if (files.length === 0) return { kind: 'need_more', message: 'Choose the signed report file you downloaded.' };
  if (jsons.length === 0) return { kind: 'need_more', message: 'Also choose the signature file that came with the PDF. Its name ends in .pdf.sig.json.' };
  if (jsons.some((f) => f.size > MAX_JSON_BYTES) || (pdf && pdf.size > MAX_PDF_BYTES)) return { kind: 'error', message: 'That file is too large to check here.' };

  let body: unknown;
  try {
    const parsed = await Promise.all(jsons.map(async (f) => JSON.parse(await readText(f)) as Record<string, unknown>));
    const signedJson = parsed.find((p) => p && typeof p === 'object' && 'report' in p && 'signature' in p);
    const sigFile = parsed.find((p) => p && typeof p === 'object' && (p.signature as { sha256?: unknown } | undefined)?.sha256 !== undefined);
    if (signedJson && !pdf) body = signedJson;
    else if (sigFile && pdf) body = { pdf_base64: bytesToBase64(new Uint8Array(await pdf.arrayBuffer())), signature: sigFile.signature };
    else if (sigFile && !pdf) return { kind: 'need_more', message: 'Also choose the PDF this signature belongs to.' };
    else if (signedJson) body = signedJson;
    else return { kind: 'error', message: 'That does not look like a MyPrivacyTOOL signed report.' };
  } catch {
    return { kind: 'error', message: 'We could not read that file.' };
  }

  let res: Response;
  try {
    res = await fetchImpl('/api/verify-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { kind: 'error', message: 'We could not reach the checker. Try again in a moment.' };
  }
  let answer: ServerAnswer;
  try {
    answer = (await res.json()) as ServerAnswer;
  } catch {
    return { kind: 'error', message: 'The checker gave an answer we could not read.' };
  }
  if (res.status >= 500 || res.status === 413) return { kind: 'error', message: 'The checker is not available right now. Try again in a moment.' };
  if (answer.verified === true) return { kind: 'verified', signedAt: answer.signed_at ?? null, timestamped: answer.timestamped === true };
  return { kind: 'not_verified', reasons: reasonsFrom(answer) };
}
