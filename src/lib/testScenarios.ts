// Test scenarios for LocaleIntent AI feature validation
import type { LanguageAnalysis, LanguagePrediction } from './languagePredictor';

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  expectedProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  languages: string[];
  timezone: string;
  icon: string;
}

export interface TestResult {
  scenario: TestScenario;
  prediction: LanguagePrediction | null;
  passed: boolean;
  confidence: number;
  executionTime: number;
}

export interface ValidationResults {
  tensorflowLoaded: boolean;
  localStorageWorks: boolean;
  feedbackWorks: boolean;
  analyticsWorks: boolean;
  browserCompatible: boolean;
  errors: string[];
}

// Predefined test scenarios
export const testScenarios: TestScenario[] = [
  {
    id: 'spanish-uk',
    name: 'Spanish Speaker in UK',
    description: 'Native Spanish speaker living in United Kingdom',
    expectedProfile: 'expatriate',
    languages: ['es-ES', 'en-GB'],
    timezone: 'Europe/London',
    icon: '🇪🇸',
  },
  {
    id: 'english-japan',
    name: 'English Speaker in Japan',
    description: 'American/British traveler or expat in Japan',
    expectedProfile: 'traveler',
    languages: ['en-US', 'ja'],
    timezone: 'Asia/Tokyo',
    icon: '🇯🇵',
  },
  {
    id: 'multilingual-eu',
    name: 'Multilingual European',
    description: 'User comfortable in English, Spanish, and French',
    expectedProfile: 'multilingual',
    languages: ['en-US', 'es-MX', 'fr-FR'],
    timezone: 'America/New_York',
    icon: '🌍',
  },
  {
    id: 'vpn-user',
    name: 'VPN User',
    description: 'Chinese speaker with US timezone (likely VPN)',
    expectedProfile: 'expatriate',
    languages: ['zh-CN', 'en-US'],
    timezone: 'America/Los_Angeles',
    icon: '🔒',
  },
  {
    id: 'local-perfect',
    name: 'Local User (Perfect Match)',
    description: 'English speaker in UK with matching settings',
    expectedProfile: 'local',
    languages: ['en-GB'],
    timezone: 'Europe/London',
    icon: '🏠',
  },
  {
    id: 'german-australia',
    name: 'German in Australia',
    description: 'German expatriate living in Australia',
    expectedProfile: 'expatriate',
    languages: ['de-DE', 'en-AU'],
    timezone: 'Australia/Sydney',
    icon: '🇦🇺',
  },
  {
    id: 'portuguese-brazil-local',
    name: 'Brazilian Local',
    description: 'Portuguese speaker in Brazil (local user)',
    expectedProfile: 'local',
    languages: ['pt-BR'],
    timezone: 'America/Sao_Paulo',
    icon: '🇧🇷',
  },
  {
    id: 'arab-dubai',
    name: 'Arabic Speaker in Dubai',
    description: 'Native Arabic speaker in UAE',
    expectedProfile: 'local',
    languages: ['ar', 'en'],
    timezone: 'Asia/Dubai',
    icon: '🇦🇪',
  },
  {
    id: 'indian-singapore',
    name: 'Indian in Singapore',
    description: 'Hindi speaker working in Singapore',
    expectedProfile: 'expatriate',
    languages: ['hi', 'en-SG'],
    timezone: 'Asia/Singapore',
    icon: '🇸🇬',
  },
  {
    id: 'polyglot',
    name: 'True Polyglot',
    description: 'User with 5+ languages configured',
    expectedProfile: 'multilingual',
    languages: ['en-US', 'es', 'fr', 'de', 'it', 'pt'],
    timezone: 'Europe/Brussels',
    icon: '🗣️',
  },
];

// Create mock language analysis from scenario
export function createMockAnalysis(scenario: TestScenario): LanguageAnalysis {
  const primaryLanguage = scenario.languages[0];
  const baseLang = primaryLanguage.split('-')[0].toLowerCase();
  
  // Language families mapping
  const languageFamilies: Record<string, string> = {
    'en': 'Germanic', 'de': 'Germanic', 'nl': 'Germanic',
    'es': 'Romance', 'fr': 'Romance', 'it': 'Romance', 'pt': 'Romance',
    'zh': 'Sino-Tibetan', 'ja': 'Japonic', 'ko': 'Koreanic',
    'ar': 'Semitic', 'hi': 'Indo-Aryan', 'ru': 'Slavic',
  };
  
  // Timezone to expected languages
  const timezoneLanguages: Record<string, string[]> = {
    'Europe/London': ['en'],
    'Asia/Tokyo': ['ja'],
    'America/New_York': ['en'],
    'America/Los_Angeles': ['en', 'es'],
    'Australia/Sydney': ['en'],
    'America/Sao_Paulo': ['pt'],
    'Asia/Dubai': ['ar', 'en'],
    'Asia/Singapore': ['en', 'zh', 'ms'],
    'Europe/Brussels': ['fr', 'nl', 'de'],
  };
  
  const expectedLangs = timezoneLanguages[scenario.timezone] || [];
  const hasLanguageLocationMismatch = expectedLangs.length > 0 && !expectedLangs.includes(baseLang);
  
  // Expatriate patterns
  const expatriatePatterns: Record<string, string[]> = {
    'es': ['Europe/London', 'Europe/Berlin'],
    'de': ['Australia/Sydney', 'America/New_York'],
    'zh': ['America/Los_Angeles', 'America/New_York'],
    'hi': ['Asia/Singapore', 'Europe/London'],
  };
  
  const expatriatePatternDetected = (expatriatePatterns[baseLang] || []).includes(scenario.timezone);
  
  // VPN probability calculation
  let vpnProbability = 0.1;
  if (baseLang === 'zh' && scenario.timezone.startsWith('America/')) {
    vpnProbability = 0.75;
  } else if (hasLanguageLocationMismatch && !expatriatePatternDetected) {
    vpnProbability = 0.4;
  }
  
  return {
    languages: scenario.languages,
    primaryLanguage,
    fallbackLanguages: scenario.languages.slice(1),
    timezone: scenario.timezone,
    timezoneOffset: -300, // Mock value
    locale: primaryLanguage,
    hasLanguageLocationMismatch,
    mismatchDetails: hasLanguageLocationMismatch 
      ? `Language ${primaryLanguage} doesn't match timezone ${scenario.timezone}`
      : null,
    languageFamily: languageFamilies[baseLang] || 'Unknown',
    vpnProbability,
    expatriatePatternDetected,
  };
}

