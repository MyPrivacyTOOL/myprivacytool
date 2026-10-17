import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GuessCheckCard from './GuessCheckCard';
import { guessCheckFor } from '@/lib/guessCheck';

afterEach(() => vi.unstubAllGlobals());
const spec = guessCheckFor('location')!;
const london = { lat: 51.5074, lon: -0.1278 };
const geo = (lat: number, lon: number) => ({ getCurrentPosition: (s: PositionCallback) => s({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition) });
const props = { label: 'Location', value: 'London, England', spec, guess: london, answered: null as null, onAnswer: vi.fn(), onDevice: vi.fn() };

describe('GuessCheckCard', () => {
  it('asks the question, with one tap to answer and no percentage', () => {
    render(<GuessCheckCard {...props} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Are you in London, England?');
    fireEvent.click(screen.getByTestId('guess-yes'));
    expect(props.onAnswer).toHaveBeenCalledWith('yes');
    fireEvent.click(screen.getByTestId('guess-no'));
    expect(props.onAnswer).toHaveBeenCalledWith('no');
    expect(screen.getByTestId('guess-check').textContent).not.toMatch(/%/);
  });

  it('says plainly that the device position stays in the browser, and that its permission prompt comes first', () => {
    render(<GuessCheckCard {...props} />);
    expect(screen.getByTestId('guess-privacy')).toHaveTextContent(/asks you first/);
    expect(screen.getByTestId('guess-privacy')).toHaveTextContent(/Nothing is sent or stored/);
  });

  it('the device check compares and reports, and sends nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const onDevice = vi.fn();
    render(<GuessCheckCard {...props} onDevice={onDevice} geolocation={geo(51.55, -0.2)} />);
    fireEvent.click(screen.getByTestId('guess-device'));
    await waitFor(() => expect(screen.getByTestId('guess-device-result')).toHaveTextContent(/Your device agrees/));
    expect(onDevice).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'agrees' }));
    expect(f).not.toHaveBeenCalled();
  });

  it('a far device says our guess was wrong', async () => {
    const onDevice = vi.fn();
    render(<GuessCheckCard {...props} onDevice={onDevice} geolocation={geo(48.8566, 2.3522)} />);
    fireEvent.click(screen.getByTestId('guess-device'));
    await waitFor(() => expect(screen.getByTestId('guess-device-result')).toHaveTextContent(/our guess was wrong/));
    expect(onDevice).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'far' }));
  });

  it('a refusal is not a no: it says so and changes nothing', async () => {
    const onAnswer = vi.fn();
    const denied = { getCurrentPosition: (_s: PositionCallback, e?: PositionErrorCallback | null) => e?.({ code: 1 } as GeolocationPositionError) };
    render(<GuessCheckCard {...props} onAnswer={onAnswer} geolocation={denied} />);
    fireEvent.click(screen.getByTestId('guess-device'));
    await waitFor(() => expect(screen.getByTestId('guess-device-error')).toHaveTextContent(/didn't allow it/));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('once answered it shows the answer and whose word it is', () => {
    render(<GuessCheckCard {...props} answered="yes" />);
    expect(screen.getByTestId('guess-answer')).toHaveTextContent('your word, not our proof');
    expect(screen.queryByTestId('guess-yes')).toBeNull();
  });
});
