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
import { IdentityFinding, canDispute, needsConfirmation } from '@/lib/identityConfirmation';
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
  const [asking, setAsking] = useState(false);
  const visuals = getFindingVisuals(finding.status);
  const asksQuestion = needsConfirmation(finding);

  const answer = (isMatch: boolean) => {
    haptic();
    setAsking(false);
    onConfirm(finding.id, isMatch);
  };

  return (
    <div className="relative inline-block" data-testid={`identity-tile-${finding.id}`}>
      <button
        type="button"
        className={cn(
          'w-28 h-28 flex flex-col items-center justify-center border-2 rounded-lg transition-all',
          asksQuestion ? 'cursor-pointer' : 'cursor-default',
          visuals.className,
        )}
        title={visuals.tooltip}
        aria-label={`${finding.label}: ${visuals.tooltip}`}
        onClick={() => asksQuestion && setAsking(true)}
      >
        <span className="text-2xl font-bold">{visuals.icon}</span>
        <span className="text-xs mt-1 text-center px-1 truncate w-full">{finding.label}</span>
      </button>

      {canDispute(finding) && (
        <button
          type="button"
          onClick={() => { haptic(); onDispute(finding.id); }}
          className="absolute top-1 right-1 text-xs bg-white text-orange-600 rounded-full w-5 h-5 flex items-center justify-center border border-orange-600"
          title="Not me?"
          aria-label={`Dispute: ${finding.label} is not mine`}
        >
          !
        </button>
      )}

      <AlertDialog open={asking} onOpenChange={setAsking}>
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
    </div>
  );
}
