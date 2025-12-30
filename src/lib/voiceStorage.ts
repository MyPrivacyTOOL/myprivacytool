// Voice AI localStorage data structure and utilities

const VOICE_STORAGE_KEY = 'alice_voice_data';

export interface VoiceStorageData {
  voiceSessionCount: number;
  lastSessionDate: string; // YYYY-MM-DD
  voiceEnabled: boolean;
  completedHexagons: string[];
  totalScansCompleted: number;
  bestRiskScore: number;
  responseHistory: string[];
}

const getDefaultData = (): VoiceStorageData => ({
  voiceSessionCount: 0,
  lastSessionDate: '',
  voiceEnabled: true,
  completedHexagons: [],
  totalScansCompleted: 0,
  bestRiskScore: 100,
  responseHistory: [],
});

const getTodayKey = (): string => {
  return new Date().toISOString().split('T')[0];
};

// Get voice data from localStorage
export const getVoiceData = (): VoiceStorageData => {
  try {
    const stored = localStorage.getItem(VOICE_STORAGE_KEY);
    if (!stored) return getDefaultData();
    
    const data = JSON.parse(stored) as VoiceStorageData;
    const today = getTodayKey();
    
    // Reset daily counters if it's a new day
    if (data.lastSessionDate !== today) {
      return {
        ...data,
        voiceSessionCount: 0,
        lastSessionDate: today,
        completedHexagons: [],
      };
    }
    
    return data;
  } catch {
    return getDefaultData();
  }
};

// Save voice data to localStorage
export const saveVoiceData = (data: Partial<VoiceStorageData>): void => {
  const current = getVoiceData();
  const updated = { ...current, ...data };
  localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(updated));
};

// Increment session count
export const incrementVoiceSession = (): number => {
  const data = getVoiceData();
  const today = getTodayKey();
  const newCount = data.voiceSessionCount + 1;
  
  saveVoiceData({
    voiceSessionCount: newCount,
    lastSessionDate: today,
  });
  
  return newCount;
};

// Add completed hexagon
export const addCompletedHexagon = (hexagonId: string): void => {
  const data = getVoiceData();
  if (!data.completedHexagons.includes(hexagonId)) {
    saveVoiceData({
      completedHexagons: [...data.completedHexagons, hexagonId],
    });
  }
};

// Update best risk score
export const updateBestRiskScore = (score: number): void => {
  const data = getVoiceData();
  if (score < data.bestRiskScore) {
    saveVoiceData({ bestRiskScore: score });
  }
};

// Increment total scans completed
export const incrementScansCompleted = (): void => {
  const data = getVoiceData();
  saveVoiceData({ totalScansCompleted: data.totalScansCompleted + 1 });
};

// Add response to history (keep last 5)
export const addResponseToHistory = (response: string): void => {
  const data = getVoiceData();
  const history = [response, ...data.responseHistory].slice(0, 5);
  saveVoiceData({ responseHistory: history });
};

// Toggle voice enabled
export const toggleVoiceEnabled = (enabled: boolean): void => {
  saveVoiceData({ voiceEnabled: enabled });
};

// Reset daily counter (for testing)
export const resetDailyCounter = (): void => {
  saveVoiceData({
    voiceSessionCount: 0,
    completedHexagons: [],
  });
};

// Reset all data (for testing)
export const resetAllVoiceData = (): void => {
  localStorage.removeItem(VOICE_STORAGE_KEY);
};

// Get remaining sessions
export const getRemainingVoiceSessions = (): number => {
  const data = getVoiceData();
  return Math.max(0, 20 - data.voiceSessionCount);
};

// Check if can start session
export const canStartVoiceSession = (): boolean => {
  return getRemainingVoiceSessions() > 0;
};
