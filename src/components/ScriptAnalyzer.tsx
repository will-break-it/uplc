import { useState, useEffect, useRef } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import type { AnalysisResult } from '../lib/analyzer';
import { analyzeScriptCore } from '../lib/analyzer';

// Types
interface AIAnalysis {
  aiken: string;
  mermaid?: string;
  types?: { datum: string; redeemer: string };
  cached?: boolean;
}

// Syntax-highlighted code block
function CodeBlock({ code, language = 'haskell' }: { code: string; language?: string }) {
  return (
    <Highlight theme={themes.nightOwl} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={className} style={{ ...style, background: 'transparent', margin: 0, padding: 0 }}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

// Top contracts
const TOP_CONTRACTS = [
  { hash: 'e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309', label: 'Minswap', category: 'DEX', color: '#8b5cf6' },
  { hash: 'ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a', label: 'SundaeSwap V1', category: 'DEX', color: '#06b6d4' },
  { hash: '4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a', label: 'JPG Store', category: 'NFT', color: '#f59e0b' },
  { hash: 'ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b', label: 'SundaeSwap V3', category: 'DEX', color: '#06b6d4' },
  { hash: '6b9c456aa650cb808a9ab54326e039d5235ed69f069c9664a8fe5b69', label: 'WingRiders', category: 'DEX', color: '#10b981' },
  { hash: 'c8c93656e8bce07fdc029d51abf7b1a782a45e68a65b91bdc267449e', label: 'Liqwid', category: 'Lending', color: '#3b82f6' },
  { hash: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c', label: 'Indigo', category: 'Synthetics', color: '#6366f1' },
];

// Icons
const Icons = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  architecture: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="8.5" y="14" width="7" height="7" rx="1" />
      <path d="M6.5 10v1.5a1 1 0 001 1h9a1 1 0 001-1V10M12 12.5V14" />
    </svg>
  ),
  contract: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16,18 22,12 16,6" />
      <polyline points="8,6 2,12 8,18" />
    </svg>
  ),
  builtins: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  traces: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  ),
};

// Mermaid renderer component
function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chart || !containerRef.current) return;

    const renderChart = async () => {
      try {
        const mermaid = await import('mermaid');
        mermaid.default.initialize({
          startOnLoad: false,
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
          flowchart: { useMaxWidth: true, htmlLabels: true },
        });
        
        const { svg } = await mermaid.default.render('mermaid-diagram', chart);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        setError('Failed to render diagram');
        console.error('Mermaid error:', err);
      }
    };

    renderChart();
  }, [chart]);

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  return <div ref={containerRef} className="mermaid-container" />;
}

