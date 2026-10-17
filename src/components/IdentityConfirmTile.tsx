import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { IdentityFinding, canDispute, needsConfirmation } from '@/lib/findingConfirmation';
import { getFindingVisuals } from '@/lib/identityConfirmationStyles';
import { cn } from '@/lib/utils';

interface Props {
  finding: IdentityFinding;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
}

// A short tick on touch devices that support it; ignored elsewhere.
const haptic = () => {
  try { navigator.vibrate?.(15); } catch { /* not supported */ }
};

export function IdentityConfirmTile({ finding, onConfirm, onDispute }: Props) {
  // Which prompt is open. Only the buttons inside a prompt record an answer; closing it records nothing.
  const [prompt, setPrompt] = useState<'confirm' | 'dispute' | null>(null);
  const visuals = getFindingVisuals(finding.status);
  const asksQuestion = needsConfirmation(finding);
  const allowsDispute = canDispute(finding);
  const interactive = asksQuestion || allowsDispute;

  const answer = (isMatch: boolean) => {
    haptic();
    setPrompt(null);
    onConfirm(finding.id, isMatch);
  };

  return (
    <div className="relative inline-block" data-testid={`identity-tile-${finding.id}`}>
      <button
        type="button"
        className={cn(
          'w-28 h-28 flex flex-col items-center justify-center border-2 rounded-lg transition-all',
          interactive ? 'cursor-pointer' : 'cursor-default',
          visuals.className,
        )}
        title={visuals.tooltip}
        aria-label={`${finding.label}: ${visuals.tooltip}`}
        aria-haspopup={interactive ? 'dialog' : undefined}
        onClick={() => setPrompt(asksQuestion ? 'confirm' : allowsDispute ? 'dispute' : null)}
      >
        <span className="text-2xl font-bold">{visuals.icon}</span>
        <span className="text-xs mt-1 text-center px-1 truncate w-full">{finding.label}</span>
      </button>

      {/* `!` is reserved for risk. Disputing is a labelled button inside its own prompt, so it is deliberate, never a stray tap. */}
      <AlertDialog open={prompt === 'confirm'} onOpenChange={(open) => !open && setPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Is this you?</AlertDialogTitle>
            <AlertDialogDescription>
              We found this linked to you: <strong>{finding.data ?? finding.label}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => answer(false)}>No, not me</AlertDialogCancel>
            <AlertDialogAction onClick={() => answer(true)}>Yes, this is me</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={prompt === 'dispute'} onOpenChange={(open) => !open && setPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Does this look wrong?</AlertDialogTitle>
            <AlertDialogDescription>
              We checked and found <strong>{finding.data ?? finding.label}</strong> linked to you. If that is not right, tell us and we will leave it
              out of your score.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { haptic(); setPrompt(null); onDispute(finding.id); }}>This isn't right</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
