import { useState } from 'react';
import { Mic, Sparkles } from 'lucide-react';
import AliceHDModal from './AliceHDModal';
import { trackUpgradeModalOpened } from '@/lib/analytics';

interface AliceHDBadgeProps {
  showRateLimitMessage?: boolean;
}

export default function AliceHDBadge({ showRateLimitMessage = false }: AliceHDBadgeProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = () => {
    trackUpgradeModalOpened();
    setIsModalOpen(true);
  };

  return (
    <>
      <button
        onClick={handleOpenModal}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-risk-low-soft border border-risk-low/30 rounded-full text-risk-low text-sm font-medium hover:brightness-95 hover:border-risk-low/50 transition-all group"
      >
        <Mic className="w-4 h-4" />
        <span>Upgrade to Alice HD</span>
        <Sparkles className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" />
      </button>

      <AliceHDModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        showRateLimitMessage={showRateLimitMessage}
      />
    </>
  );
}
