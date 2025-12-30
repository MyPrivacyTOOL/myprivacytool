import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, CheckCircle2, Bug } from 'lucide-react';
import { getVoiceData, resetDailyCounter, resetAllVoiceData } from '@/lib/voiceStorage';
import { cn } from '@/lib/utils';

interface VoiceDebugPanelProps {
  currentRiskScore: number;
  onSimulateComplete?: () => void;
}

export default function VoiceDebugPanel({ currentRiskScore, onSimulateComplete }: VoiceDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState(getVoiceData());

  // Refresh data
  const refreshData = useCallback(() => {
    setData(getVoiceData());
  }, []);

  // Listen for Shift+Alt+V to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setIsOpen(prev => !prev);
        refreshData();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refreshData]);

  // Only show in development mode
  if (!import.meta.env.DEV) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setIsOpen(true);
          refreshData();
        }}
        className="fixed bottom-4 right-4 z-50 p-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-400 hover:bg-yellow-500/30 transition-colors"
        title="Open Voice Debug Panel (Shift+Alt+V)"
      >
        <Bug className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-black/95 border border-yellow-500/50 rounded-xl p-4 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bug className="w-5 h-5 text-yellow-400" />
          <h3 className="text-yellow-400 font-bold text-sm">Voice Debug Panel</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-yellow-400/60 hover:text-yellow-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-xs">
          <span className="text-yellow-300/70">Sessions Today:</span>
          <span className="text-yellow-400 font-mono">{data.voiceSessionCount} / 20</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-yellow-300/70">Current Risk Score:</span>
          <span className={cn(
            "font-mono font-bold",
            currentRiskScore >= 70 ? "text-red-400" :
            currentRiskScore >= 40 ? "text-yellow-400" : "text-green-400"
          )}>{currentRiskScore}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-yellow-300/70">Best Risk Score:</span>
          <span className="text-green-400 font-mono">{data.bestRiskScore}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-yellow-300/70">Total Scans:</span>
          <span className="text-yellow-400 font-mono">{data.totalScansCompleted}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-yellow-300/70">Hexagons Today:</span>
          <span className="text-yellow-400 font-mono">{data.completedHexagons.length}</span>
        </div>
      </div>

      {/* Last 5 Responses */}
      <div className="mb-4">
        <h4 className="text-yellow-300/70 text-xs mb-2">Last 5 Responses:</h4>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {data.responseHistory.length === 0 ? (
            <p className="text-yellow-300/40 text-xs italic">No responses yet</p>
          ) : (
            data.responseHistory.map((response, i) => (
              <p key={i} className="text-yellow-300/60 text-xs truncate" title={response}>
                {i + 1}. {response.slice(0, 60)}...
              </p>
            ))
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            resetDailyCounter();
            refreshData();
          }}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-400 text-xs font-medium hover:bg-yellow-500/30 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset Daily
        </button>
        <button
          onClick={() => {
            onSimulateComplete?.();
            refreshData();
          }}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-xs font-medium hover:bg-green-500/30 transition-colors"
        >
          <CheckCircle2 className="w-3 h-3" />
          Complete All
        </button>
      </div>

      {/* Reset All */}
      <button
        onClick={() => {
          resetAllVoiceData();
          refreshData();
        }}
        className="w-full mt-2 px-3 py-1.5 text-red-400/60 text-xs hover:text-red-400 transition-colors"
      >
        Reset All Data
      </button>

      {/* Hotkey hint */}
      <p className="text-center text-yellow-300/40 text-xs mt-2">
        Press Shift+Alt+V to toggle
      </p>
    </div>
  );
}
