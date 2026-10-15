import type { Hexagon } from '@/types/hexagon';
import { getHexagonVisuals } from '@/utils/hexagonStyles';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  hexagon: Hexagon;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (isMatch: boolean) => void;
}

/** Bottom sheet on mobile, centred card on desktop. Only the two buttons answer; closing records nothing. */
export const HitlConfirmModal = ({ hexagon, isOpen, onClose, onConfirm }: Props) => {
  const visuals = getHexagonVisuals(hexagon.status);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-sm:bottom-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-2xl">
        <DialogHeader className="items-center text-center sm:text-center">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-purple-500 bg-purple-100 text-2xl font-bold text-purple-800"
          >
            {visuals.icon}
          </div>
          <p className="text-sm font-medium text-gray-600">{hexagon.label}</p>
          <DialogDescription className="text-base text-gray-700">
            {hexagon.data ? <>We found <span className="font-medium">{hexagon.data}</span>.</> : 'We found something linked to you.'}
          </DialogDescription>
          <DialogTitle className="text-3xl font-bold">Is this you?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="flex-1 bg-green-600 text-white hover:bg-green-700" onClick={() => onConfirm(true)}>
            ✅ Yes, that's me
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => onConfirm(false)}>
            ❌ No, not me
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
