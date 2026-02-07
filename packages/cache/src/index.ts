/**
 * @uplc/cache - Caching Layer
 *
 * Provides LRU in-memory caching and Cloudflare KV integration
 */

import type { UplcTerm } from '@uplc/parser';
import type { ContractStructure } from '@uplc/patterns';

/**
 * Unified cache entry combining all analysis results
 */
export interface UnifiedCacheEntry {
  version: '1.0';
  scriptHash: string;
  timestamp: number;

  // Raw data
  cbor: string;
  uplcText: string;
  plutusVersion: string;
  scriptType: string;
  scriptSize: number;

  // Analysis
  builtins: Record<string, number>;
  errorMessages: string[];
  constants: any;
  classification: string;
  stats: any;

  // Decompilation
  decompiled: {
    aikenCode: string;
    scriptPurpose: string;
    params: string[];
    datumUsed: boolean;
    datumFields: number;
    redeemerVariants: number;
    validationChecks: number;
    error?: string;
  };

  // AI Enhancements (null if failed or unavailable)
  enhancements: {
    naming: Record<string, string>;
    annotations: string[];
    diagram: string;
  } | null;
}

// Cloudflare KV type (will be available at runtime in CF Workers/Pages)
interface KVNamespace {
  get(key: string, type?: string): Promise<any>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Simple LRU Cache implementation
 */
export class LRUCache<K, V> {
  private cache: Map<K, { value: V; timestamp: number }>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });

    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Multi-layer cache for UPLC decompilation
 */
export class DecompilerCache {
  private astCache: LRUCache<string, UplcTerm>;
  private patternCache: LRUCache<string, ContractStructure>;
  private unifiedCache: LRUCache<string, UnifiedCacheEntry>;
  private kvNamespace?: KVNamespace;

  constructor(kvNamespace?: KVNamespace) {
    this.astCache = new LRUCache<string, UplcTerm>(50);
    this.patternCache = new LRUCache<string, ContractStructure>(50);
    this.unifiedCache = new LRUCache<string, UnifiedCacheEntry>(100);
    this.kvNamespace = kvNamespace;
  }

  /**
   * Get parsed AST from cache
   */
  async getAST(scriptHash: string): Promise<UplcTerm | null> {
    // Check memory cache first
    const cached = this.astCache.get(scriptHash);
    if (cached) return cached;

    // Check KV
    if (this.kvNamespace) {
      const kvCached = await this.kvNamespace.get(`ast:${scriptHash}`, 'json');
      if (kvCached) {
        const ast = kvCached as UplcTerm;
        this.astCache.set(scriptHash, ast);
        return ast;
      }
    }

    return null;
  }

  /**
   * Set parsed AST in cache
   */
  async setAST(scriptHash: string, ast: UplcTerm): Promise<void> {
    this.astCache.set(scriptHash, ast);

    // Store in KV with 24h TTL
    if (this.kvNamespace) {
      await this.kvNamespace.put(`ast:${scriptHash}`, JSON.stringify(ast), {
        expirationTtl: 86400, // 24 hours
      });
    }
  }

  /**
   * Get pattern analysis from cache
   */
  async getPattern(scriptHash: string): Promise<ContractStructure | null> {
    // Check memory cache first
    const cached = this.patternCache.get(scriptHash);
    if (cached) return cached;

    // Check KV
    if (this.kvNamespace) {
      const kvCached = await this.kvNamespace.get(`pattern:${scriptHash}`, 'json');
      if (kvCached) {
        const pattern = kvCached as ContractStructure;
        this.patternCache.set(scriptHash, pattern);
        return pattern;
      }
    }

    return null;
  }

  /**
   * Set pattern analysis in cache
   */
  async setPattern(scriptHash: string, pattern: ContractStructure): Promise<void> {
    this.patternCache.set(scriptHash, pattern);

    // Store in KV with 24h TTL
    if (this.kvNamespace) {
      // Remove circular references before storing
      const cleanPattern = JSON.parse(JSON.stringify(pattern, (key, value) => {
        if (key === 'rawBody') return undefined; // Skip raw AST
        return value;
      }));

      await this.kvNamespace.put(`pattern:${scriptHash}`, JSON.stringify(cleanPattern), {
        expirationTtl: 86400,
      });
    }
  }

  /**
   * Get unified analysis result from cache
   */
  async getUnified(scriptHash: string): Promise<UnifiedCacheEntry | null> {
    // Check memory cache first
    const cached = this.unifiedCache.get(scriptHash);
    if (cached) return cached;

    // Check KV
    if (this.kvNamespace) {
      const kvCached = await this.kvNamespace.get(`script:v1:${scriptHash}`, 'json');
      if (kvCached) {
        const entry = kvCached as UnifiedCacheEntry;
        this.unifiedCache.set(scriptHash, entry);
        return entry;
      }
    }

    return null;
  }

  /**
   * Set unified analysis result in cache
   */
  async setUnified(entry: UnifiedCacheEntry): Promise<void> {
    this.unifiedCache.set(entry.scriptHash, entry);

    // Store in KV with 24h TTL
    if (this.kvNamespace) {
      await this.kvNamespace.put(
        `script:v1:${entry.scriptHash}`,
        JSON.stringify(entry),
        {
          expirationTtl: 86400, // 24 hours
        }
      );
    }
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.astCache.clear();
    this.patternCache.clear();
    this.unifiedCache.clear();
  }
}

/**
 * Singleton cache instance for use in Cloudflare Workers/Pages
 */
let globalCache: DecompilerCache | null = null;

export function getGlobalCache(kvNamespace?: KVNamespace): DecompilerCache {
  if (!globalCache) {
    globalCache = new DecompilerCache(kvNamespace);
  }
  return globalCache;
}