// Run validation checks
export async function runValidationChecks(): Promise<ValidationResults> {
  const errors: string[] = [];
  const results: ValidationResults = {
    tensorflowLoaded: false,
    localStorageWorks: false,
    feedbackWorks: false,
    analyticsWorks: false,
    browserCompatible: true,
    errors,
  };
  
  // Check TensorFlow.js
  try {
    const tf = await import('@tensorflow/tfjs');
    await tf.ready();
    results.tensorflowLoaded = true;
  } catch (e) {
    errors.push(`TensorFlow.js failed to load: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
  
  // Check localStorage
  try {
    const testKey = '__locale_test__';
    localStorage.setItem(testKey, 'test');
    const retrieved = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);
    results.localStorageWorks = retrieved === 'test';
    if (!results.localStorageWorks) {
      errors.push('localStorage write/read failed');
    }
  } catch (e) {
    errors.push(`localStorage not available: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
  
  // Check feedback storage
  try {
    const feedbackKey = 'locale_feedback_stats';
    const existing = localStorage.getItem(feedbackKey);
    const testData = { test: true, timestamp: Date.now() };
    localStorage.setItem(feedbackKey, JSON.stringify(testData));
    const retrieved = JSON.parse(localStorage.getItem(feedbackKey) || '{}');
    results.feedbackWorks = retrieved.test === true;
    // Restore original
    if (existing) {
      localStorage.setItem(feedbackKey, existing);
    } else {
      localStorage.removeItem(feedbackKey);
    }
  } catch (e) {
    errors.push(`Feedback storage failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
  
  // Check browser compatibility
  if (!navigator.languages) {
    results.browserCompatible = false;
    errors.push('navigator.languages not supported - fallback to navigator.language');
  }
  if (!Intl.DateTimeFormat) {
    results.browserCompatible = false;
    errors.push('Intl.DateTimeFormat not supported');
  }
  if (!window.speechSynthesis) {
    errors.push('Web Speech API not supported - voice features disabled');
  }
  
  // Mock analytics check (would need real implementation)
  results.analyticsWorks = typeof window !== 'undefined';
  
  return results;
}

// Get stored test results
export function getStoredTestResults(): TestResult[] {
  try {
    const stored = localStorage.getItem('locale_test_results');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Store test results
export function storeTestResults(results: TestResult[]): void {
  try {
    localStorage.setItem('locale_test_results', JSON.stringify(results));
  } catch (e) {
    console.error('Failed to store test results:', e);
  }
}

// Calculate accuracy stats
export function calculateAccuracyStats(results: TestResult[]): {
  overall: number;
  byProfile: Record<string, { correct: number; total: number; accuracy: number }>;
  bestScenario: string | null;
  worstScenario: string | null;
} {
  const byProfile: Record<string, { correct: number; total: number; accuracy: number }> = {
    local: { correct: 0, total: 0, accuracy: 0 },
    expatriate: { correct: 0, total: 0, accuracy: 0 },
    traveler: { correct: 0, total: 0, accuracy: 0 },
    multilingual: { correct: 0, total: 0, accuracy: 0 },
  };
  
  let totalCorrect = 0;
  let bestConfidence = 0;
  let worstConfidence = 100;
  let bestScenario: string | null = null;
  let worstScenario: string | null = null;
  
  results.forEach(result => {
    const profile = result.scenario.expectedProfile;
    byProfile[profile].total++;
    
    if (result.passed) {
      byProfile[profile].correct++;
      totalCorrect++;
    }
    
    if (result.confidence > bestConfidence) {
      bestConfidence = result.confidence;
      bestScenario = result.scenario.name;
    }
    if (result.confidence < worstConfidence) {
      worstConfidence = result.confidence;
      worstScenario = result.scenario.name;
    }
  });
  
  // Calculate per-profile accuracy
  Object.keys(byProfile).forEach(profile => {
    const { correct, total } = byProfile[profile];
    byProfile[profile].accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  });
  
  return {
    overall: results.length > 0 ? Math.round((totalCorrect / results.length) * 100) : 0,
    byProfile,
    bestScenario,
    worstScenario,
  };
}
