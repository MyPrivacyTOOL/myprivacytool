// Implicit Reward Tracking for Language Prediction Model
// All tracking happens client-side only - no data transmitted

export interface RewardEvent {
  id: string;
  timestamp: number;
  prediction: string;
  userProfile: string;
  confidence: number;
  reward: number;
  reason: RewardReason;
  details?: string;
}

export type RewardReason = 
  | 'dwell_30s'
  | 'dwell_60s'
  | 'dwell_bonus'
  | 'scroll_engaged'
  | 'language_switch'
  | 'explicit_positive'
  | 'explicit_negative'
  | 'return_visit'
  | 'high_confidence_bonus';

export interface RewardStats {
  totalEvents: number;
  averageReward: number;
  positiveCount: number;
  negativeCount: number;
  rewardByProfile: Record<string, { total: number; count: number; average: number }>;
  rewardByReason: Record<string, { total: number; count: number }>;
  rewardTrend: { date: string; avgReward: number; count: number }[];
}

const STORAGE_KEY = 'mpt_rewards';
const MAX_EVENTS = 100;

// Reward values
const REWARDS = {
  dwell_30s: 1.0,
  dwell_60s: 2.0,
  dwell_bonus: 0.5,
  scroll_engaged: 0.5,
  language_switch: -1.0,
  explicit_positive: 2.0,
  explicit_negative: -2.0,
  return_visit: 1.5,
  high_confidence_bonus: 0.5,
};

