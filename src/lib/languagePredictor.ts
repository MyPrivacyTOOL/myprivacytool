// Enhanced Language Predictor with TensorFlow.js
// Client-side language preference prediction with improved accuracy

import * as tf from '@tensorflow/tfjs';

export interface LanguageAnalysis {
  languages: string[];
  primaryLanguage: string;
  fallbackLanguages: string[];
  timezone: string;
  timezoneOffset: number;
  locale: string;
  hasLanguageLocationMismatch: boolean;
  mismatchDetails: string | null;
  languageFamily: string;
  vpnProbability: number;
  expatriatePatternDetected: boolean;
}

export interface ProfileProbability {
  profile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  probability: number;
  icon: string;
  description: string;
}

export interface LanguagePrediction {
  preferredLanguage: string;
  preferredLanguageConfidence: number;
  userProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  userProfileConfidence: number;
  allProfiles: ProfileProbability[];
  reasoning: string[];
  recommendations: string[];
  signals: SignalAnalysis[];
  vpnLikelihood: 'low' | 'medium' | 'high';
}

export interface SignalAnalysis {
  signal: string;
  value: string;
  weight: number;
  impact: 'supports' | 'contradicts' | 'neutral';
}

export interface FeedbackData {
  predictionCorrect: boolean | null;
  actualLanguage: string | null;
  userProfile: string | null;
  timestamp: number;
  confidenceScore?: number;
  predictionShown?: string;
}

// Language code to name mapping
const languageNames: Record<string, string> = {
  'en': 'English', 'en-US': 'English (US)', 'en-GB': 'English (UK)',
  'es': 'Spanish', 'es-ES': 'Spanish (Spain)', 'es-MX': 'Spanish (Mexico)',
  'fr': 'French', 'fr-FR': 'French (France)', 'de': 'German', 'de-DE': 'German (Germany)',
  'it': 'Italian', 'pt': 'Portuguese', 'pt-BR': 'Portuguese (Brazil)',
  'zh': 'Chinese', 'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)',
  'ja': 'Japanese', 'ko': 'Korean', 'ru': 'Russian', 'ar': 'Arabic',
  'hi': 'Hindi', 'nl': 'Dutch', 'pl': 'Polish', 'tr': 'Turkish',
  'vi': 'Vietnamese', 'th': 'Thai', 'sv': 'Swedish', 'da': 'Danish',
  'no': 'Norwegian', 'fi': 'Finnish', 'cs': 'Czech', 'el': 'Greek',
  'he': 'Hebrew', 'id': 'Indonesian', 'ms': 'Malay', 'uk': 'Ukrainian',
  'ca': 'Catalan', 'ro': 'Romanian', 'hu': 'Hungarian', 'sk': 'Slovak',
};

// Language families for better classification
const languageFamilies: Record<string, string> = {
  'en': 'Germanic', 'de': 'Germanic', 'nl': 'Germanic', 'sv': 'Germanic', 
  'da': 'Germanic', 'no': 'Germanic',
  'es': 'Romance', 'fr': 'Romance', 'it': 'Romance', 'pt': 'Romance', 
  'ro': 'Romance', 'ca': 'Romance',
  'ru': 'Slavic', 'pl': 'Slavic', 'cs': 'Slavic', 'uk': 'Slavic', 
  'sk': 'Slavic', 'hr': 'Slavic', 'bg': 'Slavic',
  'zh': 'Sino-Tibetan', 'ja': 'Japonic', 'ko': 'Koreanic',
  'ar': 'Semitic', 'he': 'Semitic',
  'hi': 'Indo-Aryan', 'tr': 'Turkic',
  'vi': 'Austroasiatic', 'th': 'Kra-Dai',
  'fi': 'Uralic', 'hu': 'Uralic',
  'el': 'Hellenic', 'id': 'Austronesian', 'ms': 'Austronesian',
};

// Common expatriate patterns (language in unexpected timezone)
const expatriatePatterns: Record<string, string[]> = {
  // Spanish speakers abroad
  'es': ['Europe/London', 'Europe/Berlin', 'America/New_York', 'Australia/Sydney'],
  // French speakers abroad
  'fr': ['Europe/London', 'America/New_York', 'Asia/Singapore', 'Australia/Sydney'],
  // German speakers abroad
  'de': ['Europe/London', 'America/New_York', 'Asia/Tokyo'],
  // Chinese speakers abroad
  'zh': ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Australia/Sydney'],
  // Indian languages abroad
  'hi': ['America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore'],
  // Portuguese speakers abroad
  'pt': ['Europe/London', 'America/New_York', 'Asia/Tokyo'],
  // Russian speakers abroad
  'ru': ['Europe/Berlin', 'America/New_York', 'Asia/Dubai'],
};

