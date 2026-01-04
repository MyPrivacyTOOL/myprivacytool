import { useState, useEffect, useCallback, useRef } from 'react';

export interface MotionData {
  alpha: number | null; // Z-axis rotation (0-360)
  beta: number | null;  // X-axis rotation (-180 to 180)
  gamma: number | null; // Y-axis rotation (-90 to 90)
}

export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'not-required';

interface UseDeviceMotionReturn {
  motion: MotionData;
  permission: PermissionStatus;
  requestPermission: () => Promise<boolean>;
  isSupported: boolean;
}

const MOTION_THRESHOLD = 2; // Only update if beta/gamma changed by more than 2 degrees
const TILT_BOUNDARY = 60; // Cap tilt at ±60 degrees

function clampTilt(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(-TILT_BOUNDARY, Math.min(TILT_BOUNDARY, value));
}

export function useDeviceMotion(): UseDeviceMotionReturn {
  const [motion, setMotion] = useState<MotionData>({
    alpha: null,
    beta: null,
    gamma: null,
  });
  const [permission, setPermission] = useState<PermissionStatus>('unknown');
  const [isSupported] = useState(() => 'DeviceOrientationEvent' in window);
  
  const lastMotionRef = useRef<MotionData>({
    alpha: null,
    beta: null,
    gamma: null,
  });

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const newBeta = event.beta;
    const newGamma = event.gamma;
    const lastBeta = lastMotionRef.current.beta;
    const lastGamma = lastMotionRef.current.gamma;
    
    // Check if motion changed significantly (threshold filtering)
    const betaDiff = lastBeta !== null && newBeta !== null ? Math.abs(newBeta - lastBeta) : Infinity;
    const gammaDiff = lastGamma !== null && newGamma !== null ? Math.abs(newGamma - lastGamma) : Infinity;
    
    if (betaDiff >= MOTION_THRESHOLD || gammaDiff >= MOTION_THRESHOLD) {
      // Apply tilt boundaries to prevent extreme rotations
      const clampedMotion: MotionData = {
        alpha: event.alpha,
        beta: clampTilt(newBeta),
        gamma: clampTilt(newGamma),
      };
      
      lastMotionRef.current = {
        alpha: event.alpha,
        beta: newBeta,
        gamma: newGamma,
      };
      
      setMotion(clampedMotion);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const DeviceOrientationEventWithPermission = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    // Check if permission API exists (iOS 13+)
    if (typeof DeviceOrientationEventWithPermission.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEventWithPermission.requestPermission();
        if (result === 'granted') {
          setPermission('granted');
          window.addEventListener('deviceorientation', handleOrientation);
          return true;
        } else {
          setPermission('denied');
          return false;
        }
      } catch {
        setPermission('denied');
        return false;
      }
    } else {
      // No permission required (non-iOS or older iOS)
      setPermission('not-required');
      window.addEventListener('deviceorientation', handleOrientation);
      return true;
    }
  }, [handleOrientation]);

  useEffect(() => {
    if (!isSupported) {
      setPermission('denied');
      return;
    }

    const DeviceOrientationEventWithPermission = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    // Auto-attach listener if no permission required
    if (typeof DeviceOrientationEventWithPermission.requestPermission !== 'function') {
      setPermission('not-required');
      window.addEventListener('deviceorientation', handleOrientation);
    }

    // Cleanup on unmount
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [isSupported, handleOrientation]);

  return {
    motion,
    permission,
    requestPermission,
    isSupported,
  };
}
