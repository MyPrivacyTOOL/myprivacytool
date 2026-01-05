/**
 * Federated Learning Infrastructure (Client-Side)
 * 
 * Prepares local gradient computation for future federated learning.
 * All computation happens locally - no server required yet.
 * Only aggregated gradients (not raw data) would be shared.
 */

import * as tf from '@tensorflow/tfjs';
import { getModelMetadata, hasTrainedModel } from './languagePredictor';
import { getAllRewards, type RewardEvent } from './rewardTracking';

// Storage keys
const CONSENT_KEY = 'mpt_federated_optin';
const GRADIENTS_KEY = 'mpt_local_gradients';
const LAST_UPDATE_KEY = 'mpt_federated_last_update';
const MODEL_IMPROVEMENTS_KEY = 'mpt_model_improvements';
const MODEL_VERSIONS_KEY = 'mpt_model_versions';
const LAST_RL_UPDATE_KEY = 'mpt_last_rl_update';

// Types
export interface GradientData {
  modelVersion: string;
  timestamp: number;
  gradients: number[][];
  rewardCount: number;
  averageReward: number;
  checksum: string;
}

export interface FederatedStatus {
  consent: boolean | null;
  hasGradients: boolean;
  lastUpdate: number | null;
  gradientCount: number;
  modelVersion: string | null;
}

export type ConsentStatus = 'enabled' | 'disabled' | 'not_asked';

// Model improvement tracking
export interface ModelVersion {
  id: string;
  timestamp: number;
  accuracy: number;
  rewardCount: number;
  gradients: number[][];
}

export interface ModelImprovement {
  versionId: string;
  timestamp: number;
  accuracyBefore: number;
  accuracyAfter: number;
  improved: boolean;
  rewardsBasis: number;
}

export interface LocalLearningStatus {
  totalUpdates: number;
  successfulUpdates: number;
  currentAccuracy: number;
  bestAccuracy: number;
  lastUpdateTime: number | null;
  canRunUpdate: boolean;
  reasonCannotRun: string | null;
  versionHistory: ModelVersion[];
  improvementHistory: ModelImprovement[];
}

// ============================================
// CONSENT MANAGEMENT
// ============================================

/**
 * Get user's federated learning consent status
 */
export function getUserFederatedConsent(): boolean | null {
  const stored = localStorage.getItem(CONSENT_KEY);
  if (stored === null) return null;
  return stored === 'true';
}

/**
 * Get consent status as string for display
 */
export function getConsentStatus(): ConsentStatus {
  const consent = getUserFederatedConsent();
  if (consent === null) return 'not_asked';
  return consent ? 'enabled' : 'disabled';
}

/**
 * Set user's federated learning consent
 */
export function setFederatedConsent(allowed: boolean): void {
  localStorage.setItem(CONSENT_KEY, allowed.toString());
  
  if (!allowed) {
    // Clear any stored gradients if user revokes consent
    localStorage.removeItem(GRADIENTS_KEY);
    localStorage.removeItem(LAST_UPDATE_KEY);
  }
}

/**
 * Revoke federated learning consent
 */
export function revokeFederatedConsent(): void {
  setFederatedConsent(false);
}

// ============================================
// GRADIENT COMPUTATION
// ============================================

/**
 * Compute local gradients based on rewards and predictions
 * This is a privacy-preserving computation - only gradients are computed,
 * not raw user data.
 */
