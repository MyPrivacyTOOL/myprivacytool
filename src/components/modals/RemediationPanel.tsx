import { useEffect, useState } from 'react';
import type { Hexagon } from '@/types/hexagon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fixBlockFor, canShowFix, noActionReason } from '@/lib/hexagonFix';
import { fixBlocksV2Enabled } from '@/config/hexagonTile';
import FixBlockView from '@/components/hexagon/FixBlockView';
import type { TileKind } from '@/lib/hexagonTile';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  hexagon: Hexagon;
  isOpen: boolean;
  onClose: () => void;
  onMarkFixed: () => void;
}

/** Only http(s) links are rendered as actions; anything else in the payload is ignored. */
const safeUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

export const RemediationPanel = ({ hexagon, isOpen, onClose, onMarkFixed }: Props) => {
  const [done, setDone] = useState(false);
  const url = safeUrl(hexagon.remediation_url);
  // MPC-8745: with the fix-blocks switch on, a hexagon with a typed block shows it (red, or a guess the visitor said yes to);
  // a hexagon with no fix step says why instead of a generic line. Off: the text below is unchanged.
  const fixOn = fixBlocksV2Enabled();
  const tileKind: TileKind | undefined = hexagon.status === 'confirmed' && hexagon.tile === 'our_guess' ? 'you_confirmed' : hexagon.tile;
  const block = fixOn && tileKind && canShowFix(hexagon.id, tileKind) ? fixBlockFor(hexagon.id) : undefined;
  const reason = fixOn && !block ? noActionReason(hexagon.id) : undefined;

  useEffect(() => {
    if (isOpen) setDone(false);
  }, [isOpen, hexagon.id]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto max-sm:bottom-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-2xl">
        <DialogHeader>
          <span className="w-fit rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
            {hexagon.tile === 'needs_fixing' && hexagon.status !== 'confirmed' ? 'Needs fixing' : 'Exposure Confirmed'}
          </span>
          <DialogTitle>{hexagon.label}</DialogTitle>
          <DialogDescription className="text-base text-gray-700">
            {block ? 'Here is what you can do.' : (reason ?? hexagon.remediation ?? 'Review this item and take the recommended step.')}
          </DialogDescription>
        </DialogHeader>
        {block && <FixBlockView block={block} />}
        {url && (
          <Button asChild className="bg-blue-600 text-white hover:bg-blue-700">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open in New Tab
            </a>
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Checkbox id={`fixed-${hexagon.id}`} checked={done} onCheckedChange={(c) => setDone(c === true)} />
          <label htmlFor={`fixed-${hexagon.id}`} className="text-sm">I have completed this step.</label>
        </div>
        <Button disabled={!done} className="bg-green-600 text-white hover:bg-green-700" onClick={onMarkFixed}>
          Mark as Fixed
        </Button>
        <p className="text-xs text-gray-500">Recorded as what you told us. It turns solid green only when we check again.</p>
      </DialogContent>
    </Dialog>
  );
};
