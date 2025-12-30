// Google Analytics event tracking utility

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export const trackEvent = (
  eventName: string,
  params?: Record<string, string | number | boolean>
) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, params);
  }
};

// Hexagon tracking events
export const trackHexagonConfirm = (hexagonId: string, label: string, confirmed: boolean) => {
  trackEvent('hexagon_confirm', {
    hexagon_id: hexagonId,
    hexagon_label: label,
    action: confirmed ? 'confirmed' : 'unconfirmed',
  });
};

export const trackDeepScanUnlocked = (confirmedCount: number) => {
  trackEvent('deep_scan_unlocked', {
    confirmed_count: confirmedCount,
  });
};

// Voice AI tracking events
export const trackVoiceAIStart = () => {
  trackEvent('voice_ai_start', {
    action: 'started',
  });
};

export const trackVoiceAIStop = () => {
  trackEvent('voice_ai_stop', {
    action: 'stopped',
  });
};

export const trackVoiceAIMessage = (messageType: string) => {
  trackEvent('voice_ai_message', {
    message_type: messageType,
  });
};
