import { useState } from 'react';
import { Volume2 } from 'lucide-react';
import AliceHDModal from './AliceHDModal';
import { trackUpgradeModalOpened } from '@/lib/analytics';

export default function FreeVoiceBadge() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = () => {
    trackUpgradeModalOpened();
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="relative inline-block">
        <button
          onClick={handleClick}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-secondary border border-risk-low/30 rounded-full text-muted-foreground text-xs hover:border-risk-low/30 hover:text-muted-foreground transition-all cursor-pointer"
        >
          <Volume2 className="w-3 h-3" />
          <span>Using Free Voice</span>
        </button>

        {/* Tooltip */}
        {showTooltip && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-surface/95 border border-risk-low/30 rounded-lg shadow-lg whitespace-nowrap z-50">
            <p className="text-risk-low text-xs">
              Upgrade to Alice HD for professional voice quality
            </p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
              <div className="w-2 h-2 bg-surface/95 border-r border-b border-risk-low/30 rotate-45" />
            </div>
          </div>
        )}
      </div>

      <AliceHDModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