export default function ScriptAnalyzer() {
  const [scriptHash, setScriptHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'architecture' | 'contract' | 'builtins' | 'traces'>('overview');
  const [contractView, setContractView] = useState<'cbor' | 'uplc' | 'aiken'>('aiken');
  const carouselRef = useRef<HTMLDivElement>(null);
  
  // Theme
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  // AI Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Initialize theme
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = stored || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme as 'light' | 'dark');
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // URL handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['overview', 'architecture', 'contract', 'builtins', 'traces'].includes(tabParam)) {
      setActiveTab(tabParam as typeof activeTab);
    }
    
    const hashParam = params.get('hash');
    if (hashParam && /^[a-f0-9]{56}$/i.test(hashParam)) {
      analyze(hashParam);
    }
  }, []);

  const updateUrl = (hash: string, tab: string) => {
    const params = new URLSearchParams();
    params.set('hash', hash);
    params.set('tab', tab);
    window.history.pushState({}, '', `?${params.toString()}`);
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (scriptHash) {
      updateUrl(scriptHash, tab);
    }
  };

  // Fetch AI analysis
  const fetchAiAnalysis = async (uplc: string, hash: string) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uplc, scriptHash: hash }),
      });
      
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Analysis failed');
      }
      
      setAiAnalysis(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Analysis failed');
      setContractView('uplc');
    } finally {
      setAiLoading(false);
    }
  };

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
    setAiAnalysis(null);
    setScriptHash(targetHash);
    setContractView('aiken');

    updateUrl(targetHash, activeTab);

    try {
      const coreResult = await analyzeScriptCore(targetHash);
      setResult(coreResult);
      setLoading(false);
      
      // Background: AI analysis
      fetchAiAnalysis(coreResult.uplcPreview, targetHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze script');
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, btnId: string) => {
    navigator.clipboard.writeText(text);
    const btn = document.getElementById(btnId);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  };

  const getBuiltinCategory = (name: string): string => {
    const categories: Record<string, string> = {
      addInteger: 'Arithmetic', subtractInteger: 'Arithmetic', multiplyInteger: 'Arithmetic',
      divideInteger: 'Arithmetic', quotientInteger: 'Arithmetic', remainderInteger: 'Arithmetic',
      equalsInteger: 'Comparison', lessThanInteger: 'Comparison', lessThanEqualsInteger: 'Comparison',
      equalsByteString: 'Comparison', lessThanByteString: 'Comparison',
      appendByteString: 'ByteString', consByteString: 'ByteString',
      sha2_256: 'Crypto', sha3_256: 'Crypto', blake2b_256: 'Crypto',
      verifyEd25519Signature: 'Crypto', verifyEcdsaSecp256k1Signature: 'Crypto',
      ifThenElse: 'Control', trace: 'Debug',
      headList: 'List', tailList: 'List', nullList: 'List', mkCons: 'List',
      constrData: 'Data', unConstrData: 'Data', unListData: 'Data', unIData: 'Data', unBData: 'Data',
      equalsData: 'Data', serialiseData: 'Data',
    };
    return categories[name] || 'Other';
  };

  const getKnownContract = (hash: string) => {
    return TOP_CONTRACTS.find(c => c.hash === hash);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header>
        <a href="/" className="header-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16,18 22,12 16,6" />
            <polyline points="8,6 2,12 8,18" />
          </svg>
          <h1>UPLC Analyzer</h1>
        </a>
        <div className="header-actions">
          <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? Icons.moon : Icons.sun}
          </button>
          <a href="https://github.com/will-break-it/uplc" target="_blank" rel="noopener" className="github-link" title="View on GitHub">
            {Icons.github}
          </a>
        </div>
      </header>

      <div className="container">
        {/* Search */}
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

        {/* Contract carousel (when no result) */}
        {!result && !loading && (
          <div className="contracts-carousel">
            <h3>Popular Contracts</h3>
            <div className="carousel-wrapper">
              <div className="carousel-scroll" ref={carouselRef}>
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
            </div>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p>Fetching from Koios and decoding UPLC...</p>
          </div>
        )}

        {result && (
          <div className="docs-layout">
            {/* Sidebar */}
            <aside className="docs-sidebar">
              <h4>Analysis</h4>
              <nav>
                <a href="#overview" className={activeTab === 'overview' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('overview'); }}>
                  {Icons.overview}
                  <span>Overview</span>
                </a>
                <a href="#architecture" className={activeTab === 'architecture' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('architecture'); }}>
                  {Icons.architecture}
                  <span>Architecture</span>
                  {aiLoading && <span className="badge-small">...</span>}
                </a>
                <a href="#contract" className={activeTab === 'contract' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('contract'); }}>
                  {Icons.contract}
                  <span>Contract</span>
                </a>
                <a href="#builtins" className={activeTab === 'builtins' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('builtins'); }}>
                  {Icons.builtins}
                  <span>Builtins</span>
                  <span className="badge-small">{result.stats.uniqueBuiltins}</span>
                </a>
                <a href="#traces" className={activeTab === 'traces' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('traces'); }}>
                  {Icons.traces}
                  <span>Trace Strings</span>
                  <span className="badge-small">{result.errorMessages.length}</span>
                </a>
              </nav>
            </aside>

            {/* Mobile nav */}
            <div className="docs-mobile-nav">
              <select value={activeTab} onChange={(e) => handleTabChange(e.target.value as typeof activeTab)}>
                <option value="overview">Overview</option>
                <option value="architecture">Architecture</option>
                <option value="contract">Contract</option>
                <option value="builtins">Builtins ({result.stats.uniqueBuiltins})</option>
                <option value="traces">Trace Strings ({result.errorMessages.length})</option>
              </select>
            </div>

            {/* Main content */}
            <main className="docs-content">
              {activeTab === 'overview' && (
                <section className="docs-section">
                  <h2>{Icons.overview} Overview</h2>
                  
                  {/* Script hash card */}
                  <div className="script-hash-card">
                    <div className="label">Script Hash</div>
                    <div className="hash-row">
                      <span className="hash">{result.scriptInfo.scriptHash}</span>
                      <button className="copy-hash-btn" onClick={() => copyToClipboard(result.scriptInfo.scriptHash, 'copy-hash')} id="copy-hash" title="Copy hash">
                        {Icons.copy}
                      </button>
                    </div>
                    {getKnownContract(result.scriptInfo.scriptHash) && (
                      <div className="dapp-name">{getKnownContract(result.scriptInfo.scriptHash)?.label}</div>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="stats-row">
                    <div className="stat-card">
                      <div className="label">Type</div>
                      <div className="value small">{result.scriptInfo.type}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Size</div>
                      <div className="value">{result.scriptInfo.size.toLocaleString()}<span style={{ fontSize: '0.75rem', marginLeft: '0.25rem' }}>bytes</span></div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Plutus Version</div>
                      <div className="value small">{result.version}</div>
                    </div>
                  </div>

                  {/* Classification */}
                  <h3>Classification</h3>
                  <div className="classification-badge">{result.classification}</div>
                </section>
              )}

              {activeTab === 'architecture' && (
                <section className="docs-section">
                  <h2>{Icons.architecture} Architecture</h2>
                  <p>AI-generated contract architecture analysis including flow diagram and inferred types.</p>

                  {aiLoading && (
                    <div className="mermaid-loading">
                      <div className="spinner" />
                      <span>Analyzing contract structure...</span>
                    </div>
                  )}

                  {aiError && (
                    <div className="error-message">
                      {aiError}
                      <button onClick={() => fetchAiAnalysis(result.uplcPreview, scriptHash)} style={{ marginLeft: '1rem' }}>
                        Retry
                      </button>
                    </div>
                  )}

                  {!aiLoading && aiAnalysis?.mermaid && (
                    <>
                      <h3>Flow Diagram</h3>
                      <MermaidDiagram chart={aiAnalysis.mermaid} />
                    </>
                  )}

                  {!aiLoading && aiAnalysis?.types && (
                    <>
                      <h3>Inferred Types</h3>
                      <div className="types-container">
                        <div className="type-card">
                          <div className="label">Datum</div>
                          <pre>{aiAnalysis.types.datum || 'Unknown'}</pre>
                        </div>
                        <div className="type-card">
                          <div className="label">Redeemer</div>
                          <pre>{aiAnalysis.types.redeemer || 'Unknown'}</pre>
                        </div>
                      </div>
                    </>
                  )}

                  {!aiLoading && !aiAnalysis?.mermaid && !aiAnalysis?.types && !aiError && (
                    <div className="empty-state">
                      <p>Architecture analysis not available for this contract.</p>
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'contract' && (
                <section className="docs-section">
                  <h2>{Icons.contract} Contract Code</h2>
                  <p>View the smart contract in different formats.</p>

                  <div className="code-section">
                    <div className="code-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div className="code-tabs">
                          <button className={`code-tab ${contractView === 'cbor' ? 'active' : ''}`} onClick={() => setContractView('cbor')}>
                            CBOR
                          </button>
                          <button className={`code-tab ${contractView === 'uplc' ? 'active' : ''}`} onClick={() => setContractView('uplc')}>
                            UPLC
                          </button>
                          <button 
                            className={`code-tab ${contractView === 'aiken' ? 'active' : ''} ${aiLoading ? 'loading' : ''}`} 
                            onClick={() => setContractView('aiken')}
                            disabled={aiLoading && !aiAnalysis}
                          >
                            {aiLoading && !aiAnalysis && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginBottom: 0 }} />}
                            Aiken
                          </button>
                        </div>
                        {contractView === 'aiken' && <span className="code-meta">AI approximation</span>}
                      </div>
                      <button 
                        className="copy-btn" 
                        id="copy-code"
                        onClick={() => {
                          const text = contractView === 'cbor' ? result.bytes : contractView === 'aiken' && aiAnalysis?.aiken ? aiAnalysis.aiken : result.uplcPreview;
                          copyToClipboard(text, 'copy-code');
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    
                    <div className="code-block">
                      {contractView === 'cbor' && (
                        <pre style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{result.bytes}</pre>
                      )}
                      {contractView === 'uplc' && (
                        <CodeBlock code={result.uplcPreview} language="haskell" />
                      )}
                      {contractView === 'aiken' && (
                        aiLoading && !aiAnalysis ? (
                          <pre style={{ color: '#6b7280' }}>Converting to Aiken-style pseudocode...</pre>
                        ) : aiAnalysis?.aiken ? (
                          <CodeBlock code={aiAnalysis.aiken} language="rust" />
                        ) : (
                          <pre style={{ color: '#6b7280' }}>
                            {aiError || 'Failed to generate Aiken code. Switch to UPLC view.'}
                          </pre>
                        )
                      )}
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'builtins' && (
                <section className="docs-section">
                  <h2>{Icons.builtins} Builtin Functions</h2>
                  <p>Plutus builtins extracted from the UPLC AST. Higher counts indicate core logic patterns.</p>

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
                      <p>No builtins detected (minimal script)</p>
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'traces' && (
                <section className="docs-section">
                  <h2>{Icons.traces} Trace Strings</h2>
                  <p>Human-readable strings embedded in the contract, typically used for error messages.</p>

                  {result.errorMessages.length > 0 ? (
                    <div>
                      {result.errorMessages.map((msg: string, i: number) => (
                        <div key={i} className="error-item">
                          {Icons.contract}
                          <span>{msg}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>No trace strings found in bytecode</p>
                    </div>
                  )}
                </section>
              )}
            </main>
          </div>
        )}
      </div>

      <footer>
        <p>
          Built by <a href="https://pagebase.dev" target="_blank" rel="noopener">Pagebase</a> for Cardano smart contract analysis.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          <a href="https://github.com/will-break-it/uplc" target="_blank" rel="noopener">Source</a>
          {' · '}
          <a href="https://github.com/sponsors/will-break-it" target="_blank" rel="noopener">☕ Support</a>
        </p>
      </footer>
    </div>
  );
}
