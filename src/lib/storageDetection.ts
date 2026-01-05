// Storage and State Detection Utilities for MyPrivacyTOOL

// Known tracking-related keys to detect
const TRACKING_KEYS = [
  'analytics', 'ga_', '_ga', 'gtm', 'fbp', 'fbq', '_fbp',
  'amplitude', 'mixpanel', 'segment', 'heap', 'intercom',
  'hotjar', 'clarity', '_hj', 'optimizely', 'abtasty',
  'adroll', 'criteo', 'doubleclick', 'adsense',
  'pixel', 'tracking', 'tracker', 'visitor', 'session_id',
  'user_id', 'client_id', 'device_id', 'fingerprint',
  'attribution', 'campaign', 'utm_', 'referrer',
];

// Known tracking database names
const TRACKING_DATABASES = [
  'analytics', 'tracking', 'amplitude', 'segment', 'mixpanel',
  'fingerprint', 'visitor', 'session', 'metrics', 'telemetry',
];

// ==================== Types ====================

export interface CookiesResult {
  enabled: boolean;
  count: number;
  thirdParty: number;
  names: string[];
  risk: 'high' | 'medium' | 'low';
}

export interface LocalStorageResult {
  available: boolean;
  itemCount: number;
  sizeKB: number;
  keys: string[];
  hasTracking: boolean;
  trackingKeys: string[];
  risk: 'high' | 'medium' | 'low';
}

export interface SessionStorageResult {
  available: boolean;
  itemCount: number;
  sizeKB: number;
  keys: string[];
  risk: 'low';
}

export interface IndexedDBResult {
  available: boolean;
  databases: string[];
  estimatedSizeMB: number;
  hasTracking: boolean;
  trackingDatabases: string[];
  risk: 'high' | 'medium' | 'low';
}

export interface CacheStorageResult {
  serviceWorkerActive: boolean;
  cacheAvailable: boolean;
  cacheNames: string[];
  estimatedSizeMB: number;
  risk: 'low' | 'medium';
}

export interface StorageQuotaResult {
  quota: number;
  usage: number;
  percentUsed: number;
  available: boolean;
}

export interface PersistenceResult {
  isPersistent: boolean;
  canRequestPersistence: boolean;
}

export interface AllStorageResult {
  cookies: CookiesResult;
  localStorage: LocalStorageResult;
  sessionStorage: SessionStorageResult;
  indexedDB: IndexedDBResult;
  cacheStorage: CacheStorageResult;
  storageQuota: StorageQuotaResult;
  persistence: PersistenceResult;
  overallRisk: 'high' | 'medium' | 'low';
  totalTrackingItems: number;
}

// ==================== Helper Functions ====================

function isTrackingKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return TRACKING_KEYS.some(tracker => lowerKey.includes(tracker));
}

function isTrackingDatabase(name: string): boolean {
  const lowerName = name.toLowerCase();
  return TRACKING_DATABASES.some(tracker => lowerName.includes(tracker));
}

function calculateStringSize(str: string): number {
  // UTF-16 encoding: 2 bytes per character
  return new Blob([str]).size;
}

// ==================== Detection Functions ====================

/**
 * Detect cookies for the current domain
 */
export function detectCookies(): CookiesResult {
  try {
    // Check if cookies are enabled
    const enabled = navigator.cookieEnabled;
    
    if (!enabled) {
      return {
        enabled: false,
        count: 0,
        thirdParty: 0,
        names: [],
        risk: 'low',
      };
    }

    // Parse document.cookie
    const cookieString = document.cookie;
    const cookies = cookieString ? cookieString.split(';').map(c => c.trim()) : [];
    const names = cookies
      .map(c => c.split('=')[0])
      .filter(name => name.length > 0);

    // Count potential third-party cookies (simplified heuristic)
    // In reality, we can only see first-party cookies from JS
    // Third-party detection would require server-side analysis
    const trackingCookies = names.filter(name => isTrackingKey(name));
    const thirdParty = trackingCookies.length;

    // Risk assessment
    let risk: 'high' | 'medium' | 'low' = 'low';
    if (names.length > 20 || thirdParty > 5) {
      risk = 'high';
    } else if (names.length > 10 || thirdParty > 2) {
      risk = 'medium';
    }

    return {
      enabled,
      count: names.length,
      thirdParty,
      names,
      risk,
    };
  } catch (error) {
    console.error('Cookie detection failed:', error);
    return {
      enabled: false,
      count: 0,
      thirdParty: 0,
      names: [],
      risk: 'low',
    };
  }
}

/**
 * Detect localStorage availability and contents
 */
