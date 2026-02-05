import { useState } from 'react';
import type { ScriptInfo, AnalysisResult } from '../lib/analyzer';
import {
  fetchScriptInfo,
  extractErrorMessages,
  classifyContract,
  generatePseudoAiken,
} from '../lib/analyzer';
import { generateContractDiagram, generateDataStructureDiagram } from '../lib/mermaid-generator';
import MermaidDiagram from './MermaidDiagram';

// Example script hashes for quick testing
const EXAMPLES = [
  { hash: '4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a', label: 'NFT Marketplace (#4)' },
  { hash: 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b', label: 'Minswap V1 Order' },
  { hash: 'e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309', label: 'Minswap V1 Pool' },
  { hash: 'ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a', label: 'SundaeSwap V1' },
];

export default function ScriptAnalyzer() {
  const [scriptHash, setScriptHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'diagram' | 'aiken' | 'raw'>('overview');

  const analyze = async (hash?: string) => {
    const targetHash = hash || scriptHash.trim();
    if (!targetHash) return;

    // Validate hash format
    if (!/^[a-f0-9]{56}$/i.test(targetHash)) {
      setError('Invalid script hash. Must be 56 hex characters.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setScriptHash(targetHash);

    try {
      // Fetch script info from Koios
      const scriptInfo = await fetchScriptInfo(targetHash);
      
      // Extract error messages from raw bytes
      const errorMessages = extractErrorMessages(scriptInfo.bytes);
      
      // For now, we'll do basic analysis from the hex
      // In production, we'd decode the UPLC server-side
      const builtins = extractBuiltinsFromHex(scriptInfo.bytes);
      
      // Classify the contract
      const { classification, mevRisk } = classifyContract(builtins, errorMessages);
      
      // Generate pseudo-Aiken
      const pseudoAiken = generatePseudoAiken(
        classification,
        errorMessages,
        builtins,
        targetHash
      );

      const totalBuiltins = Object.values(builtins).reduce((a, b) => a + b, 0);

      // Generate diagrams
      const flowDiagram = generateContractDiagram(classification, errorMessages, builtins);
      const dataDiagram = generateDataStructureDiagram(classification, errorMessages);

      setResult({
        scriptInfo,
        builtins,
        errorMessages,
        constants: { bytestrings: [], integers: [] },
        classification,
        mevRisk,
        stats: {
          totalBuiltins,
          uniqueBuiltins: Object.keys(builtins).length,
          lambdaCount: 0, // Would need server-side UPLC decode
          forceCount: 0,
        },
        pseudoAiken,
        uplcPreview: '// UPLC decoding requires server-side processing\n// Install aiken CLI and use: aiken uplc decode <file>',
        flowDiagram,
        dataDiagram,
      } as AnalysisResult & { flowDiagram: string; dataDiagram: string });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze script');
    } finally {
      setLoading(false);
    }
  };

  // Basic builtin extraction from hex (simplified)
  function extractBuiltinsFromHex(hex: string): Record<string, number> {
    // This is a simplified version - real extraction would decode UPLC
    const text = hexToText(hex);
    const builtins: Record<string, number> = {};
    
    // Common patterns in Plutus scripts
    const knownBuiltins = [
      'ifThenElse', 'equalsInteger', 'lessThanInteger', 'lessThanEqualsInteger',
      'addInteger', 'subtractInteger', 'multiplyInteger', 'divideInteger',
      'headList', 'tailList', 'nullList', 'chooseList',
      'fstPair', 'sndPair', 'unConstrData', 'unBData', 'unIData',
      'equalsByteString', 'appendByteString', 'trace',
      'verifyEd25519Signature', 'blake2b_256', 'sha2_256',
    ];
    
    // This is a rough estimate - real analysis needs UPLC decode
    for (const b of knownBuiltins) {
      // Count approximate occurrences based on patterns
      const count = (hex.match(new RegExp(b.toLowerCase().substring(0, 6), 'gi')) || []).length;
      if (count > 0) {
        builtins[b] = Math.ceil(count / 2); // Rough estimate
      }
    }
    
    return builtins;
  }

  function hexToText(hex: string): string {
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);
      if (byte >= 32 && byte < 127) {
        result += String.fromCharCode(byte);
      }
    }
    return result;
  }

  const getRiskBadgeClass = (risk: string) => {
    switch (risk) {
      case 'HIGH': return 'badge-danger';
      case 'MEDIUM': return 'badge-warning';
      case 'LOW': return 'badge-success';
      default: return '';
    }
  };

  return (
    <div>
      {/* Search Box */}
      <div className="search-box">
        <input
          type="text"
          placeholder="Enter script hash (56 hex characters)..."
          value={scriptHash}
          onChange={(e) => setScriptHash(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && analyze()}
        />
        <button onClick={() => analyze()} disabled={loading}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {/* Example Scripts */}
      <div style={{ marginBottom: '1.5rem' }}>
        <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.hash}
            onClick={() => analyze(ex.hash)}
            className="tab"
            style={{ marginRight: '0.5rem' }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && <div className="error-message">{error}</div>}

      {/* Loading */}
      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>Fetching script from Koios API...</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Meta Info */}
          <div className="card">
            <div className="meta-info">
              <div className="meta-item">
                <span className="meta-label">Script Hash</span>
                <span className="meta-value">{result.scriptInfo.scriptHash}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Type</span>
                <span className="meta-value">{result.scriptInfo.type}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Size</span>
                <span className="meta-value">{result.scriptInfo.size.toLocaleString()} bytes</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Classification</span>
                <span className="meta-value">{result.classification}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">MEV Risk</span>
                <span className={`badge ${getRiskBadgeClass(result.mevRisk)}`}>
                  {result.mevRisk}
                </span>
              </div>
            </div>

            {/* Stats */}
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-value">{result.stats.uniqueBuiltins}</div>
                <div className="stat-label">Unique Builtins</div>
              </div>
              <div className="stat">
                <div className="stat-value">{result.errorMessages.length}</div>
                <div className="stat-label">Error Messages</div>
              </div>
              <div className="stat">
                <div className="stat-value">{result.scriptInfo.size}</div>
                <div className="stat-label">Bytes</div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              📊 Overview
            </button>
            <button
              className={`tab ${activeTab === 'diagram' ? 'active' : ''}`}
              onClick={() => setActiveTab('diagram')}
            >
              🔀 Architecture
            </button>
            <button
              className={`tab ${activeTab === 'aiken' ? 'active' : ''}`}
              onClick={() => setActiveTab('aiken')}
            >
              🦊 Pseudo-Aiken
            </button>
            <button
              className={`tab ${activeTab === 'raw' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw')}
            >
              🔧 Raw CBOR
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <>
              {/* Error Messages */}
              <div className="card">
                <h2><span className="icon">⚠️</span> Error Messages Found</h2>
                {result.errorMessages.length > 0 ? (
                  <ul className="error-list">
                    {result.errorMessages.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: 'var(--text-muted)' }}>No readable error messages found</p>
                )}
              </div>

              {/* Builtins */}
              <div className="card">
                <h2><span className="icon">🔧</span> Builtin Functions</h2>
                <div className="builtin-list">
                  {Object.entries(result.builtins)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count]) => (
                      <span key={name} className="builtin-tag">
                        {name}<span className="count">×{count}</span>
                      </span>
                    ))}
                </div>
              </div>
            </>
          )}

          {activeTab === 'diagram' && (
            <>
              <div className="card">
                <h2><span className="icon">🔀</span> Contract Flow</h2>
                <MermaidDiagram 
                  chart={(result as any).flowDiagram} 
                  id={`flow-${result.scriptInfo.scriptHash.substring(0, 8)}`} 
                />
              </div>
              <div className="card">
                <h2><span className="icon">📐</span> Data Structures</h2>
                <MermaidDiagram 
                  chart={(result as any).dataDiagram} 
                  id={`data-${result.scriptInfo.scriptHash.substring(0, 8)}`} 
                />
              </div>
            </>
          )}

          {activeTab === 'aiken' && (
            <div className="card">
              <h2><span className="icon">🦊</span> Reconstructed Pseudo-Aiken</h2>
              <div className="code-block">
                <pre>{result.pseudoAiken}</pre>
              </div>
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="card">
              <h2><span className="icon">🔧</span> Raw CBOR (Hex)</h2>
              <div className="code-block">
                <pre style={{ wordBreak: 'break-all' }}>
                  {result.scriptInfo.bytes.substring(0, 2000)}
                  {result.scriptInfo.bytes.length > 2000 && '...'}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
