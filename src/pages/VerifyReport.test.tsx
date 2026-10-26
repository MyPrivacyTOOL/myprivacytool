import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import VerifyReport from './VerifyReport';

const verifyUploaded = vi.fn();
vi.mock('@/lib/verifyReport', () => ({ verifyUploaded: (...a: unknown[]) => verifyUploaded(...a) }));
vi.mock('@/components/Seo', () => ({ default: () => null }));

afterEach(() => { cleanup(); verifyUploaded.mockReset(); });

const choose = () => fireEvent.change(screen.getByTestId('report-files'), { target: { files: [new File(['{}'], 'r.signed.json')] } });

describe('VerifyReport page', () => {
  it('cannot check until a file is chosen', () => {
    render(<VerifyReport />);
    expect(screen.getByTestId('check-report')).toBeDisabled();
  });
  it('shows a verified result in plain words', async () => {
    verifyUploaded.mockResolvedValue({ kind: 'verified', signedAt: '2026-10-26T00:00:00.000Z', timestamped: true });
    render(<VerifyReport />);
    choose();
    fireEvent.click(screen.getByTestId('check-report'));
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveTextContent(/Verified\. This file was signed by MyPrivacyTOOL on 2026-10-26, and has not been changed since\./));
    expect(screen.getByTestId('verdict')).toHaveTextContent(/does not, on its own, prove the scan results/);
    expect(screen.getByTestId('verdict')).not.toHaveTextContent(/time stamp/i);
  });
  it('lists why a file is not verified', async () => {
    verifyUploaded.mockResolvedValue({ kind: 'not_verified', reasons: ['The signature does not match the file.'] });
    render(<VerifyReport />);
    choose();
    fireEvent.click(screen.getByTestId('check-report'));
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveTextContent(/Not verified\..*does not match/));
  });
});