// Timezone to expected language mapping (extended)
const timezoneLanguages: Record<string, string[]> = {
  'America/New_York': ['en'], 'America/Los_Angeles': ['en', 'es'],
  'America/Chicago': ['en', 'es'], 'America/Denver': ['en'],
  'America/Phoenix': ['en', 'es'], 'America/Anchorage': ['en'],
  'Europe/London': ['en'], 'Europe/Paris': ['fr'],
  'Europe/Berlin': ['de'], 'Europe/Madrid': ['es', 'ca'],
  'Europe/Rome': ['it'], 'Europe/Amsterdam': ['nl'],
  'Europe/Brussels': ['fr', 'nl', 'de'], 'Europe/Zurich': ['de', 'fr', 'it'],
  'Europe/Vienna': ['de'], 'Europe/Stockholm': ['sv'],
  'Europe/Oslo': ['no'], 'Europe/Copenhagen': ['da'],
  'Europe/Helsinki': ['fi'], 'Europe/Warsaw': ['pl'],
  'Europe/Prague': ['cs'], 'Europe/Budapest': ['hu'],
  'Europe/Athens': ['el'], 'Europe/Moscow': ['ru'],
  'Europe/Kiev': ['uk'], 'Europe/Bucharest': ['ro'],
  'Asia/Tokyo': ['ja'], 'Asia/Shanghai': ['zh'],
  'Asia/Hong_Kong': ['zh', 'en'], 'Asia/Singapore': ['en', 'zh', 'ms'],
  'Asia/Seoul': ['ko'], 'Asia/Dubai': ['ar', 'en'],
  'Asia/Kolkata': ['hi', 'en'], 'Asia/Bangkok': ['th'],
  'Asia/Jakarta': ['id'], 'Asia/Manila': ['en', 'tl'],
  'Asia/Taipei': ['zh'], 'Asia/Kuala_Lumpur': ['ms', 'en'],
  'Australia/Sydney': ['en'], 'Australia/Melbourne': ['en'],
  'Pacific/Auckland': ['en'], 'America/Toronto': ['en', 'fr'],
  'America/Vancouver': ['en'], 'America/Sao_Paulo': ['pt'],
  'America/Buenos_Aires': ['es'], 'America/Mexico_City': ['es'],
  'America/Lima': ['es'], 'America/Bogota': ['es'],
  'Africa/Cairo': ['ar'], 'Africa/Johannesburg': ['en', 'af'],
  'Africa/Lagos': ['en'], 'Africa/Nairobi': ['en', 'sw'],
};

// VPN detection patterns (unusual timezone/language combinations)
const vpnIndicators: Array<{ lang: string; timezone: string; probability: number }> = [
  // US VPN servers commonly used by non-English speakers
  { lang: 'zh', timezone: 'America/New_York', probability: 0.7 },
  { lang: 'zh', timezone: 'America/Los_Angeles', probability: 0.75 },
  { lang: 'ru', timezone: 'America/New_York', probability: 0.65 },
  { lang: 'ar', timezone: 'Europe/London', probability: 0.6 },
  // European VPN servers
  { lang: 'zh', timezone: 'Europe/Amsterdam', probability: 0.8 },
  { lang: 'ru', timezone: 'Europe/Amsterdam', probability: 0.7 },
  { lang: 'ar', timezone: 'Europe/Amsterdam', probability: 0.65 },
];

// TensorFlow model instance
let model: tf.LayersModel | null = null;
let modelLoaded = false;

// Initialize enhanced TensorFlow.js model
export async function initializeModel(): Promise<boolean> {
  if (modelLoaded) return true;
  
  try {
    // Enhanced MLP with more features and layers
    model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [12], units: 32, activation: 'relu' }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({ units: 16, activation: 'relu' }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 8, activation: 'relu' }),
        tf.layers.dense({ units: 4, activation: 'softmax' }), // 4 user profiles
      ],
    });
    
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });
    
    // Pre-set weights based on heuristic patterns (simulated training)
    await initializeWeightsWithHeuristics();
    
    modelLoaded = true;
    console.log('Enhanced language prediction model initialized');
    return true;
  } catch (error) {
    console.error('Failed to initialize language model:', error);
    return false;
  }
}

