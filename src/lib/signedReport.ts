// Client for the signed report endpoints (MPC-8281). The server signs; nothing here ever holds a key.
// Server: functions/api/report-download.ts and functions/api/verify-report.ts. Shapes: shared/signed-report/.

export type SignedReportErrorCode = 'level2_required' | 'unavailable' | 'too_large' | 'failed';

export class SignedReportError extends Error {
  code: SignedReportErrorCode;
  constructor(code: SignedReportErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Plain-language text for the user. Never shows a server message, status code or stack. */
export function signedReportMessage(code: SignedReportErrorCode): string {
  switch (code) {
    case 'level2_required': return 'Finish the confirmation step first, then you can download a signed report.';
    case 'unavailable': return 'Signed reports are not available right now. Your normal report downloads still work.';
    case 'too_large': return 'This report is too large to sign.';
    default: return 'We could not sign your report. Your normal report downloads still work.';
  }
}

async function post(path: string, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new SignedReportError('unavailable');
  }
  if (res.ok) {
    try {
      return await res.json();
    } catch {
      throw new SignedReportError('failed');
    }
  }
  if (res.status === 403) throw new SignedReportError('level2_required');
  if (res.status === 503) throw new SignedReportError('unavailable');
  if (res.status === 413) throw new SignedReportError('too_large');
  throw new SignedReportError('failed');
}

export interface SignedJsonFile { report: unknown; signature: { value: string; public_key: string; signed_at: string; issuer: string } }
export interface PdfSignature { sha256: string; value: string; public_key: string; signed_at: string; issuer: string }

export async function requestSignedJson(report: unknown, fetchImpl: typeof fetch = fetch): Promise<SignedJsonFile> {
  const out = (await post('/api/report-download', { report }, fetchImpl)) as SignedJsonFile;
  if (!out || !out.signature || typeof out.signature.value !== 'string') throw new SignedReportError('failed');
  return out;
}

/** Base64 of bytes without spreading a large array into one call (a PDF can be hundreds of KB). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export async function requestPdfSignature(pdf: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<PdfSignature> {
  const out = (await post('/api/report-download', { pdf_base64: bytesToBase64(pdf) }, fetchImpl)) as { signature?: PdfSignature };
  if (!out?.signature || typeof out.signature.value !== 'string') throw new SignedReportError('failed');
  return out.signature;
}

export function downloadBlob(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
