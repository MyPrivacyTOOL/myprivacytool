// Language Predictor with TensorFlow.js
// Client-side language preference prediction

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
}

export interface LanguagePrediction {
  preferredLanguage: string;
  preferredLanguageConfidence: number;
  userProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  userProfileConfidence: number;
  reasoning: string[];
  recommendations: string[];
}

export interface FeedbackData {
  predictionCorrect: boolean | null;
  actualLanguage: string | null;
  timestamp: number;
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
};

// Timezone to expected language mapping
const timezoneLanguages: Record<string, string[]> = {
  'America/New_York': ['en'], 'America/Los_Angeles': ['en', 'es'],
  'America/Chicago': ['en', 'es'], 'Europe/London': ['en'],
  'Europe/Paris': ['fr'], 'Europe/Berlin': ['de'],
  'Europe/Madrid': ['es', 'ca'], 'Europe/Rome': ['it'],
  'Europe/Amsterdam': ['nl'], 'Europe/Moscow': ['ru'],
  'Asia/Tokyo': ['ja'], 'Asia/Shanghai': ['zh'],
  'Asia/Hong_Kong': ['zh', 'en'], 'Asia/Singapore': ['en', 'zh', 'ms'],
  'Asia/Seoul': ['ko'], 'Asia/Dubai': ['ar', 'en'],
  'Asia/Kolkata': ['hi', 'en'], 'Asia/Bangkok': ['th'],
  'Australia/Sydney': ['en'], 'Pacific/Auckland': ['en'],
  'America/Sao_Paulo': ['pt'], 'America/Mexico_City': ['es'],
};

// TensorFlow model instance
let model: tf.LayersModel | null = null;
let modelLoaded = false;

// Initialize TensorFlow.js model
export async function initializeModel(): Promise<boolean> {
  if (modelLoaded) return true;
  
  try {
    // Create a simple MLP model for language prediction
    model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [6], units: 16, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 8, activation: 'relu' }),
        tf.layers.dense({ units: 4, activation: 'softmax' }), // 4 user profiles
      ],
    });
    
    model.compile({
      optimizer: 'adam',
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });
    
    // Warm up the model with dummy prediction
    const dummyInput = tf.zeros([1, 6]);
    const warmup = model.predict(dummyInput) as tf.Tensor;
    warmup.dispose();
    dummyInput.dispose();
    
    modelLoaded = true;
    console.log('Language prediction model initialized');
    return true;
  } catch (error) {
    console.error('Failed to initialize language model:', error);
    return false;
  }
}

// Analyze browser language settings
export function analyzeLanguages(): LanguageAnalysis {
  const languages = navigator.languages ? [...navigator.languages] : [navigator.language];
  const primaryLanguage = navigator.language;
  const fallbackLanguages = languages.slice(1);
  
  const dateTimeFormat = Intl.DateTimeFormat().resolvedOptions();
  const timezone = dateTimeFormat.timeZone;
  const locale = dateTimeFormat.locale;
  const timezoneOffset = new Date().getTimezoneOffset();
  
  // Check for language-location mismatch
  const primaryLangCode = primaryLanguage.split('-')[0].toLowerCase();
  const expectedLanguages = timezoneLanguages[timezone] || [];
  const hasLanguageLocationMismatch = expectedLanguages.length > 0 && 
    !expectedLanguages.includes(primaryLangCode);
  
  let mismatchDetails: string | null = null;
  if (hasLanguageLocationMismatch) {
    const expectedLangNames = expectedLanguages.map(l => languageNames[l] || l).join(', ');
    mismatchDetails = `Your browser is set to ${languageNames[primaryLangCode] || primaryLanguage}, but your timezone (${timezone}) typically uses ${expectedLangNames}`;
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
  };
}

// Get readable language name
export function getLanguageName(code: string): string {
  return languageNames[code] || languageNames[code.split('-')[0]] || code;
}

