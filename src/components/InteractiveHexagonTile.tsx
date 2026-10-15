import { useState } from 'react';
import type { Hexagon } from '@/types/hexagon';
import { getHexagonVisuals } from '@/utils/hexagonStyles';
import { canConfirm, canDispute } from '@/lib/identityConfirmation';
import { cn } from '@/lib/utils';
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

const EXPOSED_VISUALS = {
  className: 'bg-red-100 border-red-500 text-red-800',
  icon: '!',
  tooltip: 'Exposure confirmed. Open to see the next step.',
};

interface Props {
  hexagon: Hexagon;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
  /** When set, a tap on a guess calls this instead of opening the built-in prompt (the dashboard shows its own modal). */
  onSelect?: (hexagon: Hexagon) => void;
  /** The user finished the remediation step: a confirmed exposure shows green instead of red. */
  fixed?: boolean;
  className?: string;
}

export const InteractiveHexagonTile = ({ hexagon, onConfirm, onDispute, onSelect, fixed = false, className }: Props) => {
  const [asking, setAsking] = useState(false);
  const exposed = hexagon.status === 'confirmed' && hexagon.exposure === true && !fixed;
  const visuals = exposed ? EXPOSED_VISUALS : getHexagonVisuals(hexagon.status);
  const requiresConfirmation = canConfirm(hexagon);
  const allowsDispute = canDispute(hexagon);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className={cn(
          'w-28 h-28 flex flex-col items-center justify-center border-2 rounded-lg transition-all',
          requiresConfirmation || (exposed && onSelect) ? 'cursor-pointer' : 'cursor-default',
          visuals.className,
          className,
        )}
        onClick={() => {
          // A confirmed, unfixed exposure reopens its action plan; a guess opens the question.
          if (onSelect && (requiresConfirmation || exposed)) onSelect(hexagon);
          else if (requiresConfirmation) setAsking(true);
        }}
        aria-disabled={!requiresConfirmation}
        title={visuals.tooltip}
      >
        <span className="text-2xl font-bold" aria-hidden="true">{visuals.icon}</span>
        <span className="text-xs mt-1 text-center px-1 truncate w-full">{hexagon.label}</span>
        <span className="sr-only">{visuals.tooltip}</span>
      </button>

      {allowsDispute && (
        <button
          type="button"
          onClick={() => onDispute(hexagon.id)}
          className="absolute top-1 right-1 text-xs bg-white text-orange-600 rounded-full w-5 h-5 flex items-center justify-center border border-orange-600 before:absolute before:-inset-3 before:content-['']"
          title="Not me?"
          aria-label={`Not me: dispute ${hexagon.label}`}
        >
          !
        </button>
      )}

      {/* Only the two buttons answer. Closing the dialog (Esc, outside click) records nothing. */}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Is this you?</AlertDialogTitle>
            <AlertDialogDescription>
              We found <span className="font-medium">{hexagon.data ?? 'this item'}</span> linked to you. {hexagon.label}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onConfirm(hexagon.id, false)}>No, not me</AlertDialogCancel>
            <AlertDialogAction onClick={() => onConfirm(hexagon.id, true)}>Yes, it's me</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
