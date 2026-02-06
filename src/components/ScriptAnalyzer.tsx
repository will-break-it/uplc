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
  { hash: '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02', label: 'Splash', category: 'DEX', color: '#3b82f6' },
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  ),
};

// Mermaid renderer component with pan/zoom
function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!chart || !svgRef.current) return;

    const renderChart = async () => {
      try {
        const mermaid = await import('mermaid');
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        mermaid.default.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: isDark ? {
            primaryColor: '#1e293b',
            primaryTextColor: '#e2e8f0',
            primaryBorderColor: '#334155',
            lineColor: '#475569',
            secondaryColor: '#334155',
            tertiaryColor: '#1e293b',
            background: '#0f172a',
            mainBkg: '#1e293b',
            nodeBorder: '#475569',
            clusterBkg: '#1e293b',
            clusterBorder: '#334155',
            titleColor: '#e2e8f0',
            edgeLabelBackground: '#1e293b',
            nodeTextColor: '#e2e8f0',
          } : {
            primaryColor: '#e2e8f0',
            primaryTextColor: '#0f172a',
            primaryBorderColor: '#94a3b8',
            lineColor: '#475569',
            secondaryColor: '#f1f5f9',
            tertiaryColor: '#f8fafc',
            background: '#ffffff',
            mainBkg: '#e2e8f0',
            nodeBorder: '#94a3b8',
            clusterBkg: '#f8fafc',
            clusterBorder: '#cbd5e1',
            titleColor: '#0f172a',
            edgeLabelBackground: '#ffffff',
            nodeTextColor: '#0f172a',
            textColor: '#0f172a',
            labelTextColor: '#0f172a',
          },
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        });
        
        const { svg } = await mermaid.default.render('mermaid-diagram', chart);
        if (svgRef.current) {
          svgRef.current.innerHTML = svg;
        }
      } catch (err) {
        setError('Failed to render diagram');
        console.error('Mermaid error:', err);
      }
    };

    renderChart();
    setTransform({ scale: 1, x: 0, y: 0 }); // Reset on new chart
  }, [chart]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scale: Math.min(Math.max(prev.scale * delta, 0.25), 4),
    }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleDoubleClick = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Zoom factor (1.5x on double-click)
    const zoomFactor = 1.5;
    const newScale = Math.min(transform.scale * zoomFactor, 4);
    
    // Adjust position to zoom toward click point
    const scaleChange = newScale / transform.scale;
    const newX = clickX - (clickX - transform.x) * scaleChange;
    const newY = clickY - (clickY - transform.y) * scaleChange;
    
    setTransform({ scale: newScale, x: newX, y: newY });
  };

  const resetView = () => setTransform({ scale: 1, x: 0, y: 0 });

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  return (
    <div 
      ref={containerRef}
      className="mermaid-viewport"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      <div 
        ref={svgRef}
        className="mermaid-container"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      />
      <div className="mermaid-controls">
        <button onClick={() => setTransform(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, 4) }))}>+</button>
        <button onClick={() => setTransform(prev => ({ ...prev, scale: Math.max(prev.scale * 0.8, 0.25) }))}>−</button>
        <button onClick={resetView}>Reset</button>
      </div>
    </div>
  );
}