export function detectLocalStorage(): LocalStorageResult {
  try {
    // Test if localStorage is available
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);

    const keys: string[] = [];
    let totalSize = 0;
    const trackingKeys: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        keys.push(key);
        
        // Calculate size (key + value)
        const value = localStorage.getItem(key) || '';
        totalSize += calculateStringSize(key) + calculateStringSize(value);

        // Check for tracking
        if (isTrackingKey(key)) {
          trackingKeys.push(key);
        }
      }
    }

    const sizeKB = Math.round(totalSize / 1024 * 100) / 100;
    const hasTracking = trackingKeys.length > 0;

    // Risk assessment
    let risk: 'high' | 'medium' | 'low' = 'low';
    if (trackingKeys.length > 5 || sizeKB > 1000) {
      risk = 'high';
    } else if (hasTracking || sizeKB > 500) {
      risk = 'medium';
    }

    return {
      available: true,
      itemCount: keys.length,
      sizeKB,
      keys,
      hasTracking,
      trackingKeys,
      risk,
    };
  } catch (error) {
    return {
      available: false,
      itemCount: 0,
      sizeKB: 0,
      keys: [],
      hasTracking: false,
      trackingKeys: [],
      risk: 'low',
    };
  }
}

/**
 * Detect sessionStorage availability and contents
 */
export function detectSessionStorage(): SessionStorageResult {
  try {
    // Test if sessionStorage is available
    const testKey = '__session_test__';
    sessionStorage.setItem(testKey, testKey);
    sessionStorage.removeItem(testKey);

    const keys: string[] = [];
    let totalSize = 0;

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) {
        keys.push(key);
        const value = sessionStorage.getItem(key) || '';
        totalSize += calculateStringSize(key) + calculateStringSize(value);
      }
    }

    const sizeKB = Math.round(totalSize / 1024 * 100) / 100;

    return {
      available: true,
      itemCount: keys.length,
      sizeKB,
      keys,
      risk: 'low', // Session storage is always low risk (cleared on tab close)
    };
  } catch (error) {
    return {
      available: false,
      itemCount: 0,
      sizeKB: 0,
      keys: [],
      risk: 'low',
    };
  }
}

/**
 * Detect IndexedDB databases
 */
export async function detectIndexedDB(): Promise<IndexedDBResult> {
  try {
    if (!('indexedDB' in window)) {
      return {
        available: false,
        databases: [],
        estimatedSizeMB: 0,
        hasTracking: false,
        trackingDatabases: [],
        risk: 'low',
      };
    }

    // Get database names (may not be available in all browsers)
    let databases: string[] = [];
    let estimatedSizeMB = 0;

    if ('databases' in indexedDB) {
      try {
        const dbs = await (indexedDB as any).databases();
        databases = dbs.map((db: { name: string }) => db.name || 'unknown');
      } catch {
        // databases() not supported
      }
    }

    // Try to estimate storage using Storage API
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        // This is total usage, not just IndexedDB
        estimatedSizeMB = Math.round((estimate.usage || 0) / 1024 / 1024 * 100) / 100;
      } catch {
        // Estimate not available
      }
    }

    // Detect tracking databases
    const trackingDatabases = databases.filter(name => isTrackingDatabase(name));
    const hasTracking = trackingDatabases.length > 0;

    // Risk assessment
    let risk: 'high' | 'medium' | 'low' = 'low';
    if (hasTracking || databases.length > 10) {
      risk = 'high';
    } else if (databases.length > 5 || estimatedSizeMB > 100) {
      risk = 'medium';
    }

    return {
      available: true,
      databases,
      estimatedSizeMB,
      hasTracking,
      trackingDatabases,
      risk,
    };
  } catch (error) {
    console.error('IndexedDB detection failed:', error);
    return {
      available: false,
      databases: [],
      estimatedSizeMB: 0,
      hasTracking: false,
      trackingDatabases: [],
      risk: 'low',
    };
  }
}

/**
 * Detect Cache Storage and Service Workers
 */
export async function detectCacheStorage(): Promise<CacheStorageResult> {
  try {
    // Check Service Worker registration
    let serviceWorkerActive = false;
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      serviceWorkerActive = registrations.length > 0;
    }

    // Check Cache API
    let cacheAvailable = false;
    let cacheNames: string[] = [];
    let estimatedSizeMB = 0;

    if ('caches' in window) {
      cacheAvailable = true;
      
      try {
        const names = await caches.keys();
        cacheNames = names;

        // Estimate cache size (rough calculation)
        for (const name of names) {
          try {
            const cache = await caches.open(name);
            const requests = await cache.keys();
            // Rough estimate: each cached item ~50KB average
            estimatedSizeMB += (requests.length * 50) / 1024;
          } catch {
            // Can't access this cache
          }
        }
        estimatedSizeMB = Math.round(estimatedSizeMB * 100) / 100;
      } catch {
        // Can't enumerate caches
      }
    }

    // Risk: Service workers can intercept requests
    const risk: 'low' | 'medium' = serviceWorkerActive ? 'medium' : 'low';

    return {
      serviceWorkerActive,
      cacheAvailable,
      cacheNames,
      estimatedSizeMB,
      risk,
    };
  } catch (error) {
    console.error('Cache storage detection failed:', error);
    return {
      serviceWorkerActive: false,
      cacheAvailable: false,
      cacheNames: [],
      estimatedSizeMB: 0,
      risk: 'low',
    };
  }
}

