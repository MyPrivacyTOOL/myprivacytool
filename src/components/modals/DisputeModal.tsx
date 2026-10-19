import type { Hexagon } from '@/types/hexagon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  hexagon: Hexagon;
  isOpen: boolean;
  onClose: () => void;
  onDispute: () => void;
}

/** For touch screens, where there is no hover: tap a confident finding, then say it is wrong. Closing records nothing. */
export const DisputeModal = ({ hexagon, isOpen, onClose, onDispute }: Props) => (
  <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto max-sm:bottom-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-2xl">
      <DialogHeader className="text-center sm:text-center">
        <p className="text-sm font-medium text-gray-600">{hexagon.label}</p>
        <DialogTitle className="text-2xl font-bold">Is this wrong?</DialogTitle>
        <DialogDescription className="text-base text-gray-700">
          {hexagon.data ? <>We found <span className="font-medium">{hexagon.data}</span>.</> : 'We found this.'} Tell us if it is not you.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant="outline" className="flex-1" onClick={onDispute}>Not me</Button>
        <Button className="flex-1 bg-green-600 text-white hover:bg-green-700" onClick={onClose}>Looks right</Button>
      </div>
    </DialogContent>
  </Dialog>
);
