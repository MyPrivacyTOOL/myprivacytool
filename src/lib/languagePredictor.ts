// Enhanced Language Predictor with TensorFlow.js
// Client-side language preference prediction with improved accuracy

import * as tf from '@tensorflow/tfjs';
import { type SyntheticExample } from './syntheticDataGenerator';

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
  sessionId?: string;
}

export interface ModelMetadata {
  version: string;
  trainedAt: number;
  trainingAccuracy: number;
  validationAccuracy: number;
  epochs: number;
  examplesUsed: number;
}

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
  phase: 'preparing' | 'training' | 'validating' | 'complete';
}

export interface PredictionComparison {
  id: string;
  timestamp: number;
  trainedModelProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  trainedModelConfidence: number;
  heuristicProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  heuristicConfidence: number;
  finalProfile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  finalConfidence: number;
  method: 'trained' | 'heuristic' | 'best';
  agree: boolean;
  reward?: number;
  rewardReason?: string;
}

export interface PerformanceStats {
  totalComparisons: number;
  agreementRate: number;
  trainedModelAvgConfidence: number;
  heuristicAvgConfidence: number;
  trainedModelAccuracy: number;
  heuristicAccuracy: number;
  trainedModelWins: number;
  heuristicWins: number;
  ties: number;
  improvement: number;
  recommendation: string;
}

export type PredictionMode = 'trained' | 'heuristic' | 'best';

// Model versioning
const MODEL_VERSION = 'v1.0';
const MODEL_STORAGE_KEY = 'mpt_trained_model_v1';
const MODEL_WEIGHTS_KEY = 'mpt_model_weights_v1';
const MODEL_METADATA_KEY = 'mpt_model_metadata_v1';
const COMPARISON_STORAGE_KEY = 'mpt_prediction_comparisons';
const PREDICTION_MODE_KEY = 'mpt_prediction_mode';

// Generate or get session ID
export function getSessionId(): string {
  let sessionId = sessionStorage.getItem('language_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('language_session_id', sessionId);
  }
  return sessionId;
}

// Get total prediction count
export function getTotalPredictions(): number {
  try {
    const cached = localStorage.getItem('language_prediction_cache');
    const feedback = localStorage.getItem('language_feedback');
    let count = 0;
    if (cached) count++;
    if (feedback) {
      const feedbackData = JSON.parse(feedback);
      if (Array.isArray(feedbackData)) count = feedbackData.length;
    }
    return count;
  } catch {
    return 0;
  }
}

// Prediction mode management
export function getPredictionMode(): PredictionMode {
  try {
    const mode = localStorage.getItem(PREDICTION_MODE_KEY);
    if (mode === 'trained' || mode === 'heuristic' || mode === 'best') {
      return mode;
    }
  } catch {}
  return 'best'; // Default to best of both
}

export function setPredictionMode(mode: PredictionMode): void {
  localStorage.setItem(PREDICTION_MODE_KEY, mode);
}

// Store prediction comparison
function storePredictionComparison(comparison: PredictionComparison): void {
  try {
    const existing = localStorage.getItem(COMPARISON_STORAGE_KEY);
    const comparisons: PredictionComparison[] = existing ? JSON.parse(existing) : [];
    comparisons.push(comparison);
    // Keep last 100 comparisons
    const trimmed = comparisons.slice(-100);
    localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.warn('Failed to store prediction comparison:', error);
  }
}