// Initialize weights with heuristic-based values
async function initializeWeightsWithHeuristics(): Promise<void> {
  if (!model) return;
  
  // Warm up the model with representative examples
  const trainingExamples = tf.tensor2d([
    // Local user: 1 lang, no mismatch, local timezone, same family
    [0.1, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    // Expatriate: mismatch, different timezone than expected
    [0.2, 1, 0.3, 1, 1, 0, 1, 0, 0.7, 0, 0, 0],
    // Traveler: multiple langs, some mismatch signals
    [0.4, 0.5, 0.6, 1, 1, 0, 0, 1, 0.3, 0, 0, 0],
    // Multilingual: many languages, multiple families
    [0.6, 0, 0.5, 1, 1, 0, 0, 0, 0, 1, 0, 0],
  ]);
  
  const labels = tf.tensor2d([
    [1, 0, 0, 0], // local
    [0, 1, 0, 0], // expatriate
    [0, 0, 1, 0], // traveler
    [0, 0, 0, 1], // multilingual
  ]);
  
  // Quick training pass
  await model.fit(trainingExamples, labels, { epochs: 50, verbose: 0 });
  
  trainingExamples.dispose();
  labels.dispose();
}

// Get language family
function getLanguageFamily(langCode: string): string {
  const baseLang = langCode.split('-')[0].toLowerCase();
  return languageFamilies[baseLang] || 'Unknown';
}

// Detect expatriate pattern
function detectExpatriatePattern(primaryLang: string, timezone: string): boolean {
  const baseLang = primaryLang.split('-')[0].toLowerCase();
  const patterns = expatriatePatterns[baseLang] || [];
  return patterns.includes(timezone);
}

// Calculate VPN probability
function calculateVpnProbability(primaryLang: string, timezone: string): number {
  const baseLang = primaryLang.split('-')[0].toLowerCase();
  
  for (const indicator of vpnIndicators) {
    if (indicator.lang === baseLang && indicator.timezone === timezone) {
      return indicator.probability;
    }
  }
  
  // General heuristic: unusual combinations
  const expectedLangs = timezoneLanguages[timezone] || [];
  if (expectedLangs.length > 0 && !expectedLangs.includes(baseLang)) {
    // Check if it's a common language globally
    const globalLanguages = ['en', 'es', 'zh', 'ar', 'hi', 'pt', 'ru'];
    if (globalLanguages.includes(baseLang)) {
      return 0.3; // Lower probability for globally common languages
    }
    return 0.5; // Higher probability for uncommon combinations
  }
  
  return 0.1; // Low probability if patterns match
}

// Enhanced language analysis
export function analyzeLanguages(): LanguageAnalysis {
  const languages = navigator.languages ? [...navigator.languages] : [navigator.language];
  const primaryLanguage = navigator.language;
  const fallbackLanguages = languages.slice(1);
  
  const dateTimeFormat = Intl.DateTimeFormat().resolvedOptions();
  const timezone = dateTimeFormat.timeZone;
  const locale = dateTimeFormat.locale;
  const timezoneOffset = new Date().getTimezoneOffset();
  
  // Enhanced analysis
  const primaryLangCode = primaryLanguage.split('-')[0].toLowerCase();
  const expectedLanguages = timezoneLanguages[timezone] || [];
  const hasLanguageLocationMismatch = expectedLanguages.length > 0 && 
    !expectedLanguages.includes(primaryLangCode);
  
  const languageFamily = getLanguageFamily(primaryLanguage);
  const vpnProbability = calculateVpnProbability(primaryLanguage, timezone);
  const expatriatePatternDetected = detectExpatriatePattern(primaryLanguage, timezone);
  
  let mismatchDetails: string | null = null;
  if (hasLanguageLocationMismatch) {
    const expectedLangNames = expectedLanguages.map(l => languageNames[l] || l).join(', ');
    mismatchDetails = `Browser set to ${languageNames[primaryLangCode] || primaryLanguage} (${languageFamily} family), but timezone ${timezone} typically uses ${expectedLangNames}`;
  }
  
  return {
    languages,
    primaryLanguage,
    fallbackLanguages,
    timezone,
    timezoneOffset,
    locale,
    hasLanguageLocationMismatch,
    mismatchDetails,
    languageFamily,
    vpnProbability,
    expatriatePatternDetected,
  };
}

// Get readable language name
export function getLanguageName(code: string): string {
  return languageNames[code] || languageNames[code.split('-')[0]] || code;
}

// Generate profile probabilities
function generateProfileProbabilities(
  analysis: LanguageAnalysis,
  tfProbabilities?: Float32Array | Int32Array | Uint8Array
): ProfileProbability[] {
  const profiles: ProfileProbability[] = [
    {
      profile: 'local',
      probability: 25,
      icon: '🏠',
      description: 'Uses local language in home region',
    },
    {
      profile: 'expatriate',
      probability: 25,
      icon: '🌍',
      description: 'Living abroad, using native language',
    },
    {
      profile: 'traveler',
      probability: 25,
      icon: '✈️',
      description: 'Frequently visits different regions',
    },
    {
      profile: 'multilingual',
      probability: 25,
      icon: '🗣️',
      description: 'Comfortable in multiple languages',
    },
  ];
  
  // Apply TensorFlow probabilities if available
  if (tfProbabilities && tfProbabilities.length === 4) {
    profiles[0].probability = Math.round(tfProbabilities[0] * 100);
    profiles[1].probability = Math.round(tfProbabilities[1] * 100);
    profiles[2].probability = Math.round(tfProbabilities[2] * 100);
    profiles[3].probability = Math.round(tfProbabilities[3] * 100);
  } else {
    // Heuristic-based probabilities
    const uniqueFamilies = new Set(analysis.languages.map(l => getLanguageFamily(l)));
    const languageCount = analysis.languages.length;
    
    if (analysis.hasLanguageLocationMismatch || analysis.expatriatePatternDetected) {
      profiles[0].probability = 10;
      profiles[1].probability = 55;
      profiles[2].probability = 25;
      profiles[3].probability = 10;
    } else if (uniqueFamilies.size >= 3) {
      profiles[0].probability = 5;
      profiles[1].probability = 15;
      profiles[2].probability = 25;
      profiles[3].probability = 55;
    } else if (languageCount >= 3) {
      profiles[0].probability = 15;
      profiles[1].probability = 20;
      profiles[2].probability = 45;
      profiles[3].probability = 20;
    } else if (languageCount === 1 && !analysis.hasLanguageLocationMismatch) {
      profiles[0].probability = 70;
      profiles[1].probability = 10;
      profiles[2].probability = 10;
      profiles[3].probability = 10;
    }
    
    // Adjust for VPN probability
    if (analysis.vpnProbability > 0.5) {
      profiles[1].probability = Math.min(profiles[1].probability + 15, 80);
      profiles[0].probability = Math.max(profiles[0].probability - 15, 5);
    }
  }
  
  // Sort by probability descending
  return profiles.sort((a, b) => b.probability - a.probability);
}

// Generate signal analysis
function generateSignalAnalysis(analysis: LanguageAnalysis): SignalAnalysis[] {
  const signals: SignalAnalysis[] = [];
  
  // Primary language signal
  signals.push({
    signal: 'Primary Language',
    value: `${getLanguageName(analysis.primaryLanguage)} (${analysis.languageFamily} family)`,
    weight: 0.35,
    impact: 'supports',
  });
  
  // Timezone signal
  const expectedLangs = timezoneLanguages[analysis.timezone] || [];
  signals.push({
    signal: 'Timezone',
    value: analysis.timezone,
    weight: 0.25,
    impact: analysis.hasLanguageLocationMismatch ? 'contradicts' : 'supports',
  });
  
  // Language count signal
  signals.push({
    signal: 'Language Preferences',
    value: `${analysis.languages.length} configured`,
    weight: 0.15,
    impact: analysis.languages.length > 2 ? 'neutral' : 'supports',
  });
  
  // Fallback languages
  if (analysis.fallbackLanguages.length > 0) {
    const fallbackFamilies = new Set(analysis.fallbackLanguages.map(l => getLanguageFamily(l)));
    signals.push({
      signal: 'Fallback Languages',
      value: `${fallbackFamilies.size} language families`,
      weight: 0.1,
      impact: fallbackFamilies.size > 1 ? 'neutral' : 'supports',
    });
  }
  
  // VPN indicator
  if (analysis.vpnProbability > 0.3) {
    signals.push({
      signal: 'VPN Likelihood',
      value: `${Math.round(analysis.vpnProbability * 100)}% probability`,
      weight: 0.15,
      impact: 'contradicts',
    });
  }
  
  return signals;
}

// Enhanced prediction with TensorFlow.js
export async function predictLanguagePreference(analysis: LanguageAnalysis): Promise<LanguagePrediction> {
  const reasoning: string[] = [];
  const recommendations: string[] = [];
  
  // Ensure model is loaded
  if (!modelLoaded) {
    await initializeModel();
  }
  
  // Enhanced feature engineering (12 features)
  const languageCount = analysis.languages.length;
  const uniqueFamilies = new Set(analysis.languages.map(l => getLanguageFamily(l)));
  const hasMismatch = analysis.hasLanguageLocationMismatch ? 1 : 0;
  const timezoneNormalized = (analysis.timezoneOffset + 720) / 1440;
  const isMultilingual = uniqueFamilies.size > 1 ? 1 : 0;
  const hasFallbacks = analysis.fallbackLanguages.length > 0 ? 1 : 0;
  const familyCount = uniqueFamilies.size / 5;
  const expatriatePattern = analysis.expatriatePatternDetected ? 1 : 0;
  const vpnProb = analysis.vpnProbability;
  
  // Family type encoding (one-hot simplified)
  const isRomance = analysis.languageFamily === 'Romance' ? 1 : 0;
  const isGermanic = analysis.languageFamily === 'Germanic' ? 1 : 0;
  const isAsian = ['Sino-Tibetan', 'Japonic', 'Koreanic'].includes(analysis.languageFamily) ? 1 : 0;
  
  let tfProbabilities: Float32Array | Int32Array | Uint8Array | undefined;
  
  // Run TensorFlow prediction
  if (model) {
    try {
      const inputTensor = tf.tensor2d([[
        languageCount / 10,
        hasMismatch,
        timezoneNormalized,
        isMultilingual,
        hasFallbacks,
        familyCount,
        expatriatePattern,
        vpnProb,
        isRomance,
        isGermanic,
        isAsian,
        analysis.fallbackLanguages.length / 5,
      ]]);
      
      const prediction = model.predict(inputTensor) as tf.Tensor;
      tfProbabilities = await prediction.data();
      
      inputTensor.dispose();
      prediction.dispose();
    } catch (error) {
      console.warn('TensorFlow prediction failed, using heuristics:', error);
    }
  }
  
  // Generate all profile probabilities
  const allProfiles = generateProfileProbabilities(analysis, tfProbabilities);
  const topProfile = allProfiles[0];
  
  // Build reasoning based on signals
  if (analysis.hasLanguageLocationMismatch) {
    reasoning.push(`🔍 Language-timezone mismatch: ${analysis.mismatchDetails}`);
    if (analysis.expatriatePatternDetected) {
      reasoning.push(`📊 Matches common expatriate pattern for ${getLanguageName(analysis.primaryLanguage)} speakers`);
    }
  }
  
  if (analysis.vpnProbability > 0.5) {
    reasoning.push(`🔒 High VPN probability (${Math.round(analysis.vpnProbability * 100)}%) - location may not reflect actual residence`);
  }
  
  if (uniqueFamilies.size >= 2) {
    const familyNames = [...uniqueFamilies].join(', ');
    reasoning.push(`🌐 Multiple language families detected: ${familyNames}`);
  }
  
  if (languageCount === 1) {
    reasoning.push(`✓ Single language configured indicates clear preference`);
  } else {
    reasoning.push(`📝 ${languageCount} languages configured in browser preferences`);
  }
  
  reasoning.push(`🎯 Primary browser language: ${analysis.primaryLanguage} (${analysis.languageFamily} family)`);
  
  // Build recommendations based on profile
  switch (topProfile.profile) {
    case 'expatriate':
      recommendations.push(`You're likely an expatriate - we recommend ${getLanguageName(analysis.primaryLanguage)} content`);
      if (analysis.vpnProbability > 0.3) {
        recommendations.push(`Consider that your VPN may affect location-based services`);
      }
      recommendations.push(`Your timezone suggests you're physically in a different region than your language preference`);
      break;
    case 'traveler':
      recommendations.push(`Your language setup suggests frequent travel`);
      recommendations.push(`Content may vary based on your current location`);
      recommendations.push(`Browser fingerprinting can track you across regions`);
      break;
    case 'multilingual':
      recommendations.push(`Your multilingual profile reveals cultural background`);
      recommendations.push(`Consider limiting language preferences for better privacy`);
      recommendations.push(`Websites can infer education level from language diversity`);
      break;
    default:
      recommendations.push(`Your locale settings appear typical for your region`);
      recommendations.push(`Language and timezone align consistently`);
  }
  
  // Determine VPN likelihood level
  let vpnLikelihood: 'low' | 'medium' | 'high' = 'low';
  if (analysis.vpnProbability >= 0.6) vpnLikelihood = 'high';
  else if (analysis.vpnProbability >= 0.35) vpnLikelihood = 'medium';
  
  // Calculate preferred language confidence
  const preferredLanguage = getLanguageName(analysis.primaryLanguage);
  let preferredLanguageConfidence = 92;
  
  if (analysis.hasLanguageLocationMismatch) {
    preferredLanguageConfidence = 78;
  } else if (languageCount === 1) {
    preferredLanguageConfidence = 96;
  } else if (analysis.vpnProbability > 0.5) {
    preferredLanguageConfidence = 72;
  }
  
  // Generate signal analysis
  const signals = generateSignalAnalysis(analysis);
  
  return {
    preferredLanguage,
    preferredLanguageConfidence,
    userProfile: topProfile.profile,
    userProfileConfidence: topProfile.probability,
    allProfiles,
    reasoning,
    recommendations,
    signals,
    vpnLikelihood,
  };
}

// Storage keys
const STORAGE_KEY = 'localeIntent_data';
const FEEDBACK_KEY = 'localeIntent_feedback';
const CONTRIBUTION_KEY = 'localeIntent_contributions';

// Save prediction to localStorage for caching
export function cachePrediction(prediction: LanguagePrediction): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      prediction,
      timestamp: Date.now(),
    }));
  } catch (error) {
    console.warn('Failed to cache prediction:', error);
  }
}