/**
 * Detect storage quota and usage
 */
export async function detectStorageQuota(): Promise<StorageQuotaResult> {
  try {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return {
        quota: 0,
        usage: 0,
        percentUsed: 0,
        available: false,
      };
    }

    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota || 0;
    const usage = estimate.usage || 0;
    const percentUsed = quota > 0 ? Math.round((usage / quota) * 100 * 100) / 100 : 0;

    return {
      quota,
      usage,
      percentUsed,
      available: true,
    };
  } catch (error) {
    console.error('Storage quota detection failed:', error);
    return {
      quota: 0,
      usage: 0,
      percentUsed: 0,
      available: false,
    };
  }
}

/**
 * Check storage persistence status
 */
export async function detectPersistence(): Promise<PersistenceResult> {
  try {
    if (!('storage' in navigator) || !('persisted' in navigator.storage)) {
      return {
        isPersistent: false,
        canRequestPersistence: false,
      };
    }

    const isPersistent = await navigator.storage.persisted();
    const canRequestPersistence = 'persist' in navigator.storage;

    return {
      isPersistent,
      canRequestPersistence,
    };
  } catch (error) {
    console.error('Persistence detection failed:', error);
    return {
      isPersistent: false,
      canRequestPersistence: false,
    };
  }
}

/**
 * Detect all storage mechanisms
 */
export async function detectAllStorage(): Promise<AllStorageResult> {
  // Run all detections in parallel where possible
  const [
    cookies,
    localStorage,
    sessionStorage,
    indexedDB,
    cacheStorage,
    storageQuota,
    persistence,
  ] = await Promise.all([
    Promise.resolve(detectCookies()),
    Promise.resolve(detectLocalStorage()),
    Promise.resolve(detectSessionStorage()),
    detectIndexedDB(),
    detectCacheStorage(),
    detectStorageQuota(),
    detectPersistence(),
  ]);

  // Calculate total tracking items
  const totalTrackingItems = 
    cookies.thirdParty +
    localStorage.trackingKeys.length +
    indexedDB.trackingDatabases.length;

  // Overall risk assessment
  let overallRisk: 'high' | 'medium' | 'low' = 'low';
  
  const risks = [
    cookies.risk,
    localStorage.risk,
    indexedDB.risk,
    cacheStorage.risk,
  ];

  if (risks.includes('high') || totalTrackingItems > 5) {
    overallRisk = 'high';
  } else if (risks.includes('medium') || totalTrackingItems > 2) {
    overallRisk = 'medium';
  }

  return {
    cookies,
    localStorage,
    sessionStorage,
    indexedDB,
    cacheStorage,
    storageQuota,
    persistence,
    overallRisk,
    totalTrackingItems,
  };
}

/**
 * Clear all possible storage (with user consent)
 * Returns summary of what was cleared
 */
export async function clearAllStorage(): Promise<{
  clearedCookies: number;
  clearedLocalStorage: number;
  clearedSessionStorage: number;
  clearedCaches: number;
  clearedIndexedDBs: number;
  unregisteredServiceWorkers: number;
  errors: string[];
}> {
  const result = {
    clearedCookies: 0,
    clearedLocalStorage: 0,
    clearedSessionStorage: 0,
    clearedCaches: 0,
    clearedIndexedDBs: 0,
    unregisteredServiceWorkers: 0,
    errors: [] as string[],
  };

  // Clear cookies (only first-party accessible ones)
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const name = cookie.split('=')[0].trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        result.clearedCookies++;
      }
    }
  } catch (e) {
    result.errors.push('Failed to clear some cookies');
  }

  // Clear localStorage
  try {
    const count = localStorage.length;
    localStorage.clear();
    result.clearedLocalStorage = count;
  } catch (e) {
    result.errors.push('Failed to clear localStorage');
  }

  // Clear sessionStorage
  try {
    const count = sessionStorage.length;
    sessionStorage.clear();
    result.clearedSessionStorage = count;
  } catch (e) {
    result.errors.push('Failed to clear sessionStorage');
  }

  // Clear cache storage
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      for (const name of names) {
        await caches.delete(name);
        result.clearedCaches++;
      }
    }
  } catch (e) {
    result.errors.push('Failed to clear cache storage');
  }

  // Clear IndexedDB databases
  try {
    if ('indexedDB' in window && indexedDB.databases) {
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(db.name!);
            request.onsuccess = () => {
              result.clearedIndexedDBs++;
              resolve();
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
              // Database is in use, still count as attempted
              result.errors.push(`IndexedDB "${db.name}" is blocked`);
              resolve();
            };
          });
        }
      }
    }
  } catch (e) {
    result.errors.push('Failed to clear IndexedDB');
  }

  // Unregister service workers
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        const success = await registration.unregister();
        if (success) {
          result.unregisteredServiceWorkers++;
        }
      }
    }
  } catch (e) {
    result.errors.push('Failed to unregister service workers');
  }

  return result;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
