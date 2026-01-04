import { useState, useEffect, useCallback } from 'react';

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

export function useDeviceMotion(): UseDeviceMotionReturn {
  const [motion, setMotion] = useState<MotionData>({
    alpha: null,
    beta: null,
    gamma: null,
  });
  const [permission, setPermission] = useState<PermissionStatus>('unknown');
  const [isSupported] = useState(() => 'DeviceOrientationEvent' in window);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    setMotion({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
    });
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