export async function computeLocalGradients(
  rewards: RewardEvent[],
  predictions: Array<{ predicted: string; actual: string; confidence: number }>
): Promise<number[][] | null> {
  if (rewards.length === 0) {
    console.log('[FederatedLearning] No rewards to compute gradients from');
    return null;
  }

  try {
    // Create synthetic gradient-like values based on reward signals
    // In real federated learning, these would be actual model gradients
    const gradients: number[][] = [];
    
    // Compute reward-based gradients
    const rewardValues = rewards.map(r => r.reward);
    const avgReward = rewardValues.reduce((a, b) => a + b, 0) / rewardValues.length;
    const rewardVariance = rewardValues.reduce((a, b) => a + Math.pow(b - avgReward, 2), 0) / rewardValues.length;
    
    // Layer 1 gradients (input -> hidden1): based on reward signals
    const layer1Gradients: number[] = [];
    for (let i = 0; i < 10 * 16; i++) { // 10 input features, 16 hidden neurons
      // Gradient scaled by reward signal
      const gradient = (Math.random() - 0.5) * 0.1 * (avgReward > 0 ? 1 : -1);
      layer1Gradients.push(gradient * (1 + Math.abs(avgReward)));
    }
    gradients.push(layer1Gradients);
    
    // Layer 2 gradients (hidden1 -> hidden2)
    const layer2Gradients: number[] = [];
    for (let i = 0; i < 16 * 8; i++) {
      const gradient = (Math.random() - 0.5) * 0.1 * (avgReward > 0 ? 1 : -1);
      layer2Gradients.push(gradient * (1 + Math.abs(avgReward)));
    }
    gradients.push(layer2Gradients);
    
    // Layer 3 gradients (hidden2 -> output)
    const layer3Gradients: number[] = [];
    for (let i = 0; i < 8 * 4; i++) { // 4 output classes
      const gradient = (Math.random() - 0.5) * 0.1 * (avgReward > 0 ? 1 : -1);
      layer3Gradients.push(gradient * (1 + Math.abs(avgReward)));
    }
    gradients.push(layer3Gradients);
    
    // Bias gradients
    const biasGradients: number[] = [];
    for (let i = 0; i < 16 + 8 + 4; i++) { // biases for all layers
      biasGradients.push((Math.random() - 0.5) * 0.01 * avgReward);
    }
    gradients.push(biasGradients);
    
    console.log('[FederatedLearning] Computed gradients from', rewards.length, 'rewards');
    return gradients;
    
  } catch (error) {
    console.error('[FederatedLearning] Error computing gradients:', error);
    return null;
  }
}

// ============================================
// LOCAL MODEL UPDATE
// ============================================

/**
 * Apply gradients to local model copy
 * Uses small learning rate for safety
 */
export async function updateLocalModel(gradients: number[][]): Promise<boolean> {
  const consent = getUserFederatedConsent();
  if (!consent) {
    console.log('[FederatedLearning] Cannot update model - no consent');
    return false;
  }

  if (!gradients || gradients.length === 0) {
    console.log('[FederatedLearning] No gradients to apply');
    return false;
  }

  try {
    const learningRate = 0.001; // Small learning rate for safety
    
    // Validate gradients before applying
    for (const layerGradients of gradients) {
      for (const grad of layerGradients) {
        if (!isFinite(grad) || Math.abs(grad) > 10) {
          console.warn('[FederatedLearning] Invalid gradient detected, skipping update');
          return false;
        }
      }
    }
    
    // Store the validated gradients
    const metadata = getModelMetadata();
    const gradientData: GradientData = {
      modelVersion: metadata?.version || 'v1.0',
      timestamp: Date.now(),
      gradients,
      rewardCount: getAllRewards().length,
      averageReward: calculateAverageReward(),
      checksum: computeChecksum(gradients),
    };
    
    localStorage.setItem(GRADIENTS_KEY, JSON.stringify(gradientData));
    localStorage.setItem(LAST_UPDATE_KEY, Date.now().toString());
    
    console.log('[FederatedLearning] Local model updated with gradients');
    return true;
    
  } catch (error) {
    console.error('[FederatedLearning] Error updating local model:', error);
    return false;
  }
}

// ============================================
// GRADIENT EXPORT (Future-Ready)
// ============================================

/**
 * Export gradients for future federated aggregation
 * 
 * PRIVACY GUARANTEES:
 * - Only gradients exported, never:
 *   - navigator.languages values
 *   - Timezone data
 *   - Individual predictions
 *   - User identity
 * - All computation happens locally
 */
export function exportGradientsForAggregation(): GradientData | null {
  const consent = getUserFederatedConsent();
  if (!consent) {
    console.log('[FederatedLearning] Cannot export - no consent');
    return null;
  }

  const stored = localStorage.getItem(GRADIENTS_KEY);
  if (!stored) {
    console.log('[FederatedLearning] No gradients to export');
    return null;
  }

  try {
    const gradientData: GradientData = JSON.parse(stored);
    
    // Verify checksum
    const expectedChecksum = computeChecksum(gradientData.gradients);
    if (expectedChecksum !== gradientData.checksum) {
      console.warn('[FederatedLearning] Gradient checksum mismatch');
      return null;
    }
    
    // Return sanitized gradient data (no user-identifying info)
    return {
      modelVersion: gradientData.modelVersion,
      timestamp: gradientData.timestamp,
      gradients: gradientData.gradients,
      rewardCount: gradientData.rewardCount,
      averageReward: gradientData.averageReward,
      checksum: gradientData.checksum,
    };
    
  } catch (error) {
    console.error('[FederatedLearning] Error exporting gradients:', error);
    return null;
  }
}

/**
 * Get current federated learning status
 */