// Generate unique ID
function generateId(): string {
  return `reward_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Get stored rewards
function getStoredRewards(): RewardEvent[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to get stored rewards:', error);
  }
  return [];
}

// Save rewards (rolling window of MAX_EVENTS)
function saveRewards(rewards: RewardEvent[]): void {
  try {
    // Keep only the last MAX_EVENTS
    const trimmed = rewards.slice(-MAX_EVENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.warn('Failed to save rewards:', error);
  }
}

// Track a reward event
export function trackReward(
  reason: RewardReason,
  prediction: string,
  userProfile: string,
  confidence: number,
  details?: string
): RewardEvent {
  const reward = REWARDS[reason];
  
  const event: RewardEvent = {
    id: generateId(),
    timestamp: Date.now(),
    prediction,
    userProfile,
    confidence,
    reward,
    reason,
    details,
  };
  
  const rewards = getStoredRewards();
  rewards.push(event);
  saveRewards(rewards);
  
  console.log(`[RewardTracking] ${reason}: ${reward > 0 ? '+' : ''}${reward} for ${prediction}`);
  
  return event;
}

// Track dwell time (called with elapsed seconds)
export function trackDwellReward(
  dwellSeconds: number,
  prediction: string,
  userProfile: string,
  confidence: number
): RewardEvent[] {
  const events: RewardEvent[] = [];
  
  if (dwellSeconds >= 60) {
    events.push(trackReward('dwell_60s', prediction, userProfile, confidence, `Dwell time: ${dwellSeconds}s`));
  } else if (dwellSeconds >= 30) {
    events.push(trackReward('dwell_30s', prediction, userProfile, confidence, `Dwell time: ${dwellSeconds}s`));
  }
  
  // High confidence + long dwell bonus
  if (dwellSeconds >= 45 && confidence >= 80) {
    events.push(trackReward('high_confidence_bonus', prediction, userProfile, confidence, 'High confidence + engaged'));
  }
  
  return events;
}

// Track scroll engagement
export function trackScrollEngagement(
  scrollDepth: number, // 0-100 percentage
  prediction: string,
  userProfile: string,
  confidence: number
): RewardEvent | null {
  // Only reward if scrolled more than 50%
  if (scrollDepth >= 50) {
    return trackReward('scroll_engaged', prediction, userProfile, confidence, `Scroll depth: ${scrollDepth}%`);
  }
  return null;
}

// Track language switch (negative signal)
export function trackLanguageSwitch(
  prediction: string,
  userProfile: string,
  confidence: number,
  switchedTo: string
): RewardEvent {
  return trackReward('language_switch', prediction, userProfile, confidence, `Switched to: ${switchedTo}`);
}

// Track explicit feedback
export function trackExplicitFeedback(
  isPositive: boolean,
  prediction: string,
  userProfile: string,
  confidence: number
): RewardEvent {
  return trackReward(
    isPositive ? 'explicit_positive' : 'explicit_negative',
    prediction,
    userProfile,
    confidence
  );
}

// Track return visit with same prediction
export function trackReturnVisit(
  prediction: string,
  userProfile: string,
  confidence: number
): RewardEvent | null {
  // Check if we've seen this prediction before recently
  const rewards = getStoredRewards();
  const recentPredictions = rewards
    .filter(r => Date.now() - r.timestamp < 7 * 24 * 60 * 60 * 1000) // Last 7 days
    .map(r => r.prediction);
  
  if (recentPredictions.includes(prediction)) {
    return trackReward('return_visit', prediction, userProfile, confidence, 'Returning user with same prediction');
  }
  return null;
}

// Get reward statistics
export function getRewardStats(): RewardStats {
  const rewards = getStoredRewards();
  
  if (rewards.length === 0) {
    return {
      totalEvents: 0,
      averageReward: 0,
      positiveCount: 0,
      negativeCount: 0,
      rewardByProfile: {},
      rewardByReason: {},
      rewardTrend: [],
    };
  }
  
  const totalReward = rewards.reduce((sum, r) => sum + r.reward, 0);
  const positiveCount = rewards.filter(r => r.reward > 0).length;
  const negativeCount = rewards.filter(r => r.reward < 0).length;
  
  // Group by profile
  const rewardByProfile: Record<string, { total: number; count: number; average: number }> = {};
  rewards.forEach(r => {
    if (!rewardByProfile[r.userProfile]) {
      rewardByProfile[r.userProfile] = { total: 0, count: 0, average: 0 };
    }
    rewardByProfile[r.userProfile].total += r.reward;
    rewardByProfile[r.userProfile].count++;
  });
  Object.keys(rewardByProfile).forEach(profile => {
    rewardByProfile[profile].average = rewardByProfile[profile].total / rewardByProfile[profile].count;
  });
  
  // Group by reason
  const rewardByReason: Record<string, { total: number; count: number }> = {};
  rewards.forEach(r => {
    if (!rewardByReason[r.reason]) {
      rewardByReason[r.reason] = { total: 0, count: 0 };
    }
    rewardByReason[r.reason].total += r.reward;
    rewardByReason[r.reason].count++;
  });
  
  // Calculate trend (last 7 days)
  const trendMap: Record<string, { total: number; count: number }> = {};
  rewards.forEach(r => {
    const date = new Date(r.timestamp).toISOString().split('T')[0];
    if (!trendMap[date]) {
      trendMap[date] = { total: 0, count: 0 };
    }
    trendMap[date].total += r.reward;
    trendMap[date].count++;
  });
  
  const rewardTrend = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, data]) => ({
      date,
      avgReward: data.total / data.count,
      count: data.count,
    }));
  
  return {
    totalEvents: rewards.length,
    averageReward: totalReward / rewards.length,
    positiveCount,
    negativeCount,
    rewardByProfile,
    rewardByReason,
    rewardTrend,
  };
}

// Clear all rewards (user privacy action)
export function clearRewards(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[RewardTracking] All rewards cleared');
  } catch (error) {
    console.warn('Failed to clear rewards:', error);
  }
}

// Get all reward events (for debugging/export)
export function getAllRewards(): RewardEvent[] {
  return getStoredRewards();
}

// Dwell time tracker class for automatic tracking
export class DwellTimeTracker {
  private startTime: number;
  private prediction: string;
  private userProfile: string;
  private confidence: number;
  private hasTracked30s: boolean = false;
  private hasTracked60s: boolean = false;
  private intervalId: number | null = null;
  
  constructor(prediction: string, userProfile: string, confidence: number) {
    this.startTime = Date.now();
    this.prediction = prediction;
    this.userProfile = userProfile;
    this.confidence = confidence;
  }
  
  start(): void {
    // Check every 5 seconds
    this.intervalId = window.setInterval(() => {
      this.checkDwellTime();
    }, 5000);
  }
  
  private checkDwellTime(): void {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    
    if (elapsed >= 60 && !this.hasTracked60s) {
      trackReward('dwell_60s', this.prediction, this.userProfile, this.confidence, `Dwell time: ${elapsed}s`);
      this.hasTracked60s = true;
      
      // Also check for high confidence bonus
      if (this.confidence >= 80) {
        trackReward('high_confidence_bonus', this.prediction, this.userProfile, this.confidence, 'High confidence + engaged');
      }
    } else if (elapsed >= 30 && !this.hasTracked30s && !this.hasTracked60s) {
      trackReward('dwell_30s', this.prediction, this.userProfile, this.confidence, `Dwell time: ${elapsed}s`);
      this.hasTracked30s = true;
    }
  }
  
  stop(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  getElapsedSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

// Scroll depth tracker
export class ScrollDepthTracker {
  private maxScrollDepth: number = 0;
  private prediction: string;
  private userProfile: string;
  private confidence: number;
  private hasTracked: boolean = false;
  private boundHandler: () => void;
  
  constructor(prediction: string, userProfile: string, confidence: number) {
    this.prediction = prediction;
    this.userProfile = userProfile;
    this.confidence = confidence;
    this.boundHandler = this.handleScroll.bind(this);
  }
  
  start(): void {
    window.addEventListener('scroll', this.boundHandler, { passive: true });
  }
  
  private handleScroll(): void {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercent = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
    
    if (scrollPercent > this.maxScrollDepth) {
      this.maxScrollDepth = scrollPercent;
    }
    
    // Track once when user scrolls past 50%
    if (this.maxScrollDepth >= 50 && !this.hasTracked) {
      trackReward('scroll_engaged', this.prediction, this.userProfile, this.confidence, `Scroll depth: ${this.maxScrollDepth}%`);
      this.hasTracked = true;
    }
  }
  
  stop(): void {
    window.removeEventListener('scroll', this.boundHandler);
  }
  
  getMaxDepth(): number {
    return this.maxScrollDepth;
  }
}
