import { useState, useEffect, useCallback, useRef } from 'react';
import { detectOrientation, OrientationData } from '@/lib/deviceDetection';

const ANGLE_THRESHOLD = 3; // Only update if angle changed by more than 3 degrees
const HAPTIC_THRESHOLDS = [0, 90, 180, 270]; // Major thresholds for haptic feedback

function triggerHaptic() {
  if ('vibrate' in navigator) {
    navigator.vibrate(50);
  }
}

function getClosestThreshold(angle: number): number | null {
  for (const threshold of HAPTIC_THRESHOLDS) {
    if (Math.abs(angle - threshold) <= 5 || Math.abs(angle - threshold + 360) <= 5 || Math.abs(angle - threshold - 360) <= 5) {
      return threshold;
    }
  }
  return null;
}

export function useOrientation(): OrientationData {
  const [orientation, setOrientation] = useState<OrientationData>(detectOrientation);
  const lastAngleRef = useRef<number>(orientation.angle);
  const lastHapticThresholdRef = useRef<number | null>(null);

  const handleOrientationChange = useCallback(() => {
    const newOrientation = detectOrientation();
    const angleDiff = Math.abs(newOrientation.angle - lastAngleRef.current);
    
    // Only update if angle changed significantly (threshold filtering)
    if (angleDiff >= ANGLE_THRESHOLD || angleDiff >= 360 - ANGLE_THRESHOLD) {
      // Check for haptic feedback on major thresholds
      const threshold = getClosestThreshold(newOrientation.angle);
      if (threshold !== null && threshold !== lastHapticThresholdRef.current) {
        triggerHaptic();
        lastHapticThresholdRef.current = threshold;
      } else if (threshold === null) {
        lastHapticThresholdRef.current = null;
      }
      
      lastAngleRef.current = newOrientation.angle;
      setOrientation(newOrientation);
    }
  }, []);

  useEffect(() => {
    // Listen to legacy orientationchange event
    window.addEventListener('orientationchange', handleOrientationChange);

    // Listen to resize as fallback (works on all browsers)
    window.addEventListener('resize', handleOrientationChange);

    // Listen to modern Screen Orientation API change event
    if (screen.orientation) {
      screen.orientation.addEventListener('change', handleOrientationChange);
    }

    // Cleanup on unmount
    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
      
      if (screen.orientation) {
        screen.orientation.removeEventListener('change', handleOrientationChange);
      }
    };
  }, [handleOrientationChange]);

  return orientation;
}
