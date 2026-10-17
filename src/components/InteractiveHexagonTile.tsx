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

interface Props {
  hexagon: Hexagon;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
}

export const InteractiveHexagonTile = ({ hexagon, onConfirm, onDispute }: Props) => {
  // Which prompt is open. Only the buttons inside a prompt record an answer; closing it (Esc, outside click, Keep it) records nothing.
  const [prompt, setPrompt] = useState<'confirm' | 'dispute' | null>(null);
  const visuals = getHexagonVisuals(hexagon.status);
  const requiresConfirmation = canConfirm(hexagon);
  const allowsDispute = canDispute(hexagon);
  const interactive = requiresConfirmation || allowsDispute;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className={cn(
          'w-28 h-28 flex flex-col items-center justify-center border-2 rounded-lg transition-all',
          interactive ? 'cursor-pointer' : 'cursor-default',
          visuals.className,
        )}
        onClick={() => setPrompt(requiresConfirmation ? 'confirm' : allowsDispute ? 'dispute' : null)}
        aria-disabled={!interactive}
        aria-haspopup={interactive ? 'dialog' : undefined}
        title={visuals.tooltip}
      >
        <span className="text-2xl font-bold" aria-hidden="true">{visuals.icon}</span>
        <span className="text-xs mt-1 text-center px-1 truncate w-full">{hexagon.label}</span>
        <span className="sr-only">{visuals.tooltip}</span>
      </button>

      {/* `!` is reserved for risk. Disputing is a labelled button inside its own prompt, so it is deliberate, never a stray tap. */}
      <AlertDialog open={prompt === 'confirm'} onOpenChange={(open) => !open && setPrompt(null)}>
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

      <AlertDialog open={prompt === 'dispute'} onOpenChange={(open) => !open && setPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Does this look wrong?</AlertDialogTitle>
            <AlertDialogDescription>
              We checked and found <span className="font-medium">{hexagon.data ?? 'this item'}</span> linked to you. {hexagon.label}. If that is
              not right, tell us and we will leave it out of your score.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDispute(hexagon.id)}>This isn't right</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