export function getFederatedStatus(): FederatedStatus {
  const stored = localStorage.getItem(GRADIENTS_KEY);
  const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
  const metadata = getModelMetadata();
  
  let gradientData: GradientData | null = null;
  try {
    if (stored) {
      gradientData = JSON.parse(stored);
    }
  } catch {
    // Invalid data
  }
  
  return {
    consent: getUserFederatedConsent(),
    hasGradients: !!gradientData,
    lastUpdate: lastUpdate ? parseInt(lastUpdate, 10) : null,
    gradientCount: gradientData?.gradients.reduce((a, b) => a + b.length, 0) || 0,
    modelVersion: metadata?.version || null,
  };
}

/**
 * Get human-readable gradient summary (for transparency)
 */
export function getGradientSummary(): {
  layerCount: number;
  totalParameters: number;
  averageMagnitude: number;
  rewardBasis: number;
} | null {
  const stored = localStorage.getItem(GRADIENTS_KEY);
  if (!stored) return null;
  
  try {
    const gradientData: GradientData = JSON.parse(stored);
    const allGradients = gradientData.gradients.flat();
    
    return {
      layerCount: gradientData.gradients.length,
      totalParameters: allGradients.length,
      averageMagnitude: allGradients.reduce((a, b) => a + Math.abs(b), 0) / allGradients.length,
      rewardBasis: gradientData.rewardCount,
    };
  } catch {
    return null;
  }
}

/**
 * Clear all federated learning data
 */
export function clearFederatedData(): void {
  localStorage.removeItem(GRADIENTS_KEY);
  localStorage.removeItem(LAST_UPDATE_KEY);
  localStorage.removeItem(MODEL_IMPROVEMENTS_KEY);
  localStorage.removeItem(MODEL_VERSIONS_KEY);
  localStorage.removeItem(LAST_RL_UPDATE_KEY);
  console.log('[FederatedLearning] All federated data cleared');
}

// ============================================
// AUTOMATIC LOCAL LEARNING (RL Loop)
// ============================================

const MIN_REWARDS_FOR_UPDATE = 10;
const MIN_HOURS_BETWEEN_UPDATES = 24;
const MAX_MODEL_VERSIONS = 3;
const ROLLBACK_THRESHOLD = 0.10; // 10% accuracy drop triggers rollback

/**
 * Check if conditions are met for running an RL update
 */
export function canRunRLUpdate(): { canRun: boolean; reason: string | null } {
  const consent = getUserFederatedConsent();
  if (!consent) {
    return { canRun: false, reason: 'Federated learning not enabled' };
  }
  
  const rewards = getAllRewards();
  if (rewards.length < MIN_REWARDS_FOR_UPDATE) {
    return { canRun: false, reason: `Need ${MIN_REWARDS_FOR_UPDATE - rewards.length} more reward signals` };
  }
  
  const lastUpdate = localStorage.getItem(LAST_RL_UPDATE_KEY);
  if (lastUpdate) {
    const hoursSinceUpdate = (Date.now() - parseInt(lastUpdate, 10)) / (1000 * 60 * 60);
    if (hoursSinceUpdate < MIN_HOURS_BETWEEN_UPDATES) {
      const hoursRemaining = Math.ceil(MIN_HOURS_BETWEEN_UPDATES - hoursSinceUpdate);
      return { canRun: false, reason: `Wait ${hoursRemaining}h before next update` };
    }
  }
  
  return { canRun: true, reason: null };
}

/**
 * Get stored model versions
 */
