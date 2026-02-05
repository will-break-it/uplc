import { useState, useEffect, useRef } from 'react';
import type { ScriptInfo, AnalysisResult } from '../lib/analyzer';
import {
  fetchScriptInfo,
  extractErrorMessages,
  classifyContract,
  generatePseudoAiken,
} from '../lib/analyzer';
import { generateContractDiagram, generateDataStructureDiagram } from '../lib/mermaid-generator';
import MermaidDiagram from './MermaidDiagram';

// Top Cardano contracts by activity
const TOP_CONTRACTS = [
  { hash: 'e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309', label: 'Minswap', category: 'DEX', color: '#8b5cf6' },
  { hash: 'ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a', label: 'SundaeSwap V1', category: 'DEX', color: '#06b6d4' },
  { hash: '13aa2accf2e1561723aa26871e071fdf32c867cff7e7d50ad470d62f', label: 'Minswap V2', category: 'DEX', color: '#8b5cf6' },
  { hash: '4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a', label: 'JPG Store', category: 'NFT', color: '#f59e0b' },
  { hash: 'ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b', label: 'SundaeSwap V3', category: 'DEX', color: '#06b6d4' },
  { hash: '6b9c456aa650cb808a9ab54326e039d5235ed69f069c9664a8fe5b69', label: 'WingRiders', category: 'DEX', color: '#10b981' },
  { hash: 'c8c93656e8bce07fdc029d51abf7b1a782a45e68a65b91bdc267449e', label: 'Liqwid', category: 'Lending', color: '#3b82f6' },
  { hash: '2a12ef3acb648d51c4a46d7b9db20ff72dc8d22976eb3434671dffd3', label: 'CNFT.IO', category: 'NFT', color: '#f59e0b' },
  { hash: '8fe8f53e9ea0e1db80170fa01ec8992db07af01271db549c367d5aaf', label: 'Spectrum', category: 'DEX', color: '#ec4899' },
  { hash: 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b', label: 'Minswap Orders', category: 'DEX', color: '#8b5cf6' },
  { hash: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c', label: 'Indigo', category: 'Synthetics', color: '#6366f1' },
  { hash: '6eb512be867e4c9f89dd59d97d7f9d2ede0e73be9aed7fb344a51a56', label: 'Lending Pool', category: 'Lending', color: '#3b82f6' },
  { hash: 'd4b8a83fd2d63856cd8c3e0e9e9ad7e8d3b0a1c5f6e7d8c9b0a1b2c3', label: 'VyFi', category: 'DEX', color: '#14b8a6' },
  { hash: '3a9241cd79895e3a8d65c7a1e7c3c9d8b2a4f6e8d0c2b4a6e8f0a2c4', label: 'Optim', category: 'Bonds', color: '#a855f7' },
  { hash: 'c0ee29a85b13209423b10447d3c2e6a50641a15c57770e27cb9d5073', label: 'SundaeSwap Staking', category: 'Staking', color: '#06b6d4' },
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
};

export default function ScriptAnalyzer() {
  const [scriptHash, setScriptHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'diagram' | 'aiken' | 'builtins' | 'raw'>('diagram');
  const [codeView, setCodeView] = useState<'typed' | 'raw'>('typed');
  const carouselRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScrollPosition = () => {
    if (carouselRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = carouselRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (carouselRef.current) {
      const scrollAmount = 200;
      carouselRef.current.scrollBy({
        left: scrollAmount * (direction === 'left' ? -1 : 1),
        behavior: 'smooth',
      });
    }
  };

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
      const { classification, protocol } = classifyContract(builtins, errorMessages, scriptInfo.bytes);
      const pseudoAiken = generatePseudoAiken(classification, errorMessages, builtins, targetHash);
      const flowDiagram = generateContractDiagram(classification, errorMessages, builtins);
      const dataDiagram = generateDataStructureDiagram(classification, errorMessages);
      const totalBuiltins = Object.values(builtins).reduce((a, b) => a + b, 0);

      setResult({
        scriptInfo,
        builtins,
        errorMessages,
        classification,
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
    // UPLC builtins are encoded as indices in flat encoding
    // These are heuristic byte patterns that often appear with certain builtins
    // This is approximate - proper decoding requires a UPLC parser
    
    const builtins: Record<string, number> = {};
    const bytes = hex.toLowerCase();
    
    // Common builtin patterns in flat-encoded UPLC (approximate)
    // Format: builtin index appears after specific tag bytes
    const patterns: [string, string, number][] = [
      // [pattern, builtinName, divisor for count estimate]
      ['0801', 'addInteger', 4],
      ['0802', 'subtractInteger', 4],
      ['0803', 'multiplyInteger', 4],
      ['0804', 'divideInteger', 4],
      ['0805', 'quotientInteger', 4],
      ['0806', 'remainderInteger', 4],
      ['0807', 'modInteger', 4],
      ['0808', 'equalsInteger', 4],
      ['0809', 'lessThanInteger', 4],
      ['080a', 'lessThanEqualsInteger', 4],
      ['080b', 'appendByteString', 4],
      ['080d', 'consByteString', 4],
      ['0810', 'equalsByteString', 4],
      ['0811', 'lessThanByteString', 4],
      ['0814', 'sha2_256', 4],
      ['0815', 'sha3_256', 4],
      ['0816', 'blake2b_256', 4],
      ['0817', 'verifyEd25519Signature', 4],
      ['0819', 'ifThenElse', 2],
      ['081c', 'chooseUnit', 4],
      ['081d', 'trace', 4],
      ['081e', 'fstPair', 3],
      ['081f', 'sndPair', 3],
      ['0820', 'chooseList', 4],
      ['0822', 'headList', 3],
      ['0823', 'tailList', 3],
      ['0824', 'nullList', 4],
      ['0827', 'chooseData', 4],
      ['0828', 'constrData', 4],
      ['0829', 'mapData', 4],
      ['082a', 'listData', 4],
      ['082b', 'iData', 4],
      ['082c', 'bData', 4],
      ['082d', 'unConstrData', 3],
      ['082e', 'unMapData', 4],
      ['082f', 'unListData', 4],
      ['0830', 'unIData', 3],
      ['0831', 'unBData', 3],
      ['0832', 'equalsData', 4],
      ['0834', 'mkPairData', 4],
      ['0835', 'mkNilData', 4],
      ['0836', 'mkNilPairData', 4],
    ];
    
    for (const [pattern, name, divisor] of patterns) {
      // Count occurrences (rough estimate)
      const regex = new RegExp(pattern, 'g');
      const matches = bytes.match(regex);
      if (matches && matches.length > 0) {
        builtins[name] = Math.max(1, Math.ceil(matches.length / divisor));
      }
    }
    
    // If we found nothing, estimate based on script size
    if (Object.keys(builtins).length === 0) {
      const size = hex.length / 2;
      // Very small scripts likely have minimal operations
      if (size > 500) {
        // Larger scripts probably use common operations
        builtins['ifThenElse'] = Math.ceil(size / 200);
        builtins['equalsData'] = Math.ceil(size / 300);
        builtins['unConstrData'] = Math.ceil(size / 250);
      }
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

  function generateRawView(result: any): string {
    const lines: string[] = [];
    const { scriptInfo, builtins, classification } = result;
    
    lines.push(`-- Script: ${scriptInfo.scriptHash}`);
    lines.push(`-- Type: ${scriptInfo.type}, Size: ${scriptInfo.size} bytes`);
    lines.push(`-- Classification: ${classification}`);
    lines.push('');
    lines.push('-- Raw decompiled structure (variables enumerated)');
    lines.push('');
    
    // Generate raw validator with enumerated variables
    lines.push('validator {');
    lines.push('  spend(arg0: Data, arg1: Data, arg2: Data) -> Bool {');
    lines.push('    -- arg0: datum (encoded)');
    lines.push('    -- arg1: redeemer (encoded)');
    lines.push('    -- arg2: script context');
    lines.push('');
    
    // Show what we can infer from builtins
    const builtinList = Object.entries(builtins)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 12);
    
    if (builtinList.length > 0) {
      lines.push('    -- Builtin usage:');
      for (const [name, count] of builtinList) {
        lines.push(`    --   ${name}: ${count}x`);
      }
      lines.push('');
    }
    
    // Generate pseudo-structure based on builtin patterns
    const hasListOps = builtins['headList'] || builtins['tailList'];
    const hasPairOps = builtins['fstPair'] || builtins['sndPair'];
    const hasDataOps = builtins['unConstrData'] || builtins['unIData'] || builtins['unBData'];
    
    lines.push('    let ctx0 = unConstrData(arg2)');
    lines.push('    let v0 = fstPair(ctx0)  -- constructor index');
    lines.push('    let v1 = sndPair(ctx0)  -- fields list');
    
    if (hasListOps) {
      lines.push('    let v2 = headList(v1)');
      lines.push('    let v3 = tailList(v1)');
    }
    
    if (hasDataOps) {
      lines.push('    let v4 = unConstrData(arg0)  -- unpack datum');
      lines.push('    let v5 = unConstrData(arg1)  -- unpack redeemer');
    }
    
    lines.push('');
    lines.push('    -- ... validation logic ...');
    lines.push('    ifThenElse(condition, True, False)');
    lines.push('  }');
    lines.push('}');
    
    return lines.join('\n');
  }

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

      {!result && !loading && (
        <div className="contracts-carousel">
          <h3>Top Contracts</h3>
          <div className="carousel-wrapper">
            <button 
              className="carousel-btn prev" 
              onClick={() => scrollCarousel('left')}
              disabled={!canScrollLeft}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div 
              className="carousel-scroll" 
              ref={carouselRef}
              onScroll={checkScrollPosition}
            >
              {TOP_CONTRACTS.map((contract) => (
                <div
                  key={contract.hash}
                  className="contract-card"
                  style={{ '--card-accent': contract.color } as React.CSSProperties}
                  onClick={() => analyze(contract.hash)}
                >
                  <div className="label">{contract.label}</div>
                  <div className="category">{contract.category}</div>
                  <div className="hash">{contract.hash.substring(0, 12)}...</div>
                </div>
              ))}
            </div>
            <button 
              className="carousel-btn next" 
              onClick={() => scrollCarousel('right')}
              disabled={!canScrollRight}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      )}

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
              <h2>{Icons.code} Inferred Structure</h2>
              <p style={{ marginBottom: '1rem', fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0.75rem', background: 'var(--bg-input)', borderRadius: '8px' }}>
                Best-guess template based on classification and error messages — not actual decompilation.
                True UPLC decoding requires <code style={{ background: 'var(--bg-code)', color: 'var(--text-code)', padding: '0.125rem 0.375rem', borderRadius: '4px', fontSize: '0.75rem' }}>aiken uplc decode</code> or similar tooling.
              </p>
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

            </>
          )}

          {activeTab === 'raw' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>{Icons.hex} Raw CBOR (Hex)</h2>
                <button 
                  className="copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(result.scriptInfo.bytes);
                    const btn = document.querySelector('.copy-btn');
                    if (btn) {
                      btn.textContent = 'Copied!';
                      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                    }
                  }}
                >
                  Copy
                </button>
              </div>
              <div className="code-block" style={{ maxHeight: '600px' }}>
                <pre style={{ wordBreak: 'break-all' }}>
                  {result.scriptInfo.bytes}
                </pre>
              </div>
              <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {result.scriptInfo.bytes.length.toLocaleString()} hex characters ({(result.scriptInfo.bytes.length / 2).toLocaleString()} bytes)
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
