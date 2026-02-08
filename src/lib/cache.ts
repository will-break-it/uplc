/**
 * Browser-side caching for UPLC analysis
 * 
 * Cache layers (all immutable once computed):
 * - script:{hash} → CBOR bytes from Koios (via KV, handled server-side)
 * - analysis:{hash} → Full analysis result (builtins, constants, etc.)
 * - decompiled:{hash} → Aiken code output
 * 
 * AI-enhanced content has its own versioned cache:
 * - ai:{hash}:{version} → Architecture diagram, enhanced descriptions
 */

const CACHE_PREFIX = 'uplc_cache_v1:';
const AI_CACHE_VERSION = 'v1';  // Bump this to invalidate AI cache

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

/**
 * Get item from localStorage cache
 */
export function getCached<T>(key: string): T | null {
  if (!isBrowser) return null;
  
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Set item in localStorage cache
 */
export function setCached<T>(key: string, data: T): void {
  if (!isBrowser) return;
  
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // localStorage might be full, ignore
    console.warn('Cache write failed:', e);
  }
}

/**
 * Generate cache key for script analysis
 */
export function analysisKey(scriptHash: string): string {
  return `analysis:${scriptHash}`;
}

/**
 * Generate cache key for decompiled code
 */
export function decompiledKey(scriptHash: string): string {
  return `decompiled:${scriptHash}`;
}

/**
 * Generate cache key for AI-enhanced content
 */
export function aiKey(scriptHash: string): string {
  return `ai:${scriptHash}:${AI_CACHE_VERSION}`;
}

/**
 * Clear all cached data (for debugging/testing)
 */
export function clearCache(): void {
  if (!isBrowser) return;
  
  const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
  keys.forEach(k => localStorage.removeItem(k));
}

/**
 * Get cache stats
 */
export function getCacheStats(): { entries: number; bytes: number } {
  if (!isBrowser) return { entries: 0, bytes: 0 };
  
  const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
  let bytes = 0;
  keys.forEach(k => {
    const val = localStorage.getItem(k);
    if (val) bytes += val.length * 2; // UTF-16
  });
  
  return { entries: keys.length, bytes };
}
