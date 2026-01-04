import { useState, useEffect, useCallback } from 'react';
import { detectOrientation, OrientationData } from '@/lib/deviceDetection';

export function useOrientation(): OrientationData {
  const [orientation, setOrientation] = useState<OrientationData>(detectOrientation);

  const handleOrientationChange = useCallback(() => {
    setOrientation(detectOrientation());
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
