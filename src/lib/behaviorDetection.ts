// Behavior Detection Module
// Tracks user behavior patterns for privacy awareness
// All data stays in memory - never persisted

interface MouseTrackingResult {
  totalMovements: number;
  averageSpeed: number;
  pattern: 'human' | 'bot' | 'unknown';
  tracked: boolean;
  risk: 'high';
}

interface TypingPatternResult {
  keystrokeCount: number;
  averageSpeed: number; // WPM
  hasPattern: boolean;
  tracked: boolean;
  risk: 'medium';
}

interface ClickBehaviorResult {
  totalClicks: number;
  clickRate: number; // clicks per minute
  targets: string[];
  pattern: string;
  risk: 'medium';
}

interface ScrollBehaviorResult {
  scrollDepth: number; // percentage
  scrollSpeed: number;
  totalScrolls: number;
  engagement: 'high' | 'medium' | 'low';
  risk: 'medium';
}

interface TimeOnSiteResult {
  totalTime: number; // seconds
  activeTime: number;
  idleTime: number;
  tabSwitches: number;
  risk: 'low';
}

interface HeatmapHotspot {
  x: number;
  y: number;
  intensity: number;
}

interface InteractionHeatmapResult {
  hotspots: HeatmapHotspot[];
  engagementScore: number;
  risk: 'high';
}

// In-memory storage (never persisted)
let mouseData: { x: number; y: number; time: number; speed: number }[] = [];
let keystrokeTimings: number[] = [];
let clickData: { time: number; target: string; x: number; y: number }[] = [];
let scrollData: { depth: number; time: number; direction: 'up' | 'down' }[] = [];
let sessionStart: number = Date.now();
let lastActivity: number = Date.now();
let tabSwitchCount: number = 0;
let isTracking: boolean = false;
let idleTimeout: ReturnType<typeof setTimeout> | null = null;
let totalIdleTime: number = 0;
let idleStart: number | null = null;

// Event listeners storage for cleanup
let mouseListener: ((e: MouseEvent) => void) | null = null;
let keyListener: ((e: KeyboardEvent) => void) | null = null;
let clickListener: ((e: MouseEvent) => void) | null = null;
let scrollListener: (() => void) | null = null;
let visibilityListener: (() => void) | null = null;
let lastMousePosition: { x: number; y: number; time: number } | null = null;

// Grid for heatmap calculation
const GRID_SIZE = 10; // 10x10 grid
let interactionGrid: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

/**
 * Track mouse movement patterns
 * Analyzes speed, acceleration, and movement patterns to detect human vs bot behavior
 */
export function trackMouseMovement(): MouseTrackingResult {
  if (mouseData.length === 0) {
    return {
      totalMovements: 0,
      averageSpeed: 0,
      pattern: 'unknown',
      tracked: false,
      risk: 'high'
    };
  }

  const speeds = mouseData.map(d => d.speed).filter(s => s > 0);
  const averageSpeed = speeds.length > 0 
    ? speeds.reduce((a, b) => a + b, 0) / speeds.length 
    : 0;

  // Analyze pattern: humans have variable speed, bots are often constant
  const speedVariance = calculateVariance(speeds);
  const hasNaturalPauses = mouseData.some((d, i) => {
    if (i === 0) return false;
    const timeDiff = d.time - mouseData[i - 1].time;
    return timeDiff > 100 && timeDiff < 2000; // Natural pause range
  });

  // Detect acceleration patterns (humans accelerate/decelerate naturally)
  const hasAccelerationChanges = speeds.length > 2 && speeds.some((s, i) => {
    if (i < 2) return false;
    const accel1 = speeds[i] - speeds[i - 1];
    const accel2 = speeds[i - 1] - speeds[i - 2];
    return Math.sign(accel1) !== Math.sign(accel2);
  });

  let pattern: 'human' | 'bot' | 'unknown' = 'unknown';
  if (mouseData.length >= 10) {
    if (speedVariance > 50 && hasNaturalPauses && hasAccelerationChanges) {
      pattern = 'human';
    } else if (speedVariance < 10 && !hasNaturalPauses) {
      pattern = 'bot';
    }
  }

  return {
    totalMovements: mouseData.length,
    averageSpeed: Math.round(averageSpeed * 100) / 100,
    pattern,
    tracked: true,
    risk: 'high'
  };
}

/**
 * Track typing patterns
 * Records keystroke timing (NEVER content) to analyze typing rhythm
 */
