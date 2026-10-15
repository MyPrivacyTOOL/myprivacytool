import { useEffect, useState } from 'react';
import type { Hexagon } from '@/types/hexagon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

  useEffect(() => {
    if (isOpen) setDone(false);
  }, [isOpen, hexagon.id]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto max-sm:bottom-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-2xl">
        <DialogHeader>
          <span className="w-fit rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">Exposure Confirmed</span>
          <DialogTitle>{hexagon.label}</DialogTitle>
          <DialogDescription className="text-base text-gray-700">
            {hexagon.remediation ?? 'Review this item and take the recommended step.'}
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
};
