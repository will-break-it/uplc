import { useState, useEffect, useRef } from 'react';
import type { AnalysisResult } from '../lib/analyzer';
import { analyzeScript } from '../lib/analyzer';

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
  { hash: '96f5c1bee23481335ff4aece32fe1dfa1aa40a944a66d2d6edc9a9a5', label: 'Unknown #9', category: 'Unknown', color: '#6b7280' },
  { hash: 'cb684a69e78907a9796b21fc150a758af5f2805e5ed5d5a8ce9f76f1', label: 'Unknown #21', category: 'Unknown', color: '#6b7280' },
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
  tree: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v18M3 9h18M6 15h12" />
    </svg>
  ),
  data: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
};

export default function ScriptAnalyzer() {
  const [scriptHash, setScriptHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'builtins' | 'uplc' | 'errors' | 'constants' | 'raw'>('overview');
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

  useEffect(() => {
    const path = window.location.pathname;
    const hashMatch = path.match(/^\/([a-f0-9]{56})$/i);
    if (hashMatch) {
      analyze(hashMatch[1]);
    }
    
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

    window.history.pushState({}, '', `/?hash=${targetHash}`);

    try {
      const analysisResult = await analyzeScript(targetHash);
      setResult(analysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze script');
    } finally {
      setLoading(false);
    }
  };

  function getBuiltinCategory(name: string): string {
    const categories: Record<string, string> = {
      addInteger: 'Arithmetic',
      subtractInteger: 'Arithmetic',
      multiplyInteger: 'Arithmetic',
      divideInteger: 'Arithmetic',
      quotientInteger: 'Arithmetic',
      remainderInteger: 'Arithmetic',
      modInteger: 'Arithmetic',
      equalsInteger: 'Comparison',
      lessThanInteger: 'Comparison',
      lessThanEqualsInteger: 'Comparison',
      equalsByteString: 'Comparison',
      lessThanByteString: 'Comparison',
      appendByteString: 'ByteString',
      consByteString: 'ByteString',
      sha2_256: 'Crypto',
      sha3_256: 'Crypto',
      blake2b_256: 'Crypto',
      verifyEd25519Signature: 'Crypto',
      verifyEcdsaSecp256k1Signature: 'Crypto',
      ifThenElse: 'Control',
      chooseUnit: 'Control',
      chooseList: 'Control',
      chooseData: 'Control',
      trace: 'Debug',
      fstPair: 'Tuple',
      sndPair: 'Tuple',
      mkPairData: 'Tuple',
      headList: 'List',
      tailList: 'List',
      nullList: 'List',
      mkCons: 'List',
      mkNilData: 'List',
      mkNilPairData: 'List',
      constrData: 'Data',
      mapData: 'Data',
      listData: 'Data',
      iData: 'Data',
      bData: 'Data',
      unConstrData: 'Data',
      unMapData: 'Data',
      unListData: 'Data',
      unIData: 'Data',
      unBData: 'Data',
      equalsData: 'Data',
      serialiseData: 'Data',
    };
    return categories[name] || 'Other';
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
          <p>Fetching from Koios API and decoding UPLC...</p>
        </div>
      )}

      {result && (
        <div className="docs-layout">
          {/* Sidebar Navigation */}
          <aside className="docs-sidebar">
            <h4>Contents</h4>
            <nav>
              <a href="#overview" className={activeTab === 'overview' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('overview'); }}>
                {Icons.hex}
                <span>Overview</span>
              </a>
              <a href="#builtins" className={activeTab === 'builtins' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('builtins'); }}>
                {Icons.tool}
                <span>Builtins</span>
                <span className="badge-small">{result.stats.uniqueBuiltins}</span>
              </a>
              <a href="#uplc" className={activeTab === 'uplc' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('uplc'); }}>
                {Icons.tree}
                <span>UPLC Code</span>
              </a>
              <a href="#errors" className={activeTab === 'errors' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('errors'); }}>
                {Icons.alert}
                <span>Trace Strings</span>
                <span className="badge-small">{result.errorMessages.length}</span>
              </a>
              <a href="#constants" className={activeTab === 'constants' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('constants'); }}>
                {Icons.data}
                <span>Constants</span>
              </a>
              <a href="#raw" className={activeTab === 'raw' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('raw'); }}>
                {Icons.hex}
                <span>Raw CBOR</span>
              </a>
            </nav>
          </aside>

          {/* Mobile Navigation */}
          <div className="docs-mobile-nav">
            <select value={activeTab} onChange={(e) => setActiveTab(e.target.value as any)}>
              <option value="overview">Overview</option>
              <option value="builtins">Builtins ({result.stats.uniqueBuiltins})</option>
              <option value="uplc">UPLC Code</option>
              <option value="errors">Trace Strings ({result.errorMessages.length})</option>
              <option value="constants">Constants</option>
              <option value="raw">Raw CBOR</option>
            </select>
          </div>

          {/* Main Content */}
          <main className="docs-content">
            {activeTab === 'overview' && (
              <section className="docs-section" id="overview">
                <h2>{Icons.hex} Overview</h2>
                <div className="docs-meta-grid">
                  <div className="docs-meta-item">
                    <div className="label">Script Hash</div>
                    <div className="value hash">{result.scriptInfo.scriptHash}</div>
                  </div>
                  <div className="docs-meta-item">
                    <div className="label">Type</div>
                    <div className="value">{result.scriptInfo.type}</div>
                  </div>
                  <div className="docs-meta-item">
                    <div className="label">Size</div>
                    <div className="value">{result.scriptInfo.size.toLocaleString()} bytes</div>
                  </div>
                  <div className="docs-meta-item">
                    <div className="label">UPLC Version</div>
                    <div className="value">{result.version}</div>
                  </div>
                </div>
                
                <h3>Classification</h3>
                <div className="classification-badge">
                  {result.classification}
                </div>
                
                <h3>Statistics</h3>
                <div className="stats-grid">
                  <div className="stat">
                    <div className="stat-value">{result.stats.uniqueBuiltins}</div>
                    <div className="stat-label">Unique Builtins</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{result.stats.totalBuiltins}</div>
                    <div className="stat-label">Total Builtin Calls</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{result.stats.lambdaCount}</div>
                    <div className="stat-label">Lambdas</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{result.stats.applicationCount}</div>
                    <div className="stat-label">Applications</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{result.stats.forceCount}</div>
                    <div className="stat-label">Force</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{result.stats.delayCount}</div>
                    <div className="stat-label">Delay</div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'builtins' && (
              <section className="docs-section" id="builtins">
                <h2>{Icons.tool} Builtin Functions</h2>
                <p>
                  Plutus builtins extracted from the decoded UPLC AST. Higher counts indicate core logic patterns.
                </p>
                {Object.keys(result.builtins).length > 0 ? (
                  <table className="builtin-table">
                    <thead>
                      <tr>
                        <th>Function</th>
                        <th>Count</th>
                        <th>Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.builtins)
                        .sort((a, b) => (b[1] as number) - (a[1] as number))
                        .map(([name, count]) => (
                          <tr key={name}>
                            <td><code>{name}</code></td>
                            <td className="count">{count as number}</td>
                            <td className="category">{getBuiltinCategory(name)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <p>No builtins detected (may be a minimal script)</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'uplc' && (
              <section className="docs-section" id="uplc">
                <h2>{Icons.tree} Decoded UPLC</h2>
                <p>
                  The actual UPLC abstract syntax tree decoded from flat encoding.
                </p>
                <div className="code-section">
                  <button 
                    className="copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(result.uplcPreview);
                      const btn = document.querySelector('#uplc .copy-btn') as HTMLButtonElement;
                      if (btn) {
                        btn.textContent = 'Copied!';
                        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                      }
                    }}
                  >
                    Copy
                  </button>
                  <div className="code-block uplc-code" style={{ maxHeight: '600px' }}>
                    <pre>{result.uplcPreview}</pre>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'errors' && (
              <section className="docs-section" id="errors">
                <h2>{Icons.alert} Trace Strings</h2>
                <p>
                  Human-readable strings embedded in the contract — typically used for <code>trace</code> calls and validation error messages.
                </p>
                {result.errorMessages.length > 0 ? (
                  <div>
                    {result.errorMessages.map((msg: string, i: number) => (
                      <div key={i} className="error-item">
                        {Icons.code}
                        <span>{msg}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>No readable strings found in bytecode</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'constants' && (
              <section className="docs-section" id="constants">
                <h2>{Icons.data} Constants</h2>
                <p>
                  Literal values embedded in the UPLC bytecode.
                </p>
                
                <h3>Integers</h3>
                {result.constants.integers.length > 0 ? (
                  <div className="constants-list">
                    {result.constants.integers.map((val, i) => (
                      <code key={i} className="constant-item">{val}</code>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No integer constants found</p>
                )}
                
                <h3>Bytestrings</h3>
                {result.constants.bytestrings.length > 0 ? (
                  <div className="constants-list">
                    {result.constants.bytestrings.map((val, i) => (
                      <code key={i} className="constant-item bytestring">#{val}</code>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No bytestring constants found</p>
                )}
              </section>
            )}

            {activeTab === 'raw' && (
              <section className="docs-section" id="raw">
                <h2>{Icons.hex} Raw CBOR</h2>
                <p>
                  The complete script bytecode in hexadecimal format.
                </p>
                <div className="code-section">
                  <button 
                    className="copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(result.scriptInfo.bytes);
                      const btn = document.querySelector('#raw .copy-btn') as HTMLButtonElement;
                      if (btn) {
                        btn.textContent = 'Copied!';
                        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                      }
                    }}
                  >
                    Copy
                  </button>
                  <div className="code-block" style={{ maxHeight: '500px' }}>
                    <pre style={{ wordBreak: 'break-all' }}>{result.scriptInfo.bytes}</pre>
                  </div>
                </div>
                <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}>
                  <strong>{result.scriptInfo.bytes.length.toLocaleString()}</strong> hex characters 
                  (<strong>{(result.scriptInfo.bytes.length / 2).toLocaleString()}</strong> bytes)
                </p>
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
