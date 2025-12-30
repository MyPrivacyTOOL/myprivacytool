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
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/40 rounded-full text-green-400 text-sm font-medium hover:from-green-500/30 hover:to-emerald-500/30 hover:border-green-400/60 transition-all group"
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
