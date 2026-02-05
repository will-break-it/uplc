import { useState, useEffect } from 'react';
import type { ScriptInfo, AnalysisResult } from '../lib/analyzer';
import {
  fetchScriptInfo,
  extractErrorMessages,
  classifyContract,
  generatePseudoAiken,
} from '../lib/analyzer';
import { generateContractDiagram, generateDataStructureDiagram } from '../lib/mermaid-generator';
import MermaidDiagram from './MermaidDiagram';

// Example script hashes
const EXAMPLES = [
  { hash: '4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a', label: 'NFT Marketplace' },
  { hash: 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b', label: 'Minswap V1' },
  { hash: 'ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a', label: 'SundaeSwap' },
];

// Icons as SVG components
const Icons = {
  diagram: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="8.5" y="14" width="7" height="7" rx="1" />
      <path d="M6.5 10v1.5a1 1 0 001 1h9a1 1 0 001-1V10M12 12.5V14" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16,18 22,12 16,6" />
      <polyline points="8,6 2,12 8,18" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  tool: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  hex: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
};

export default function ScriptAnalyzer() {
  const [scriptHash, setScriptHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'diagram' | 'aiken' | 'builtins' | 'raw'>('diagram');

  // Check URL for script hash on load
  useEffect(() => {
    const path = window.location.pathname;
    const hashMatch = path.match(/^\/([a-f0-9]{56})$/i);
    if (hashMatch) {
      analyze(hashMatch[1]);
    }
    
    // Also check query param
    const params = new URLSearchParams(window.location.search);
    const hashParam = params.get('hash');
    if (hashParam && /^[a-f0-9]{56}$/i.test(hashParam)) {
      analyze(hashParam);
    }
  }, []);

  const analyze = async (hash?: string) => {
    const targetHash = hash || scriptHash.trim();
    if (!targetHash) return;

    if (!/^[a-f0-9]{56}$/i.test(targetHash)) {
      setError('Invalid script hash. Must be 56 hex characters.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setScriptHash(targetHash);

    // Update URL
    window.history.pushState({}, '', `/?hash=${targetHash}`);

    try {
      const scriptInfo = await fetchScriptInfo(targetHash);
      const errorMessages = extractErrorMessages(scriptInfo.bytes);
      const builtins = extractBuiltinsFromHex(scriptInfo.bytes);
      const { classification, mevRisk } = classifyContract(builtins, errorMessages);
      const pseudoAiken = generatePseudoAiken(classification, errorMessages, builtins, targetHash);
      const flowDiagram = generateContractDiagram(classification, errorMessages, builtins);
      const dataDiagram = generateDataStructureDiagram(classification, errorMessages);
      const totalBuiltins = Object.values(builtins).reduce((a, b) => a + b, 0);

      setResult({
        scriptInfo,
        builtins,
        errorMessages,
        classification,
        mevRisk,
        stats: {
          totalBuiltins,
          uniqueBuiltins: Object.keys(builtins).length,
        },
        pseudoAiken,
        flowDiagram,
        dataDiagram,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze script');
    } finally {
      setLoading(false);
    }
  };

  function extractBuiltinsFromHex(hex: string): Record<string, number> {
    const text = hexToText(hex);
    const builtins: Record<string, number> = {};
    const knownBuiltins = [
      'ifThenElse', 'equalsInteger', 'lessThanInteger', 'lessThanEqualsInteger',
      'addInteger', 'subtractInteger', 'multiplyInteger', 'divideInteger',
      'headList', 'tailList', 'nullList', 'chooseList',
      'fstPair', 'sndPair', 'unConstrData', 'unBData', 'unIData',
      'equalsByteString', 'appendByteString', 'trace',
      'verifyEd25519Signature', 'blake2b_256', 'sha2_256',
    ];
    for (const b of knownBuiltins) {
      const count = (hex.match(new RegExp(b.toLowerCase().substring(0, 6), 'gi')) || []).length;
      if (count > 0) builtins[b] = Math.ceil(count / 2);
    }
    return builtins;
  }

  function hexToText(hex: string): string {
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);
      if (byte >= 32 && byte < 127) result += String.fromCharCode(byte);
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
      <div className="search-box">
        <input
          type="text"
          placeholder="Enter script hash (56 hex characters)"
          value={scriptHash}
          onChange={(e) => setScriptHash(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && analyze()}
        />
        <button onClick={() => analyze()} disabled={loading}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      <div className="examples">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.hash} onClick={() => analyze(ex.hash)}>
            {ex.label}
          </button>
        ))}
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>Fetching from Koios API...</p>
        </div>
      )}

      {result && (
        <>
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

          <div className="tabs">
            <button className={`tab ${activeTab === 'diagram' ? 'active' : ''}`} onClick={() => setActiveTab('diagram')}>
              Architecture
            </button>
            <button className={`tab ${activeTab === 'aiken' ? 'active' : ''}`} onClick={() => setActiveTab('aiken')}>
              Pseudo-Aiken
            </button>
            <button className={`tab ${activeTab === 'builtins' ? 'active' : ''}`} onClick={() => setActiveTab('builtins')}>
              Analysis
            </button>
            <button className={`tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => setActiveTab('raw')}>
              Raw CBOR
            </button>
          </div>

          {activeTab === 'diagram' && (
            <>
              <div className="card">
                <h2>{Icons.diagram} Contract Flow</h2>
                <MermaidDiagram chart={result.flowDiagram} id={`flow-${result.scriptInfo.scriptHash.substring(0, 8)}`} />
              </div>
              <div className="card">
                <h2>{Icons.code} Data Structures</h2>
                <MermaidDiagram chart={result.dataDiagram} id={`data-${result.scriptInfo.scriptHash.substring(0, 8)}`} />
              </div>
            </>
          )}

          {activeTab === 'aiken' && (
            <div className="card">
              <h2>{Icons.code} Reconstructed Pseudo-Aiken</h2>
              <div className="code-block">
                <pre>{result.pseudoAiken}</pre>
              </div>
            </div>
          )}

          {activeTab === 'builtins' && (
            <>
              <div className="card">
                <h2>{Icons.alert} Error Messages Found</h2>
                {result.errorMessages.length > 0 ? (
                  <ul className="error-list">
                    {result.errorMessages.map((msg: string, i: number) => (
                      <li key={i}>{Icons.alert}{msg}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: 'var(--text-muted)' }}>No readable error messages found</p>
                )}
              </div>

              <div className="card">
                <h2>{Icons.tool} Builtin Functions</h2>
                <div className="builtin-list">
                  {Object.entries(result.builtins)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count]) => (
                      <span key={name} className="builtin-tag">
                        {name}<span className="count">×{count as number}</span>
                      </span>
                    ))}
                </div>
              </div>

              <div className="card">
                <h2>{Icons.shield} MEV Risk Assessment</h2>
                <p style={{ marginBottom: '1rem' }}>
                  <span className={`badge ${getRiskBadgeClass(result.mevRisk)}`} style={{ marginRight: '0.5rem' }}>
                    {result.mevRisk}
                  </span>
                  {result.classification}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  {result.mevRisk === 'HIGH' && 'DEX contracts are susceptible to front-running, sandwich attacks, and arbitrage.'}
                  {result.mevRisk === 'MEDIUM' && 'NFT marketplaces have moderate MEV risk from sniping and sweep attacks.'}
                  {result.mevRisk === 'LOW' && 'Staking and governance contracts have minimal MEV exposure.'}
                </p>
              </div>
            </>
          )}

          {activeTab === 'raw' && (
            <div className="card">
              <h2>{Icons.hex} Raw CBOR (Hex)</h2>
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