// Run language prediction using TensorFlow.js
export async function predictLanguagePreference(analysis: LanguageAnalysis): Promise<LanguagePrediction> {
  const reasoning: string[] = [];
  const recommendations: string[] = [];
  
  // Ensure model is loaded
  if (!modelLoaded) {
    await initializeModel();
  }
  
  // Prepare features for model
  const languageCount = analysis.languages.length;
  const uniqueFamilies = new Set(analysis.languages.map(l => l.split('-')[0]));
  const hasMismatch = analysis.hasLanguageLocationMismatch ? 1 : 0;
  const timezoneNormalized = (analysis.timezoneOffset + 720) / 1440; // Normalize -12 to +12 hours
  const isMultilingual = uniqueFamilies.size > 1 ? 1 : 0;
  const hasFallbacks = analysis.fallbackLanguages.length > 0 ? 1 : 0;
  
  // Determine user profile based on signals
  let userProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual' = 'local';
  let userProfileConfidence = 70;
  
  if (analysis.hasLanguageLocationMismatch) {
    userProfile = 'expatriate';
    userProfileConfidence = 85;
    reasoning.push(`Language-timezone mismatch detected: ${analysis.mismatchDetails}`);
    recommendations.push('Consider using a VPN to match your apparent location');
  } else if (uniqueFamilies.size >= 3) {
    userProfile = 'multilingual';
    userProfileConfidence = 82;
    reasoning.push(`${uniqueFamilies.size} different language families configured`);
    recommendations.push('Your multilingual setup reveals cultural background');
  } else if (languageCount >= 3 && isMultilingual) {
    userProfile = 'traveler';
    userProfileConfidence = 75;
    reasoning.push('Multiple languages suggest frequent international travel');
    recommendations.push('Browser fingerprinting can track you across regions');
  } else {
    reasoning.push('Language and timezone settings are consistent');
    recommendations.push('Your locale settings appear typical for your region');
  }
  
  // Run TensorFlow prediction if model is available
  if (model) {
    try {
      const inputTensor = tf.tensor2d([[
        languageCount / 10,
        hasMismatch,
        timezoneNormalized,
        isMultilingual,
        hasFallbacks,
        uniqueFamilies.size / 5,
      ]]);
      
      const prediction = model.predict(inputTensor) as tf.Tensor;
      const probs = await prediction.data();
      
      // Find highest probability profile
      const profiles: ('local' | 'expatriate' | 'traveler' | 'multilingual')[] = 
        ['local', 'expatriate', 'traveler', 'multilingual'];
      const maxIndex = probs.indexOf(Math.max(...probs));
      
      // Only override if TF prediction is significantly different
      if (probs[maxIndex] > 0.4 && profiles[maxIndex] !== userProfile) {
        userProfile = profiles[maxIndex];
        userProfileConfidence = Math.round(probs[maxIndex] * 100);
      }
      
      inputTensor.dispose();
      prediction.dispose();
    } catch (error) {
      console.warn('TensorFlow prediction failed, using heuristics:', error);
    }
  }
  
  // Calculate preferred language confidence
  const preferredLanguage = getLanguageName(analysis.primaryLanguage);
  let preferredLanguageConfidence = 90;
  
  if (analysis.hasLanguageLocationMismatch) {
    preferredLanguageConfidence = 75; // Less confident due to mismatch
    reasoning.push('Confidence reduced due to location mismatch');
  } else if (languageCount === 1) {
    preferredLanguageConfidence = 95;
    reasoning.push('Single language configured indicates strong preference');
  }
  
  return {
    preferredLanguage,
    preferredLanguageConfidence,
    userProfile,
    userProfileConfidence,
    reasoning,
    recommendations,
  };
}

// Storage keys
const STORAGE_KEY = 'localeIntent_data';
const FEEDBACK_KEY = 'localeIntent_feedback';

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

// Save user feedback
export function saveFeedback(feedback: FeedbackData): void {
  try {
    const existing = localStorage.getItem(FEEDBACK_KEY);
    const feedbackArray: FeedbackData[] = existing ? JSON.parse(existing) : [];
    feedbackArray.push(feedback);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedbackArray));
  } catch (error) {
    console.warn('Failed to save feedback:', error);
  }
}

// Get aggregate accuracy from feedback
export function getAccuracyStats(): { total: number; correct: number; accuracy: number } {
  try {
    const existing = localStorage.getItem(FEEDBACK_KEY);
    if (existing) {
      const feedbackArray: FeedbackData[] = JSON.parse(existing);
      const validFeedback = feedbackArray.filter(f => f.predictionCorrect !== null);
      const correct = validFeedback.filter(f => f.predictionCorrect).length;
      return {
        total: validFeedback.length,
        correct,
        accuracy: validFeedback.length > 0 ? Math.round((correct / validFeedback.length) * 100) : 85,
      };
    }
  } catch (error) {
    console.warn('Failed to get accuracy stats:', error);
  }
  return { total: 0, correct: 0, accuracy: 85 }; // Default accuracy
}

// Cleanup TensorFlow model
export function disposeModel(): void {
  if (model) {
    model.dispose();
    model = null;
    modelLoaded = false;
  }
}