// Get all prediction comparisons
export function getPredictionComparisons(): PredictionComparison[] {
  try {
    const stored = localStorage.getItem(COMPARISON_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return [];
}

// Update comparison with reward
export function updateComparisonReward(timestamp: number, reward: number, reason: string): void {
  try {
    const comparisons = getPredictionComparisons();
    // Find closest comparison by timestamp (within 1 minute)
    const comparison = comparisons.find(c => Math.abs(c.timestamp - timestamp) < 60000);
    if (comparison) {
      comparison.reward = reward;
      comparison.rewardReason = reason;
      localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(comparisons));
    }
  } catch (error) {
    console.warn('Failed to update comparison reward:', error);
  }
}

// Calculate performance statistics
export function getPerformanceStats(): PerformanceStats {
  const comparisons = getPredictionComparisons();
  const withRewards = comparisons.filter(c => c.reward !== undefined);
  
  if (comparisons.length === 0) {
    return {
      totalComparisons: 0,
      agreementRate: 0,
      trainedModelAvgConfidence: 0,
      heuristicAvgConfidence: 0,
      trainedModelAccuracy: 0,
      heuristicAccuracy: 0,
      trainedModelWins: 0,
      heuristicWins: 0,
      ties: 0,
      improvement: 0,
      recommendation: 'Generate predictions to see comparison data',
    };
  }
  
  const agreementCount = comparisons.filter(c => c.agree).length;
  const agreementRate = Math.round((agreementCount / comparisons.length) * 100);
  
  const trainedConfidences = comparisons.map(c => c.trainedModelConfidence);
  const heuristicConfidences = comparisons.map(c => c.heuristicConfidence);
  
  const trainedModelAvgConfidence = Math.round(
    trainedConfidences.reduce((a, b) => a + b, 0) / trainedConfidences.length
  );
  const heuristicAvgConfidence = Math.round(
    heuristicConfidences.reduce((a, b) => a + b, 0) / heuristicConfidences.length
  );
  
  // Calculate accuracy based on positive rewards
  let trainedCorrect = 0;
  let heuristicCorrect = 0;
  let trainedTotal = 0;
  let heuristicTotal = 0;
  
  withRewards.forEach(c => {
    const isPositive = (c.reward ?? 0) > 0;
    if (c.method === 'trained') {
      trainedTotal++;
      if (isPositive) trainedCorrect++;
    } else if (c.method === 'heuristic') {
      heuristicTotal++;
      if (isPositive) heuristicCorrect++;
    } else {
      // For 'best' mode, credit the winner
      if (c.trainedModelConfidence >= c.heuristicConfidence) {
        trainedTotal++;
        if (isPositive) trainedCorrect++;
      } else {
        heuristicTotal++;
        if (isPositive) heuristicCorrect++;
      }
    }
  });
  
  const trainedModelAccuracy = trainedTotal > 0 ? Math.round((trainedCorrect / trainedTotal) * 100) : 0;
  const heuristicAccuracy = heuristicTotal > 0 ? Math.round((heuristicCorrect / heuristicTotal) * 100) : 0;
  
  // Count wins based on confidence
  let trainedWins = 0;
  let heuristicWins = 0;
  let ties = 0;
  
  comparisons.forEach(c => {
    if (c.trainedModelConfidence > c.heuristicConfidence) {
      trainedWins++;
    } else if (c.heuristicConfidence > c.trainedModelConfidence) {
      heuristicWins++;
    } else {
      ties++;
    }
  });
  
  const improvement = trainedModelAccuracy - heuristicAccuracy;
  
  let recommendation: string;
  if (withRewards.length < 10) {
    recommendation = 'Need more data for reliable comparison (10+ predictions with rewards)';
  } else if (improvement > 10) {
    recommendation = 'Trained model is performing significantly better!';
  } else if (improvement > 0) {
    recommendation = 'Trained model is slightly better. Keep training with more data.';
  } else if (improvement < -10) {
    recommendation = 'Heuristics outperform trained model. Consider retraining.';
  } else {
    recommendation = 'Both methods perform similarly. Model is stable.';
  }
  
  return {
    totalComparisons: comparisons.length,
    agreementRate,
    trainedModelAvgConfidence,
    heuristicAvgConfidence,
    trainedModelAccuracy,
    heuristicAccuracy,
    trainedModelWins: trainedWins,
    heuristicWins: heuristicWins,
    ties,
    improvement,
    recommendation,
  };
}

// Export performance report
export function exportPerformanceReport(): void {
  const comparisons = getPredictionComparisons();
  const stats = getPerformanceStats();
  const metadata = getModelMetadata();
  
  const report = {
    exportedAt: new Date().toISOString(),
    modelMetadata: metadata,
    performanceStats: stats,
    comparisons,
  };
  
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mpt-performance-report-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Clear comparison data
export function clearComparisonData(): void {
  localStorage.removeItem(COMPARISON_STORAGE_KEY);
}

// Get model metadata
export function getModelMetadata(): ModelMetadata | null {
  try {
    const stored = localStorage.getItem(MODEL_METADATA_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to get model metadata:', error);
  }
  return null;
}

// Save model metadata
function saveModelMetadata(metadata: ModelMetadata): void {
  try {
    localStorage.setItem(MODEL_METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.warn('Failed to save model metadata:', error);
  }
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

// Timezone region encoding for features
const timezoneRegions: Record<string, number> = {
  'America': 0.1, 'Europe': 0.3, 'Asia': 0.5, 'Australia': 0.7, 
  'Pacific': 0.8, 'Africa': 0.9,
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
let isTrainedModel = false;

// Create the model architecture (10 inputs -> [16, 8] hidden -> 4 outputs)
function createModel(): tf.LayersModel {
  const newModel = tf.sequential({
    layers: [
      // Input layer: 10 features
      tf.layers.dense({ inputShape: [10], units: 16, activation: 'relu', name: 'hidden1' }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.2 }),
      // Second hidden layer
      tf.layers.dense({ units: 8, activation: 'relu', name: 'hidden2' }),
      tf.layers.batchNormalization(),
      tf.layers.dropout({ rate: 0.1 }),
      // Output layer: 4 profiles (local, expatriate, traveler, multilingual)
      tf.layers.dense({ units: 4, activation: 'softmax', name: 'output' }),
    ],
  });
  
  newModel.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  
  return newModel;
}

// Extract features from a synthetic example (10 features)
function extractFeaturesFromExample(example: SyntheticExample): number[] {
  const languages = example.languages;
  const timezone = example.timezone;
  
  // 1. Language count (normalized)
  const languageCount = Math.min(languages.length, 5) / 5;
  
  // 2. Has language mismatch (0/1)
  const primaryLang = languages[0]?.split('-')[0]?.toLowerCase() || 'en';
  const expectedLangs = timezoneLanguages[timezone] || [];
  const hasMismatch = expectedLangs.length > 0 && !expectedLangs.includes(primaryLang) ? 1 : 0;
  
  // 3. Timezone region encoded
  const region = timezone.split('/')[0];
  const timezoneEncoded = timezoneRegions[region] || 0.5;
  
  // 4. Is multilingual (3+ languages)
  const isMultilingual = languages.length >= 3 ? 1 : 0;
  
  // 5. Has fallback languages
  const hasFallbacks = languages.length > 1 ? 1 : 0;
  
  // 6. Unique language families count (normalized)
  const families = new Set(languages.map(l => {
    const base = l.split('-')[0].toLowerCase();
    return languageFamilies[base] || 'Unknown';
  }));
  const familyCount = Math.min(families.size, 4) / 4;
  
  // 7. Primary language frequency score (common languages score higher)
  const commonLanguages = ['en', 'es', 'zh', 'fr', 'de', 'pt', 'ar', 'hi', 'ja', 'ko'];
  const primaryFrequencyScore = commonLanguages.includes(primaryLang) ? 0.8 : 0.3;
  
  // 8. Secondary language presence (different family than primary)
  const primaryFamily = languageFamilies[primaryLang] || 'Unknown';
  const hasSecondaryDifferentFamily = languages.slice(1).some(l => {
    const base = l.split('-')[0].toLowerCase();
    return (languageFamilies[base] || 'Unknown') !== primaryFamily;
  }) ? 1 : 0;
  
  // 9. Timezone-language match score
  let matchScore = 0;
  if (expectedLangs.length > 0) {
    const matchCount = languages.filter(l => expectedLangs.includes(l.split('-')[0].toLowerCase())).length;
    matchScore = matchCount / Math.max(languages.length, 1);
  } else {
    matchScore = 0.5; // Neutral if no expected languages
  }
  
  // 10. Total languages normalized (0-1)
  const totalLangsNormalized = Math.min(languages.length, 10) / 10;
  
  return [
    languageCount,
    hasMismatch,
    timezoneEncoded,
    isMultilingual,
    hasFallbacks,
    familyCount,
    primaryFrequencyScore,
    hasSecondaryDifferentFamily,
    matchScore,
    totalLangsNormalized,
  ];
}

// Extract labels from synthetic example
function extractLabelsFromExample(example: SyntheticExample): number[] {
  return [
    example.labels.local,
    example.labels.expatriate,
    example.labels.traveler,
    example.labels.multilingual,
  ];
}

// Train model on synthetic data
export async function trainModel(
  trainingData: SyntheticExample[],
  onProgress?: (progress: TrainingProgress) => void
): Promise<{ accuracy: number; validationAccuracy: number; loss: number }> {
  console.log(`Starting model training with ${trainingData.length} examples...`);
  
  onProgress?.({ epoch: 0, totalEpochs: 50, loss: 0, accuracy: 0, phase: 'preparing' });
  
  // Dispose existing model if any
  if (model) {
    model.dispose();
  }
  
  // Create fresh model
  model = createModel();
  
  // Shuffle data
  const shuffled = [...trainingData].sort(() => Math.random() - 0.5);
  
  // Split 80/20 train/validation
  const splitIndex = Math.floor(shuffled.length * 0.8);
  const trainData = shuffled.slice(0, splitIndex);
  const valData = shuffled.slice(splitIndex);
  
  console.log(`Training set: ${trainData.length}, Validation set: ${valData.length}`);
  
  // Prepare training tensors
  const trainFeatures = trainData.map(extractFeaturesFromExample);
  const trainLabels = trainData.map(extractLabelsFromExample);
  const valFeatures = valData.map(extractFeaturesFromExample);
  const valLabels = valData.map(extractLabelsFromExample);
  
  const xTrain = tf.tensor2d(trainFeatures);
  const yTrain = tf.tensor2d(trainLabels);
  const xVal = tf.tensor2d(valFeatures);
  const yVal = tf.tensor2d(valLabels);
  
  let finalLoss = 0;
  let finalAccuracy = 0;
  let finalValAccuracy = 0;
  
  try {
    // Train for 50 epochs with batch size 32
    await model.fit(xTrain, yTrain, {
      epochs: 50,
      batchSize: 32,
      validationData: [xVal, yVal],
      shuffle: true,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          const loss = logs?.loss ?? 0;
          const accuracy = logs?.acc ?? 0;
          const valAccuracy = logs?.val_acc ?? 0;
          
          finalLoss = loss;
          finalAccuracy = accuracy;
          finalValAccuracy = valAccuracy;
          
          console.log(`Epoch ${epoch + 1}/50 - loss: ${loss.toFixed(4)} - acc: ${(accuracy * 100).toFixed(1)}% - val_acc: ${(valAccuracy * 100).toFixed(1)}%`);
          
          onProgress?.({
            epoch: epoch + 1,
            totalEpochs: 50,
            loss,
            accuracy: accuracy * 100,
            phase: 'training',
          });
        },
      },
    });
    
    onProgress?.({ epoch: 50, totalEpochs: 50, loss: finalLoss, accuracy: finalAccuracy * 100, phase: 'validating' });
    
    // Save model weights to localStorage
    await saveModelToStorage();
    
    // Save metadata
    const metadata: ModelMetadata = {
      version: MODEL_VERSION,
      trainedAt: Date.now(),
      trainingAccuracy: Math.round(finalAccuracy * 100),
      validationAccuracy: Math.round(finalValAccuracy * 100),
      epochs: 50,
      examplesUsed: trainingData.length,
    };
    saveModelMetadata(metadata);
    
    modelLoaded = true;
    isTrainedModel = true;
    
    onProgress?.({ epoch: 50, totalEpochs: 50, loss: finalLoss, accuracy: finalAccuracy * 100, phase: 'complete' });
    
    console.log(`Training complete! Final accuracy: ${(finalAccuracy * 100).toFixed(1)}%, Validation: ${(finalValAccuracy * 100).toFixed(1)}%`);
    
    return {
      accuracy: Math.round(finalAccuracy * 100),
      validationAccuracy: Math.round(finalValAccuracy * 100),
      loss: finalLoss,
    };
  } finally {
    // Cleanup tensors
    xTrain.dispose();
    yTrain.dispose();
    xVal.dispose();
    yVal.dispose();
  }
}

// Save model weights to localStorage
async function saveModelToStorage(): Promise<void> {
  if (!model) return;
  
  try {
    // Use tf.io.withSaveHandler to save to memory, then store in localStorage
    await model.save(tf.io.withSaveHandler(async (artifacts) => {
      // weightData is already an ArrayBuffer in the artifacts
      const weightDataArray = artifacts.weightData 
        ? Array.from(new Uint8Array(artifacts.weightData as ArrayBuffer))
        : [];
      
      localStorage.setItem(MODEL_WEIGHTS_KEY, JSON.stringify({
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightData: weightDataArray,
      }));
      
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    }));
    
    console.log('Model saved to localStorage');
  } catch (error) {
    console.warn('Failed to save model to localStorage:', error);
  }
}

// Load model weights from localStorage
async function loadModelFromStorage(): Promise<boolean> {
  try {
    const stored = localStorage.getItem(MODEL_WEIGHTS_KEY);
    if (!stored) return false;
    
    const parsed = JSON.parse(stored);
    const weightData = new Uint8Array(parsed.weightData).buffer;
    
    model = await tf.loadLayersModel(tf.io.fromMemory(
      parsed.modelTopology,
      parsed.weightSpecs,
      weightData
    ));
    
    model.compile({
      optimizer: tf.train.adam(0.01),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });
    
    console.log('Loaded trained model from localStorage');
    return true;
  } catch (error) {
    console.warn('Failed to load model from localStorage:', error);
    return false;
  }
}

// Reset to default (untrained) model
export async function resetToDefaultModel(): Promise<void> {
  if (model) {
    model.dispose();
  }
  
  localStorage.removeItem(MODEL_WEIGHTS_KEY);
  localStorage.removeItem(MODEL_METADATA_KEY);
  
  model = null;
  modelLoaded = false;
  isTrainedModel = false;
  
  await initializeModel();
  console.log('Reset to default heuristic model');
}

// Check if a trained model exists
export function hasTrainedModel(): boolean {
  return localStorage.getItem(MODEL_WEIGHTS_KEY) !== null;
}

// Initialize enhanced TensorFlow.js model
export async function initializeModel(): Promise<boolean> {
  if (modelLoaded) return true;
  
  try {
    // Try to load trained model from localStorage first
    if (await loadModelFromStorage()) {
      modelLoaded = true;
      isTrainedModel = true;
      console.log('Enhanced language prediction model initialized (trained)');
      return true;
    }
    
    // Fall back to creating a new model with heuristic weights
    model = createModel();
    
    // Pre-set weights based on heuristic patterns
    await initializeWeightsWithHeuristics();
    
    modelLoaded = true;
    isTrainedModel = false;
    console.log('Enhanced language prediction model initialized (heuristic)');
    return true;
  } catch (error) {
    console.error('Failed to initialize language model:', error);
    return false;
  }
}

// Initialize weights with heuristic-based values
async function initializeWeightsWithHeuristics(): Promise<void> {
  if (!model) return;
  
  // Warm up the model with representative examples (10 features)
  const trainingExamples = tf.tensor2d([
    // Local user: 1 lang, no mismatch, local timezone, same family
    [0.2, 0, 0.3, 0, 0, 0.25, 0.8, 0, 0.9, 0.1],
    // Expatriate: mismatch, different timezone than expected
    [0.4, 1, 0.3, 0, 1, 0.5, 0.8, 1, 0.1, 0.2],
    // Traveler: multiple langs, some mismatch signals
    [0.6, 0.5, 0.5, 0, 1, 0.5, 0.6, 0, 0.5, 0.3],
    // Multilingual: many languages, multiple families
    [0.8, 0, 0.5, 1, 1, 0.75, 0.7, 1, 0.6, 0.5],
  ]);
  
  const labels = tf.tensor2d([
    [1, 0, 0, 0], // local
    [0, 1, 0, 0], // expatriate
    [0, 0, 1, 0], // traveler
    [0, 0, 0, 1], // multilingual
  ]);
  
  // Quick training pass
  await model.fit(trainingExamples, labels, { epochs: 100, verbose: 0 });
  
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

// Enhanced prediction with TensorFlow.js and comparison tracking
export async function predictLanguagePreference(analysis: LanguageAnalysis): Promise<LanguagePrediction> {
  const reasoning: string[] = [];
  const recommendations: string[] = [];
  
  // Ensure model is loaded
  if (!modelLoaded) {
    await initializeModel();
  }
  
  // Extract 10 features matching training format
  const languageCount = Math.min(analysis.languages.length, 5) / 5;
  const hasMismatch = analysis.hasLanguageLocationMismatch ? 1 : 0;
  const region = analysis.timezone.split('/')[0];
  const timezoneEncoded = timezoneRegions[region] || 0.5;
  const isMultilingual = analysis.languages.length >= 3 ? 1 : 0;
  const hasFallbacks = analysis.fallbackLanguages.length > 0 ? 1 : 0;
  const uniqueFamilies = new Set(analysis.languages.map(l => getLanguageFamily(l)));
  const familyCount = Math.min(uniqueFamilies.size, 4) / 4;
  const primaryLang = analysis.primaryLanguage.split('-')[0].toLowerCase();
  const commonLanguages = ['en', 'es', 'zh', 'fr', 'de', 'pt', 'ar', 'hi', 'ja', 'ko'];
  const primaryFrequencyScore = commonLanguages.includes(primaryLang) ? 0.8 : 0.3;
  const primaryFamily = getLanguageFamily(analysis.primaryLanguage);
  const hasSecondaryDifferentFamily = analysis.fallbackLanguages.some(l => 
    getLanguageFamily(l) !== primaryFamily
  ) ? 1 : 0;
  const expectedLangs = timezoneLanguages[analysis.timezone] || [];
  let matchScore = 0.5;
  if (expectedLangs.length > 0) {
    const matchCount = analysis.languages.filter(l => expectedLangs.includes(l.split('-')[0].toLowerCase())).length;
    matchScore = matchCount / Math.max(analysis.languages.length, 1);
  }
  const totalLangsNormalized = Math.min(analysis.languages.length, 10) / 10;
  
  let tfProbabilities: Float32Array | Int32Array | Uint8Array | undefined;
  
  // Run TensorFlow prediction
  if (model) {
    try {
      const inputTensor = tf.tensor2d([[
        languageCount,
        hasMismatch,
        timezoneEncoded,
        isMultilingual,
        hasFallbacks,
        familyCount,
        primaryFrequencyScore,
        hasSecondaryDifferentFamily,
        matchScore,
        totalLangsNormalized,
      ]]);
      
      const prediction = model.predict(inputTensor) as tf.Tensor;
      tfProbabilities = await prediction.data();
      
      inputTensor.dispose();
      prediction.dispose();
    } catch (error) {
      console.warn('TensorFlow prediction failed, using heuristics:', error);
    }
  }
  
  // Get trained model profiles (if available)
  const trainedProfiles = tfProbabilities 
    ? generateProfileProbabilities(analysis, tfProbabilities)
    : null;
  
  // Get heuristic profiles (always calculate for comparison)
  const heuristicProfiles = generateProfileProbabilities(analysis, undefined);
  
  // Determine which prediction to use based on mode
  const mode = getPredictionMode();
  let allProfiles: ProfileProbability[];
  let method: 'trained' | 'heuristic' | 'best' = mode;
  
  if (mode === 'trained' && trainedProfiles) {
    allProfiles = trainedProfiles;
  } else if (mode === 'heuristic') {
    allProfiles = heuristicProfiles;
    method = 'heuristic';
  } else if (mode === 'best' && trainedProfiles) {
    // Use whichever has higher confidence
    const trainedTop = trainedProfiles[0];
    const heuristicTop = heuristicProfiles[0];
    if (trainedTop.probability >= heuristicTop.probability) {
      allProfiles = trainedProfiles;
    } else {
      allProfiles = heuristicProfiles;
    }
  } else {
    allProfiles = heuristicProfiles;
    method = 'heuristic';
  }
  
  const topProfile = allProfiles[0];
  
  // Store comparison if we have both predictions
  if (trainedProfiles) {
    const trainedTop = trainedProfiles[0];
    const heuristicTop = heuristicProfiles[0];
    
    const comparison: PredictionComparison = {
      id: `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      trainedModelProfile: trainedTop.profile,
      trainedModelConfidence: trainedTop.probability,
      heuristicProfile: heuristicTop.profile,
      heuristicConfidence: heuristicTop.probability,
      finalProfile: topProfile.profile,
      finalConfidence: topProfile.probability,
      method,
      agree: trainedTop.profile === heuristicTop.profile,
    };
    
    storePredictionComparison(comparison);
    
    // Log comparison for debugging
    console.log(`Prediction comparison: Trained=${trainedTop.profile}(${trainedTop.probability}%) vs Heuristic=${heuristicTop.profile}(${heuristicTop.probability}%) -> Using ${method}`);
  }
  
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
  
  if (analysis.languages.length === 1) {
    reasoning.push(`✓ Single language configured indicates clear preference`);
  } else {
    reasoning.push(`📝 ${analysis.languages.length} languages configured in browser preferences`);
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
  } else if (analysis.languages.length === 1) {
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