export function trackTypingPatterns(): TypingPatternResult {
  if (keystrokeTimings.length < 2) {
    return {
      keystrokeCount: keystrokeTimings.length,
      averageSpeed: 0,
      hasPattern: false,
      tracked: keystrokeTimings.length > 0,
      risk: 'medium'
    };
  }

  // Calculate intervals between keystrokes
  const intervals: number[] = [];
  for (let i = 1; i < keystrokeTimings.length; i++) {
    intervals.push(keystrokeTimings[i] - keystrokeTimings[i - 1]);
  }

  // Average interval in ms
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  
  // Convert to WPM (assuming average word is 5 characters)
  // WPM = (characters / 5) / (time in minutes)
  const totalTimeMinutes = (keystrokeTimings[keystrokeTimings.length - 1] - keystrokeTimings[0]) / 60000;
  const wpm = totalTimeMinutes > 0 
    ? Math.round((keystrokeTimings.length / 5) / totalTimeMinutes) 
    : 0;

  // Detect rhythm pattern
  const intervalVariance = calculateVariance(intervals);
  const hasConsistentRhythm = intervalVariance < avgInterval * 0.5;
  
  // Detect burst typing patterns (common in humans)
  const hasBurstPattern = intervals.some((int, i) => {
    if (i === 0) return false;
    return (int < 100 && intervals[i - 1] > 500) || (int > 500 && intervals[i - 1] < 100);
  });

  return {
    keystrokeCount: keystrokeTimings.length,
    averageSpeed: wpm,
    hasPattern: hasConsistentRhythm || hasBurstPattern,
    tracked: true,
    risk: 'medium'
  };
}

/**
 * Track click behavior
 * Records click events and analyzes patterns
 */
export function trackClickBehavior(): ClickBehaviorResult {
  if (clickData.length === 0) {
    return {
      totalClicks: 0,
      clickRate: 0,
      targets: [],
      pattern: 'none',
      risk: 'medium'
    };
  }

  // Calculate click rate (clicks per minute)
  const sessionDuration = (Date.now() - sessionStart) / 60000; // minutes
  const clickRate = sessionDuration > 0 
    ? Math.round((clickData.length / sessionDuration) * 100) / 100 
    : 0;

  // Get unique targets (element types only, not content)
  const targetSet = new Set(clickData.map(c => c.target));
  const targets = Array.from(targetSet).slice(0, 10);

  // Analyze click patterns
  let pattern = 'exploratory';
  if (clickData.length >= 5) {
    const clickIntervals = clickData.slice(1).map((c, i) => c.time - clickData[i].time);
    const avgInterval = clickIntervals.reduce((a, b) => a + b, 0) / clickIntervals.length;
    
    if (avgInterval < 500) {
      pattern = 'rapid';
    } else if (avgInterval > 5000) {
      pattern = 'deliberate';
    } else if (calculateVariance(clickIntervals) < 1000) {
      pattern = 'rhythmic';
    }
  }

  // Update heatmap grid
  clickData.forEach(click => {
    const gridX = Math.floor((click.x / window.innerWidth) * GRID_SIZE);
    const gridY = Math.floor((click.y / window.innerHeight) * GRID_SIZE);
    if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
      interactionGrid[gridY][gridX]++;
    }
  });

  return {
    totalClicks: clickData.length,
    clickRate,
    targets,
    pattern,
    risk: 'medium'
  };
}

/**
 * Track scroll behavior
 * Records scroll events and calculates engagement
 */
export function trackScrollBehavior(): ScrollBehaviorResult {
  if (scrollData.length === 0) {
    return {
      scrollDepth: 0,
      scrollSpeed: 0,
      totalScrolls: 0,
      engagement: 'low',
      risk: 'medium'
    };
  }

  // Calculate max scroll depth
  const maxDepth = Math.max(...scrollData.map(s => s.depth));
  
  // Calculate average scroll speed (depth change per second)
  let totalSpeedSum = 0;
  for (let i = 1; i < scrollData.length; i++) {
    const depthChange = Math.abs(scrollData[i].depth - scrollData[i - 1].depth);
    const timeDiff = (scrollData[i].time - scrollData[i - 1].time) / 1000;
    if (timeDiff > 0) {
      totalSpeedSum += depthChange / timeDiff;
    }
  }
  const avgSpeed = scrollData.length > 1 
    ? Math.round((totalSpeedSum / (scrollData.length - 1)) * 100) / 100 
    : 0;

  // Determine engagement level
  let engagement: 'high' | 'medium' | 'low' = 'low';
  const sessionMinutes = (Date.now() - sessionStart) / 60000;
  const scrollsPerMinute = sessionMinutes > 0 ? scrollData.length / sessionMinutes : 0;

  if (maxDepth > 75 && scrollsPerMinute > 5) {
    engagement = 'high';
  } else if (maxDepth > 40 || scrollsPerMinute > 2) {
    engagement = 'medium';
  }

  return {
    scrollDepth: Math.round(maxDepth),
    scrollSpeed: avgSpeed,
    totalScrolls: scrollData.length,
    engagement,
    risk: 'medium'
  };
}