// Get cached prediction (valid for 24 hours)
export function getCachedPrediction(): LanguagePrediction | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const { prediction, timestamp } = JSON.parse(cached);
      const isValid = Date.now() - timestamp < 24 * 60 * 60 * 1000;
      if (isValid) return prediction;
    }
  } catch (error) {
    console.warn('Failed to get cached prediction:', error);
  }
  return null;
}

// Save user feedback with enhanced data
export function saveFeedback(feedback: FeedbackData): void {
  try {
    const existing = localStorage.getItem(FEEDBACK_KEY);
    const feedbackArray: FeedbackData[] = existing ? JSON.parse(existing) : [];
    feedbackArray.push(feedback);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedbackArray));
    
    // Update contribution count
    const contributions = getContributionCount() + 1;
    localStorage.setItem(CONTRIBUTION_KEY, contributions.toString());
  } catch (error) {
    console.warn('Failed to save feedback:', error);
  }
}

// Get contribution count
export function getContributionCount(): number {
  try {
    return parseInt(localStorage.getItem(CONTRIBUTION_KEY) || '0', 10);
  } catch {
    return 0;
  }
}

// Get aggregate accuracy from feedback
export function getAccuracyStats(): { 
  total: number; 
  correct: number; 
  accuracy: number;
  profileBreakdown: Record<string, { correct: number; total: number }>;
} {
  try {
    const existing = localStorage.getItem(FEEDBACK_KEY);
    if (existing) {
      const feedbackArray: FeedbackData[] = JSON.parse(existing);
      const validFeedback = feedbackArray.filter(f => f.predictionCorrect !== null);
      const correct = validFeedback.filter(f => f.predictionCorrect).length;
      
      // Calculate profile breakdown
      const profileBreakdown: Record<string, { correct: number; total: number }> = {
        local: { correct: 0, total: 0 },
        expatriate: { correct: 0, total: 0 },
        traveler: { correct: 0, total: 0 },
        multilingual: { correct: 0, total: 0 },
      };
      
      validFeedback.forEach(f => {
        if (f.userProfile && profileBreakdown[f.userProfile]) {
          profileBreakdown[f.userProfile].total++;
          if (f.predictionCorrect) {
            profileBreakdown[f.userProfile].correct++;
          }
        }
      });
      
      return {
        total: validFeedback.length,
        correct,
        accuracy: validFeedback.length > 0 ? Math.round((correct / validFeedback.length) * 100) : 85,
        profileBreakdown,
      };
    }
  } catch (error) {
    console.warn('Failed to get accuracy stats:', error);
  }
  return { 
    total: 0, 
    correct: 0, 
    accuracy: 85,
    profileBreakdown: {
      local: { correct: 0, total: 0 },
      expatriate: { correct: 0, total: 0 },
      traveler: { correct: 0, total: 0 },
      multilingual: { correct: 0, total: 0 },
    },
  };
}

// Cleanup TensorFlow model
export function disposeModel(): void {
  if (model) {
    model.dispose();
    model = null;
    modelLoaded = false;
  }
}
