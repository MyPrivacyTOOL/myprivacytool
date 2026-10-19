import { useState, type CSSProperties } from 'react';
import type { Hexagon } from '@/types/hexagon';
import { getHexagonVisuals, getHexPaint } from '@/utils/hexagonStyles';
import { canConfirm, canDispute } from '@/lib/identityConfirmation';
import { cn } from '@/lib/utils';
import { getHexagon } from '../../shared/hexagon-registry/registry.js';
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

const EXPOSED_TOOLTIP = 'Exposure confirmed. Open to see the next step.';
// Pointy-top hexagon in a 100 x 115.47 box, inset so the stroke is not clipped.
const POINTS = '50,2 98,28.7 98,86.8 50,113.5 2,86.8 2,28.7';
const WAITING = new Set<Hexagon['status']>(['not_checked', 'false_positive']);

interface Props {
  hexagon: Hexagon;
  onConfirm: (id: string, isMatch: boolean) => void;
  onDispute: (id: string) => void;
  /** When set, a tap on a guess calls this instead of opening the built-in prompt (the dashboard shows its own modal). */
  onSelect?: (hexagon: Hexagon) => void;
  /** The user finished the remediation step: a confirmed exposure shows green instead of red. */
  fixed?: boolean;
  /** Small tiles (a phone held upright) show the icon and name only. */
  compact?: boolean;
  /** Positions the tile; the hexagon fills it. */
  className?: string;
  style?: CSSProperties;
}

export const InteractiveHexagonTile = ({ hexagon, onConfirm, onDispute, onSelect, fixed = false, compact = false, className, style }: Props) => {
  // Which prompt is open. Only the buttons inside a prompt record an answer; closing it (Esc, outside click, Keep it) records nothing.
  const [prompt, setPrompt] = useState<'confirm' | 'dispute' | null>(null);
  const exposed = hexagon.status === 'confirmed' && hexagon.exposure === true && !fixed;
  const visuals = getHexagonVisuals(hexagon.status);
  const paint = getHexPaint(hexagon.status, exposed);
  const requiresConfirmation = canConfirm(hexagon);
  const allowsDispute = canDispute(hexagon);
  const reopensPlan = exposed && !!onSelect;
  const interactive = requiresConfirmation || allowsDispute || reopensPlan;
  const secured = !exposed && (hexagon.status === 'checked' || hexagon.status === 'confirmed');
  const emoji = WAITING.has(hexagon.status) ? '🔍' : getHexagon(hexagon.id)?.artwork.emoji ?? visuals.icon;
  const showValue = !compact && !!hexagon.data && !WAITING.has(hexagon.status);

  return (
    <div className={cn('group/tile relative', className)} style={style}>
      <button
        type="button"
        className={cn(
          'group absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center focus-visible:outline-none',
          interactive ? 'cursor-pointer' : 'cursor-default',
          paint.ink,
          hexagon.status === 'guess' && 'animate-pulse motion-reduce:animate-none',
        )}
        onClick={() => {
          // A confirmed, unfixed exposure reopens its action plan; a guess asks "Is this you?"; a confident finding offers the dispute.
          if (reopensPlan) onSelect(hexagon);
          else if (requiresConfirmation && onSelect) onSelect(hexagon);
          else if (requiresConfirmation) setPrompt('confirm');
          else if (allowsDispute) setPrompt('dispute');
        }}
        aria-disabled={!interactive}
        aria-haspopup={interactive ? 'dialog' : undefined}
        title={exposed ? EXPOSED_TOOLTIP : visuals.tooltip}
      >
        <svg viewBox="0 0 100 115.47" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <polygon
            points={POINTS}
            strokeWidth={3}
            strokeLinejoin="round"
            className={cn(paint.polygon, paint.dashed && '[stroke-dasharray:7_5]', 'transition-colors group-focus-visible:stroke-blue-500')}
          />
        </svg>
        {secured && (
          <span aria-hidden="true" className="absolute right-[12%] top-[12%] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-green-600 text-[10px] text-white">
            ✓
          </span>
        )}
        <span className="relative text-xl leading-none" aria-hidden="true">{emoji}</span>
        <span className="relative w-[68%] text-[9px] font-semibold uppercase leading-tight tracking-wide">{hexagon.label}</span>
        {showValue && <span className="relative w-[68%] truncate text-[10px] text-gray-900">{hexagon.data}</span>}
        <span className="sr-only">{exposed ? EXPOSED_TOOLTIP : visuals.tooltip}</span>
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