/**
 * Track time on site
 * Records session duration, active/idle time, and tab switches
 */
export function trackTimeOnSite(): TimeOnSiteResult {
  const totalTime = Math.round((Date.now() - sessionStart) / 1000);
  
  // Calculate idle time
  let currentIdleTime = totalIdleTime;
  if (idleStart !== null) {
    currentIdleTime += Date.now() - idleStart;
  }
  const idleTimeSeconds = Math.round(currentIdleTime / 1000);
  const activeTime = Math.max(0, totalTime - idleTimeSeconds);

  return {
    totalTime,
    activeTime,
    idleTime: idleTimeSeconds,
    tabSwitches: tabSwitchCount,
    risk: 'low'
  };
}

/**
 * Generate interaction heatmap
 * Combines all interaction data into engagement zones
 */
export function generateInteractionHeatmap(): InteractionHeatmapResult {
  const hotspots: HeatmapHotspot[] = [];
  let maxIntensity = 0;

  // Find max intensity for normalization
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (interactionGrid[y][x] > maxIntensity) {
        maxIntensity = interactionGrid[y][x];
      }
    }
  }

  // Create hotspots from grid
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (interactionGrid[y][x] > 0) {
        hotspots.push({
          x: (x + 0.5) / GRID_SIZE * 100, // percentage
          y: (y + 0.5) / GRID_SIZE * 100, // percentage
          intensity: maxIntensity > 0 
            ? Math.round((interactionGrid[y][x] / maxIntensity) * 100) / 100 
            : 0
        });
      }
    }
  }

  // Calculate engagement score (0-100)
  const totalInteractions = mouseData.length + clickData.length + scrollData.length;
  const sessionMinutes = (Date.now() - sessionStart) / 60000;
  const interactionsPerMinute = sessionMinutes > 0 ? totalInteractions / sessionMinutes : 0;
  
  const scrollResult = trackScrollBehavior();
  const timeResult = trackTimeOnSite();
  
  // Weighted engagement score
  const depthScore = scrollResult.scrollDepth * 0.3;
  const activityScore = Math.min(interactionsPerMinute * 2, 30);
  const timeScore = Math.min(timeResult.activeTime / 60 * 5, 20);
  const coverageScore = (hotspots.length / (GRID_SIZE * GRID_SIZE)) * 20;
  
  const engagementScore = Math.round(Math.min(100, depthScore + activityScore + timeScore + coverageScore));

  return {
    hotspots,
    engagementScore,
    risk: 'high'
  };
}

/**
 * Get all behavior tracking data
 */
export function getAllBehaviorData() {
  return {
    mouse: trackMouseMovement(),
    typing: trackTypingPatterns(),
    clicks: trackClickBehavior(),
    scroll: trackScrollBehavior(),
    timeOnSite: trackTimeOnSite(),
    heatmap: generateInteractionHeatmap()
  };
}

/**
 * Start behavior tracking
 * Initializes all event listeners
 */