export default function ScriptAnalyzer() {
  const [scriptHash, setScriptHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'architecture' | 'contract' | 'builtins' | 'traces'>('overview');
  const [contractView, setContractView] = useState<'cbor' | 'uplc' | 'aiken'>('aiken');
  const [aikenSubView, setAikenSubView] = useState<'validator' | 'datum' | 'redeemer'>('validator');
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselDirectionRef = useRef<1 | -1>(1);
  const carouselPausedRef = useRef(false);
  
  // Auto-scroll carousel
  useEffect(() => {
    const container = carouselRef.current;
    if (!container || result || loading) return;

    let animationId: number;
    let lastTime = performance.now();
    const speed = 25; // pixels per second

    const animate = () => {
      const currentTime = performance.now();
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      const maxScroll = container.scrollWidth - container.clientWidth;
      
      if (!carouselPausedRef.current && maxScroll > 10) {
        const scrollAmount = speed * deltaTime * carouselDirectionRef.current;
        container.scrollLeft += scrollAmount;

        // Reverse direction at ends (ping-pong)
        if (container.scrollLeft >= maxScroll - 1) {
          container.scrollLeft = maxScroll;
          carouselDirectionRef.current = -1;
        } else if (container.scrollLeft <= 1) {
          container.scrollLeft = 0;
          carouselDirectionRef.current = 1;
        }
      }

      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    const handleMouseEnter = () => { carouselPausedRef.current = true; };
    const handleMouseLeave = () => { carouselPausedRef.current = false; };

    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      cancelAnimationFrame(animationId);
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [result, loading]);
  
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
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setAiError(msg === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : msg);
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
        <div className="header-inner">
          <a href="/" className="header-brand">
            <svg viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="#0891b2"/>
              <path d="M9 11l4 5-4 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15 21h8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h1>UPLC.WTF</h1>
          </a>
          
          {/* Compact search in header when we have results */}
          {(result || loading) && (
            <div className="header-search">
              <input
                type="text"
                placeholder="Script hash..."
                value={scriptHash}
                onChange={(e) => setScriptHash(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && analyze()}
              />
              <button onClick={() => analyze()} disabled={loading}>
                {loading ? '...' : 'Go'}
              </button>
            </div>
          )}
          
          <div className="header-actions">
            <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? Icons.moon : Icons.sun}
            </button>
            <a href="https://github.com/will-break-it/uplc" target="_blank" rel="noopener" className="github-link" title="View on GitHub">
              {Icons.github}
            </a>
          </div>
        </div>
      </header>

      {/* Mobile search bar (shown below header on mobile when results exist) */}
      {(result || loading) && (
        <div className="mobile-search">
          <div className="search-box">
            <input
              type="text"
              placeholder="Script hash..."
              value={scriptHash}
              onChange={(e) => setScriptHash(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyze()}
            />
            <button onClick={() => analyze()} disabled={loading}>
              {loading ? '...' : 'Go'}
            </button>
          </div>
        </div>
      )}

      <div className="container">
        {/* Centered search (landing state only) */}
        {!result && !loading && (
          <div className="landing-search">
            <p className="tagline">WTF is this script doing?</p>
            <div className="search-box">
              <input
                type="text"
                placeholder="Enter script hash (56 hex characters)"
                value={scriptHash}
                onChange={(e) => setScriptHash(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && analyze()}
              />
              <button onClick={() => analyze()} disabled={loading}>
                Decode
              </button>
            </div>
            {error && <div className="error-message">{error}</div>}
          </div>
        )}

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

        {error && (result || loading) && <div className="error-message">{error}</div>}

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
                <section className="docs-section overview-section">
                  <div className="overview-header">
                    <h2>{Icons.overview} Overview</h2>
                    <div className="classification-badge">{result.classification}</div>
                  </div>
                  
                  {/* Script hash card */}
                  <div className="script-hash-card">
                    <div className="label">Script Hash</div>
                    <div className="hash-row">
                      <span className="hash">{result.scriptInfo.scriptHash}</span>
                      <button className="copy-hash-btn" onClick={() => copyToClipboard(result.scriptInfo.scriptHash, 'copy-hash')} id="copy-hash" title="Copy hash">
                        {Icons.copy}
                      </button>
                    </div>
                  </div>

                  {getKnownContract(result.scriptInfo.scriptHash) && (
                    <div className="dapp-name-card">
                      <div className="label">Contract</div>
                      <div className="dapp-name">{getKnownContract(result.scriptInfo.scriptHash)?.label}</div>
                      <a 
                        href="https://github.com/StricaHQ/cardano-contracts-registry" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="registry-link"
                        title="View dApp Registry"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    </div>
                  )}

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
                </section>
              )}

              {activeTab === 'architecture' && (
                <section className="docs-section">
                  <h2>{Icons.architecture} Architecture</h2>

                  {aiLoading && (
                    <div className="mermaid-loading">
                      <div className="spinner" />
                      <span>Analyzing contract structure...</span>
                    </div>
                  )}

                  {aiError && (
                    <div className="error-message">
                      {aiError === 'BUDGET_EXHAUSTED' ? (
                        <>
                          AI budget exhausted for this month. Raw UPLC still works!{' '}
                          <a href="https://github.com/sponsors/will-break-it" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>
                            Help keep AI features running
                          </a>
                        </>
                      ) : (
                        <>
                          {aiError}
                          <button onClick={() => fetchAiAnalysis(result.uplcPreview, scriptHash)} style={{ marginLeft: '1rem' }}>
                            Retry
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {!aiLoading && aiAnalysis?.mermaid && (
                    <>
                      <h3>Validation Flow</h3>
                      <MermaidDiagram chart={aiAnalysis.mermaid} />
                    </>
                  )}

                  {!aiLoading && !aiAnalysis?.mermaid && !aiError && (
                    <div className="empty-state">
                      <p>Validation flow diagram not available for this contract.</p>
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
                          {aiLoading && !aiAnalysis && <div className="spinner spinner-sm" />}
                          Aiken
                        </button>
                      </div>
                      <button 
                        className="copy-btn" 
                        id="copy-code"
                        onClick={() => {
                          let text = '';
                          if (contractView === 'cbor') text = result.scriptInfo.bytes;
                          else if (contractView === 'uplc') text = result.uplcPreview;
                          else if (contractView === 'aiken') {
                            if (aikenSubView === 'validator') text = aiAnalysis?.aiken || '';
                            else if (aikenSubView === 'datum') text = aiAnalysis?.types?.datum || '';
                            else if (aikenSubView === 'redeemer') text = aiAnalysis?.types?.redeemer || '';
                          }
                          copyToClipboard(text, 'copy-code');
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    
                    {contractView === 'aiken' && (
                      <>
                        <div className="aiken-subtabs">
                          <button 
                            className={`aiken-subtab ${aikenSubView === 'validator' ? 'active' : ''}`} 
                            onClick={() => setAikenSubView('validator')}
                          >
                            Validator
                          </button>
                          <button 
                            className={`aiken-subtab ${aikenSubView === 'datum' ? 'active' : ''}`} 
                            onClick={() => setAikenSubView('datum')}
                            disabled={!aiAnalysis?.types?.datum}
                          >
                            Datum
                          </button>
                          <button 
                            className={`aiken-subtab ${aikenSubView === 'redeemer' ? 'active' : ''}`} 
                            onClick={() => setAikenSubView('redeemer')}
                            disabled={!aiAnalysis?.types?.redeemer}
                          >
                            Redeemer
                          </button>
                        </div>
                        <div className="decompile-notice">
                          <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>
                          </svg>
                          {aikenSubView === 'validator' && 'Reconstructed from UPLC bytecode. Variable names and types are inferred.'}
                          {aikenSubView === 'datum' && 'Inferred from how the validator destructures on-chain state.'}
                          {aikenSubView === 'redeemer' && 'Inferred from pattern matching on transaction inputs.'}
                        </div>
                      </>
                    )}

                    <div className="code-block">
                      {contractView === 'cbor' && (
                        <pre className="cbor-hex">{result.scriptInfo.bytes}</pre>
                      )}
                      {contractView === 'uplc' && (
                        <CodeBlock code={result.uplcPreview} language="haskell" />
                      )}
                      {contractView === 'aiken' && (
                        aiLoading && !aiAnalysis ? (
                          <pre style={{ color: '#6b7280' }}>Converting to Aiken-style pseudocode...</pre>
                        ) : aiError === 'BUDGET_EXHAUSTED' ? (
                          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                            <p style={{ marginBottom: '1rem' }}>AI budget exhausted for this month.</p>
                            <p>Raw UPLC is still available in the UPLC tab.</p>
                            <p style={{ marginTop: '1rem' }}>
                              <a href="https://github.com/sponsors/will-break-it" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>
                                Help keep AI features running
                              </a>
                            </p>
                          </div>
                        ) : aikenSubView === 'validator' ? (
                          aiAnalysis?.aiken ? (
                            <CodeBlock code={aiAnalysis.aiken} language="rust" />
                          ) : (
                            <pre style={{ color: '#6b7280' }}>
                              {aiError || 'Failed to generate Aiken code. Switch to UPLC view.'}
                            </pre>
                          )
                        ) : aikenSubView === 'datum' ? (
                          aiAnalysis?.types?.datum ? (
                            <CodeBlock code={aiAnalysis.types.datum} language="rust" />
                          ) : (
                            <pre style={{ color: '#6b7280' }}>Datum type not available.</pre>
                          )
                        ) : aikenSubView === 'redeemer' ? (
                          aiAnalysis?.types?.redeemer ? (
                            <CodeBlock code={aiAnalysis.types.redeemer} language="rust" />
                          ) : (
                            <pre style={{ color: '#6b7280' }}>Redeemer type not available.</pre>
                          )
                        ) : null
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
          AI decompilation isn't free — if this helped, consider <a href="https://github.com/sponsors/will-break-it" target="_blank" rel="noopener">supporting</a>
        </p>
      </footer>
    </div>
  );
}