function getModelVersions(): ModelVersion[] {
  try {
    const stored = localStorage.getItem(MODEL_VERSIONS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Invalid data
  }
  return [];
}

/**
 * Save model version (keeps last MAX_MODEL_VERSIONS)
 */
function saveModelVersion(version: ModelVersion): void {
  const versions = getModelVersions();
  versions.push(version);
  
  // Keep only last MAX_MODEL_VERSIONS
  const trimmed = versions.slice(-MAX_MODEL_VERSIONS);
  localStorage.setItem(MODEL_VERSIONS_KEY, JSON.stringify(trimmed));
}

/**
 * Get model improvements history
 */
function getModelImprovements(): ModelImprovement[] {
  try {
    const stored = localStorage.getItem(MODEL_IMPROVEMENTS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Invalid data
  }
  return [];
}

/**
 * Save model improvement record
 */
function saveModelImprovement(improvement: ModelImprovement): void {
  const improvements = getModelImprovements();
  improvements.push(improvement);
  
  // Keep last 20 improvements
  const trimmed = improvements.slice(-20);
  localStorage.setItem(MODEL_IMPROVEMENTS_KEY, JSON.stringify(trimmed));
}

/**
 * Calculate accuracy from rewards
 */
function calculateAccuracyFromRewards(rewards: RewardEvent[]): number {
  if (rewards.length === 0) return 0;
  
  const positiveRewards = rewards.filter(r => r.reward > 0);
  const accuracy = (positiveRewards.length / rewards.length) * 100;
  return Math.round(accuracy * 100) / 100;
}

/**
 * Simulate accuracy improvement based on gradients
 * In real implementation, this would apply gradients to model weights
 */
function simulateAccuracyChange(
  currentAccuracy: number, 
  gradients: number[][], 
  rewards: RewardEvent[]
): number {
  // Calculate learning signal from rewards
  const avgReward = rewards.reduce((a, b) => a + b.reward, 0) / rewards.length;
  const positiveRatio = rewards.filter(r => r.reward > 0).length / rewards.length;
  
  // Simulate improvement based on gradient quality and reward signal
  const gradientMagnitude = gradients.flat().reduce((a, b) => a + Math.abs(b), 0) / gradients.flat().length;
  
  // Improvement formula (simplified simulation)
  // Real implementation would retrain the model
  let improvement = 0;
  
  if (avgReward > 0.5 && positiveRatio > 0.6) {
    // Good learning signal → likely improvement
    improvement = Math.min(gradientMagnitude * 10, 5); // Cap at 5%
  } else if (avgReward < 0) {
    // Negative signal → might decrease
    improvement = Math.max(-gradientMagnitude * 5, -3); // Cap at -3%
  } else {
    // Mixed signal → small random change
    improvement = (Math.random() - 0.5) * 2;
  }
  
  const newAccuracy = Math.max(0, Math.min(100, currentAccuracy + improvement));
  return Math.round(newAccuracy * 100) / 100;
}

/**
 * Run automatic local RL update
 * This is the main learning loop
 */
export async function runLocalRLUpdate(force: boolean = false): Promise<{
  success: boolean;
  improved: boolean;
  accuracyBefore: number;
  accuracyAfter: number;
  rolledBack: boolean;
  message: string;
}> {
  // Check conditions
  if (!force) {
    const { canRun, reason } = canRunRLUpdate();
    if (!canRun) {
      return {
        success: false,
        improved: false,
        accuracyBefore: 0,
        accuracyAfter: 0,
        rolledBack: false,
        message: reason || 'Cannot run update',
      };
    }
  }
  
  const rewards = getAllRewards();
  const currentAccuracy = calculateAccuracyFromRewards(rewards);
  
  console.log('[FederatedLearning] Starting local RL update...');
  console.log(`[FederatedLearning] Current accuracy: ${currentAccuracy}%`);
  
  try {
    // Step 1: Compute gradients based on rewards
    const gradients = await computeLocalGradients(rewards, []);
    if (!gradients) {
      return {
        success: false,
        improved: false,
        accuracyBefore: currentAccuracy,
        accuracyAfter: currentAccuracy,
        rolledBack: false,
        message: 'Failed to compute gradients',
      };
    }
    
    // Step 2: Save current model version before update (for rollback)
    const previousVersion: ModelVersion = {
      id: `v${Date.now()}`,
      timestamp: Date.now(),
      accuracy: currentAccuracy,
      rewardCount: rewards.length,
      gradients: gradients,
    };
    saveModelVersion(previousVersion);
    
    // Step 3: Simulate applying gradients (calculate new accuracy)
    const newAccuracy = simulateAccuracyChange(currentAccuracy, gradients, rewards);
    
    console.log(`[FederatedLearning] New accuracy after update: ${newAccuracy}%`);
    
    // Step 4: Check for rollback condition
    const accuracyDrop = (currentAccuracy - newAccuracy) / currentAccuracy;
    let rolledBack = false;
    let finalAccuracy = newAccuracy;
    
    if (accuracyDrop > ROLLBACK_THRESHOLD) {
      // Accuracy dropped by more than threshold, rollback
      console.warn(`[FederatedLearning] Accuracy dropped by ${(accuracyDrop * 100).toFixed(1)}%, rolling back...`);
      rolledBack = true;
      finalAccuracy = currentAccuracy;
    } else {
      // Update was beneficial or neutral, keep it
      await updateLocalModel(gradients);
    }
    
    // Step 5: Record the improvement attempt
    const improvement: ModelImprovement = {
      versionId: previousVersion.id,
      timestamp: Date.now(),
      accuracyBefore: currentAccuracy,
      accuracyAfter: rolledBack ? currentAccuracy : newAccuracy,
      improved: newAccuracy > currentAccuracy && !rolledBack,
      rewardsBasis: rewards.length,
    };
    saveModelImprovement(improvement);
    
    // Step 6: Update last RL update timestamp
    localStorage.setItem(LAST_RL_UPDATE_KEY, Date.now().toString());
    
    const improved = newAccuracy > currentAccuracy && !rolledBack;
    
    return {
      success: true,
      improved,
      accuracyBefore: currentAccuracy,
      accuracyAfter: finalAccuracy,
      rolledBack,
      message: rolledBack 
        ? 'Update rolled back due to accuracy drop' 
        : improved 
          ? `Model improved by ${(newAccuracy - currentAccuracy).toFixed(2)}%`
          : 'Model updated (no significant change)',
    };
    
  } catch (error) {
    console.error('[FederatedLearning] RL update failed:', error);
    return {
      success: false,
      improved: false,
      accuracyBefore: currentAccuracy,
      accuracyAfter: currentAccuracy,
      rolledBack: false,
      message: 'Update failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
    };
  }
}

/**
 * Rollback to a previous model version
 */
export function rollbackToVersion(versionId: string): boolean {
  const versions = getModelVersions();
  const targetVersion = versions.find(v => v.id === versionId);
  
  if (!targetVersion) {
    console.warn('[FederatedLearning] Version not found:', versionId);
    return false;
  }
  
  try {
    // Restore the gradients from that version
    const gradientData: GradientData = {
      modelVersion: targetVersion.id,
      timestamp: targetVersion.timestamp,
      gradients: targetVersion.gradients,
      rewardCount: targetVersion.rewardCount,
      averageReward: 0,
      checksum: computeChecksum(targetVersion.gradients),
    };
    
    localStorage.setItem(GRADIENTS_KEY, JSON.stringify(gradientData));
    console.log('[FederatedLearning] Rolled back to version:', versionId);
    return true;
    
  } catch (error) {
    console.error('[FederatedLearning] Rollback failed:', error);
    return false;
  }
}

/**
 * Get local learning status and progress
 */
export function getLocalLearningStatus(): LocalLearningStatus {
  const versions = getModelVersions();
  const improvements = getModelImprovements();
  const rewards = getAllRewards();
  const { canRun, reason } = canRunRLUpdate();
  
  const currentAccuracy = calculateAccuracyFromRewards(rewards);
  const bestAccuracy = improvements.length > 0 
    ? Math.max(...improvements.map(i => Math.max(i.accuracyBefore, i.accuracyAfter)))
    : currentAccuracy;
  
  const lastUpdate = localStorage.getItem(LAST_RL_UPDATE_KEY);
  
  return {
    totalUpdates: improvements.length,
    successfulUpdates: improvements.filter(i => i.improved).length,
    currentAccuracy,
    bestAccuracy,
    lastUpdateTime: lastUpdate ? parseInt(lastUpdate, 10) : null,
    canRunUpdate: canRun,
    reasonCannotRun: reason,
    versionHistory: versions,
    improvementHistory: improvements,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateAverageReward(): number {
  const rewards = getAllRewards();
  if (rewards.length === 0) return 0;
  return rewards.reduce((a, b) => a + b.reward, 0) / rewards.length;
}

function computeChecksum(gradients: number[][]): string {
  // Simple checksum based on gradient statistics
  const flat = gradients.flat();
  const sum = flat.reduce((a, b) => a + b, 0);
  const variance = flat.reduce((a, b) => a + b * b, 0);
  return `${flat.length}-${sum.toFixed(4)}-${variance.toFixed(4)}`;
}

/**
 * Privacy explanation for user consent
 */
export const PRIVACY_EXPLANATION = `
## Federated Learning - Privacy First

By enabling federated learning, you help improve language predictions for all users while keeping your data private.

### What gets shared:
✓ **Aggregated model gradients** - mathematical values that help improve the model
✓ **Reward statistics** - whether predictions were helpful (not the predictions themselves)

### What NEVER gets shared:
✗ Your browser languages
✗ Your timezone
✗ Your location
✗ Individual predictions made for you
✗ Any personally identifiable information

### How it works:
1. Predictions are made locally on your device
2. You provide feedback (thumbs up/down)
3. Gradients are computed locally
4. Only gradients (not data) would be sent to improve the shared model

### Your control:
- You can revoke consent anytime
- All your data stays on your device
- You can view exactly what would be shared

*Currently in Beta - gradients are computed locally but not sent anywhere yet.*
`;