export function startBehaviorTracking(): void {
  if (isTracking) return;
  
  isTracking = true;
  sessionStart = Date.now();
  lastActivity = Date.now();

  // Mouse movement tracking
  mouseListener = (e: MouseEvent) => {
    const now = Date.now();
    let speed = 0;

    if (lastMousePosition) {
      const dx = e.clientX - lastMousePosition.x;
      const dy = e.clientY - lastMousePosition.y;
      const dt = now - lastMousePosition.time;
      if (dt > 0) {
        speed = Math.sqrt(dx * dx + dy * dy) / dt * 1000; // pixels per second
      }
    }

    // Store normalized position (0-100) instead of exact coordinates for privacy
    mouseData.push({
      x: Math.round((e.clientX / window.innerWidth) * 100),
      y: Math.round((e.clientY / window.innerHeight) * 100),
      time: now,
      speed
    });

    lastMousePosition = { x: e.clientX, y: e.clientY, time: now };
    
    // Limit storage (keep last 1000 movements)
    if (mouseData.length > 1000) {
      mouseData = mouseData.slice(-1000);
    }

    updateActivity();
  };

  // Keystroke timing tracking (NO content!)
  keyListener = (e: KeyboardEvent) => {
    // Only record timing, never the actual key
    keystrokeTimings.push(Date.now());
    
    // Limit storage
    if (keystrokeTimings.length > 500) {
      keystrokeTimings = keystrokeTimings.slice(-500);
    }

    updateActivity();
  };

  // Click tracking
  clickListener = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const className = target.className?.split?.(' ')?.[0] || '';
    
    clickData.push({
      time: Date.now(),
      target: `${tagName}${className ? '.' + className : ''}`,
      x: e.clientX,
      y: e.clientY
    });

    // Update heatmap grid
    const gridX = Math.min(GRID_SIZE - 1, Math.floor((e.clientX / window.innerWidth) * GRID_SIZE));
    const gridY = Math.min(GRID_SIZE - 1, Math.floor((e.clientY / window.innerHeight) * GRID_SIZE));
    interactionGrid[gridY][gridX]++;

    // Limit storage
    if (clickData.length > 200) {
      clickData = clickData.slice(-200);
    }

    updateActivity();
  };

  // Scroll tracking
  scrollListener = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const depth = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

    const lastScroll = scrollData[scrollData.length - 1];
    const direction: 'up' | 'down' = lastScroll && depth < lastScroll.depth ? 'up' : 'down';

    scrollData.push({
      depth,
      time: Date.now(),
      direction
    });

    // Limit storage
    if (scrollData.length > 300) {
      scrollData = scrollData.slice(-300);
    }

    updateActivity();
  };

  // Tab visibility tracking
  visibilityListener = () => {
    if (document.hidden) {
      tabSwitchCount++;
      // Start idle timer
      if (idleStart === null) {
        idleStart = Date.now();
      }
    } else {
      // End idle timer
      if (idleStart !== null) {
        totalIdleTime += Date.now() - idleStart;
        idleStart = null;
      }
    }
  };

  // Add event listeners
  document.addEventListener('mousemove', mouseListener, { passive: true });
  document.addEventListener('keydown', keyListener, { passive: true });
  document.addEventListener('click', clickListener, { passive: true });
  window.addEventListener('scroll', scrollListener, { passive: true });
  document.addEventListener('visibilitychange', visibilityListener);

  // Idle detection
  startIdleDetection();
}

/**
 * Stop behavior tracking
 * Removes all event listeners and clears data
 */
export function stopBehaviorTracking(): void {
  if (!isTracking) return;

  isTracking = false;

  // Remove event listeners
  if (mouseListener) {
    document.removeEventListener('mousemove', mouseListener);
    mouseListener = null;
  }
  if (keyListener) {
    document.removeEventListener('keydown', keyListener);
    keyListener = null;
  }
  if (clickListener) {
    document.removeEventListener('click', clickListener);
    clickListener = null;
  }
  if (scrollListener) {
    window.removeEventListener('scroll', scrollListener);
    scrollListener = null;
  }
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }

  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }

  // Clear all data
  clearBehaviorData();
}

/**
 * Clear all behavior data
 */
export function clearBehaviorData(): void {
  mouseData = [];
  keystrokeTimings = [];
  clickData = [];
  scrollData = [];
  tabSwitchCount = 0;
  totalIdleTime = 0;
  idleStart = null;
  lastMousePosition = null;
  interactionGrid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
}

/**
 * Check if tracking is active
 */
export function isTrackingActive(): boolean {
  return isTracking;
}

// Helper functions

function calculateVariance(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
}

function updateActivity(): void {
  lastActivity = Date.now();
  
  // Reset idle if was idle
  if (idleStart !== null) {
    totalIdleTime += Date.now() - idleStart;
    idleStart = null;
  }
  
  // Restart idle detection
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  startIdleDetection();
}

function startIdleDetection(): void {
  idleTimeout = setTimeout(() => {
    if (idleStart === null) {
      idleStart = Date.now();
    }
  }, 30000); // 30 seconds of inactivity = idle
}

// Auto-start tracking when module loads
if (typeof window !== 'undefined') {
  // Start tracking after a small delay to ensure DOM is ready
  setTimeout(() => {
    startBehaviorTracking();
  }, 100);
}
