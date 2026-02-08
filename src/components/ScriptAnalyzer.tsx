import { useState, useEffect, useRef } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import type { AnalysisResult } from '../lib/analyzer';
import { analyzeScriptCore } from '../lib/analyzer';
import { decompileUplc, type DecompilerResult } from '../lib/decompiler';

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
  // DEX - Major
  { hash: 'e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309', label: 'Minswap Pool', category: 'DEX', color: '#8b5cf6' },
  { hash: 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b', label: 'Minswap Order', category: 'DEX', color: '#8b5cf6' },
  { hash: 'ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a', label: 'SundaeSwap V1', category: 'DEX', color: '#06b6d4' },
  { hash: 'e0302560ced2fdcbfcb2602697df970cd0d6a38f94b32703f51c312b', label: 'SundaeSwap V3 Pool', category: 'DEX', color: '#06b6d4' },
  { hash: 'fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077', label: 'SundaeSwap V3 Order', category: 'DEX', color: '#06b6d4' },
  { hash: '6b9c456aa650cb808a9ab54326e039d5235ed69f069c9664a8fe5b69', label: 'WingRiders', category: 'DEX', color: '#10b981' },
  { hash: 'e9823c2d96ffc29ba6dd695fd85f784aa081bdcc01f92bb43242e752', label: 'WingRiders Factory', category: 'DEX', color: '#10b981' },
  { hash: '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02', label: 'Splash', category: 'DEX', color: '#3b82f6' },
  { hash: 'ea184d0a7e640c4b5daa3f2cef851e75477729c2fd89f6ffbed7874c', label: 'MuesliSwap', category: 'DEX', color: '#f97316' },
  { hash: 'e628bfd68c07a7a38fcd7d8df650812a9dfdbee54b1ed4c25c87ffbf', label: 'Spectrum AMM', category: 'DEX', color: '#14b8a6' },
  { hash: '2618e94cdb06792f05ae9b1ec78b0231f4b7f4215b1b4cf52e6342de', label: 'Spectrum Swap', category: 'DEX', color: '#14b8a6' },
  { hash: 'ed97e0a1394724bb7cb94f20acf627abc253694c92b88bf8fb4b7f6f', label: 'CSWAP Pool', category: 'DEX', color: '#a855f7' },
  { hash: '1af84a9e697e1e7b042a0a06f061e88182feb9e9ada950b36a916bd5', label: 'Saturn Swap', category: 'DEX', color: '#eab308' },
  { hash: '6ec4acc3fbbd570ada625f24902777cec5d7a349fa0f3c7ba87b0cff', label: 'DexHunter Stop Loss', category: 'DEX', color: '#ef4444' },
  
  // NFT Marketplaces
  { hash: '4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a', label: 'JPG Store', category: 'NFT', color: '#f59e0b' },
  { hash: '9068a7a3f008803edac87af1619860f2cdcde40c26987325ace138ad', label: 'JPG Store V2', category: 'NFT', color: '#f59e0b' },
  { hash: 'c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65', label: 'JPG Store Ask', category: 'NFT', color: '#f59e0b' },
  
  // Lending & Synthetics
  { hash: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c', label: 'Indigo', category: 'Synthetics', color: '#6366f1' },
  { hash: 'fc7fa1cfd7b5b4db904bd2ab95df8ba8050b8fb7c7fc776cd214ec8f', label: 'Cerra Lending', category: 'Lending', color: '#0ea5e9' },
  { hash: 'e8191d57b95140cbdbf06ff9035b22551c1fa7374908aa4b5ed0667e', label: 'VyFinance Vault', category: 'DeFi', color: '#22c55e' },
  
  // Staking & DAO
  { hash: '61b3802ce748ed1fdaad2d6c744b19f104285f7d318172a5d4f06a4e', label: 'Coinecta Stake', category: 'Staking', color: '#ec4899' },
  { hash: 'eaeeb6716f41383b1fb53ec0c91d4fbb55aba4f23061b73cdf5d0b62', label: 'Coinecta Proxy', category: 'Staking', color: '#ec4899' },
  { hash: '1632c998d2e7d662303e9d0f6a090b7bc8a2289e44198a86bdf9098f', label: 'STEAK Stakechain', category: 'Oracle', color: '#64748b' },
  
  // Infrastructure & Tools
  { hash: '94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469', label: 'Seedelf Wallet', category: 'Tools', color: '#84cc16' },
  { hash: '1fa8c9199601924c312fb4f206ff632ca575b27f4f97dd02d9a9ae56', label: 'Iagon Storage', category: 'Storage', color: '#f43f5e' },
  { hash: 'ac35ee89c26b1e582771ed05af54b67fd7717bbaebd7f722fbf430d6', label: 'Iagon Node', category: 'Storage', color: '#f43f5e' },
  
  // Smart Contracts / Marlowe
  { hash: '2ed2631dbb277c84334453c5c437b86325d371f0835a28b910a91a6e', label: 'Marlowe', category: 'Smart Contracts', color: '#a78bfa' },
  
  // More DEX contracts for variety
  { hash: '99b82cb994dc2af44c12cb5daf5ad274211622800467af5bd8c32352', label: 'Splash Weighted', category: 'DEX', color: '#3b82f6' },
  { hash: 'da5b47aed3955c9132ee087796fa3b58a1ba6173fa31a7bc29e56d4e', label: 'CSWAP Order', category: 'DEX', color: '#a855f7' },
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
  analysis: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="M18 9l-5 5-4-4-3 3" />
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  // Prevent body scroll when fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFullscreen]);

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
      className={`mermaid-viewport ${isFullscreen ? 'mermaid-fullscreen' : ''}`}
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
      <button 
        className="mermaid-fullscreen-btn" 
        onClick={() => setIsFullscreen(!isFullscreen)} 
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        )}
      </button>
    </div>
  );
}

// Enhancement result interface
interface EnhancementResult {
  naming?: Record<string, string>;
  annotations?: string[];
  diagram?: string;
  rewrite?: string;
  cached?: boolean;
}

interface ScriptAnalyzerProps {
  initialHash?: string;
}

export default function ScriptAnalyzer({ initialHash }: ScriptAnalyzerProps) {
  const [scriptHash, setScriptHash] = useState(initialHash || '');
  const [loading, setLoading] = useState(false);
  const [decompiling, setDecompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [decompiled, setDecompiled] = useState<DecompilerResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'architecture' | 'contract' | 'analysis'>('overview');
  const [contractView, setContractView] = useState<'cbor' | 'uplc' | 'aiken'>('aiken');
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselDirectionRef = useRef<1 | -1>(1);
  const carouselPausedRef = useRef(false);

  // AI Enhancement state (now from unified API)
  const [enhancement, setEnhancement] = useState<EnhancementResult | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  
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

  // URL handling - supports both path-based (/script/hash) and legacy query params
  useEffect(() => {
    // Check for tab and view in query params
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['overview', 'architecture', 'contract', 'analysis'].includes(tabParam)) {
      setActiveTab(tabParam as typeof activeTab);
    }
    const viewParam = params.get('view');
    if (viewParam && ['cbor', 'uplc', 'aiken'].includes(viewParam)) {
      setContractView(viewParam as typeof contractView);
    }
    
    // Priority: initialHash prop > path-based URL > query param
    if (initialHash) {
      analyze(initialHash);
    } else {
      // Check for path-based URL: /script/[hash]
      const pathMatch = window.location.pathname.match(/^\/script\/([a-f0-9]{56})$/i);
      if (pathMatch) {
        analyze(pathMatch[1]);
      } else {
        // Legacy: check query params and redirect to clean URL
        const hashParam = params.get('hash');
        if (hashParam && /^[a-f0-9]{56}$/i.test(hashParam)) {
          // Redirect to clean path-based URL
          window.history.replaceState({}, '', `/script/${hashParam}`);
          analyze(hashParam);
        }
      }
    }
  }, [initialHash]);

  const updateUrl = (hash: string, tab: string, view?: string) => {
    // Build URL with path and query params
    const params = new URLSearchParams();
    if (tab !== 'overview') params.set('tab', tab);
    if (tab === 'contract' && view && view !== 'aiken') params.set('view', view);
    
    const queryString = params.toString();
    const newUrl = `/script/${hash}${queryString ? `?${queryString}` : ''}`;
    
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.pushState({}, '', newUrl);
    }
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (scriptHash) {
      updateUrl(scriptHash, tab, tab === 'contract' ? contractView : undefined);
    }
  };

  const handleContractViewChange = (view: typeof contractView) => {
    setContractView(view);
    if (scriptHash) {
      updateUrl(scriptHash, activeTab, view);
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
    setDecompiled(null);
    setEnhancement(null);
    setScriptHash(targetHash);
    // Don't reset contractView - preserve current state (may be from URL)

    updateUrl(targetHash, activeTab, contractView);

    try {
      // Try server-side cached analysis first
      const serverResponse = await fetch(`/api/analyze?hash=${targetHash}`);
      
      if (serverResponse.ok) {
        const serverResult = await serverResponse.json();
        
        // Map server result to our types
        const coreResult: AnalysisResult = {
          scriptInfo: {
            scriptHash: serverResult.scriptHash,
            type: serverResult.scriptType,
            size: serverResult.size,
            bytes: serverResult.bytes || '',
          },
          builtins: serverResult.builtins,
          errorMessages: serverResult.traceStrings || [],
          constants: serverResult.constants || { bytestrings: [], integers: [] },
          classification: serverResult.scriptPurpose,
          version: serverResult.version,
          stats: serverResult.stats,
          uplcPreview: serverResult.uplc,
        };
        
        setResult(coreResult);
        
        // Decompiled code comes from server
        const decompiledResult: DecompilerResult = {
          aikenCode: serverResult.aikenCode,
          scriptPurpose: serverResult.scriptPurpose,
          params: [],
          datumUsed: false,
          datumFields: 0,
          redeemerVariants: 0,
          validationChecks: 0,
        };
        setDecompiled(decompiledResult);
        setLoading(false);
        
        // Auto-enhance if decompilation succeeded
        if (!decompiledResult.error && decompiledResult.aikenCode) {
          enhanceCodeAuto(coreResult, decompiledResult);
        }
        return;
      }
      
      // Fallback to client-side analysis if server fails
      console.warn('Server analysis failed, falling back to client-side:', serverResponse.statusText);
      
      const coreResult = await analyzeScriptCore(targetHash);
      setResult(coreResult);
      setLoading(false);

      if (coreResult.uplcPreview) {
        setDecompiling(true);
        setTimeout(() => {
          try {
            const decompiledResult = decompileUplc(coreResult.uplcPreview);
            setDecompiled(decompiledResult);
            if (!decompiledResult.error && decompiledResult.aikenCode) {
              enhanceCodeAuto(coreResult, decompiledResult);
            }
          } catch (err) {
            setDecompiled({
              aikenCode: `// Decompilation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
              scriptPurpose: 'unknown',
              params: [],
              datumUsed: false,
              datumFields: 0,
              redeemerVariants: 0,
              validationChecks: 0,
              error: err instanceof Error ? err.message : 'Unknown error'
            });
          } finally {
            setDecompiling(false);
          }
        }, 50);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze script');
      setLoading(false);
    }
  };

  // Automatic AI enhancement (called after successful decompilation)
  const enhanceCodeAuto = async (result: AnalysisResult, decompiled: DecompilerResult) => {
    try {
      // Request rewrite + diagram for fully successful decompilation
      const enhancements: ('rewrite' | 'diagram')[] = ['rewrite'];
      if (!decompiled.error) {
        enhancements.push('diagram');
      }

      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scriptHash: result.scriptInfo.scriptHash,
          aikenCode: decompiled.aikenCode,
          uplcPreview: result.uplcPreview,
          purpose: decompiled.scriptPurpose,
          builtins: result.builtins,
          traces: result.errorMessages || [],
          enhance: enhancements,
        }),
      });

      if (response.ok) {
        const data = await response.json() as EnhancementResult;
        setEnhancement(data);
      }
      // Silently fail - enhancements are optional
    } catch (err) {
      // Silently fail - enhancements are optional
      console.warn('AI enhancement failed:', err);
    }
  };


  // Apply enhancements to code
  const getDisplayCode = () => {
    if (!decompiled) return '';
    if (showOriginal || !enhancement) return decompiled.aikenCode;

    // Use AI-rewritten code if available
    if (enhancement.rewrite) {
      return enhancement.rewrite;
    }

    // Fallback to original decompiled code
    return decompiled.aikenCode;
  };

  const copyToClipboard = async (text: string, btnId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.classList.add('copied');
        btn.setAttribute('title', 'Copied!');
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.setAttribute('title', 'Copy');
        }, 1500);
      }
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
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
                </a>
                <a href="#contract" className={activeTab === 'contract' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('contract'); }}>
                  {Icons.contract}
                  <span>Contract</span>
                </a>
                <a href="#analysis" className={activeTab === 'analysis' ? 'active' : ''} onClick={(e) => { e.preventDefault(); handleTabChange('analysis'); }}>
                  {Icons.analysis}
                  <span>Static Analysis</span>
                </a>
              </nav>
            </aside>

            {/* Mobile nav */}
            <div className="docs-mobile-nav">
              <select value={activeTab} onChange={(e) => handleTabChange(e.target.value as typeof activeTab)}>
                <option value="overview">Overview</option>
                <option value="architecture">Architecture</option>
                <option value="contract">Contract</option>
                <option value="analysis">Static Analysis</option>
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
                    <span className="hash">{result.scriptInfo.scriptHash}</span>
                    <button className="copy-hash-btn" onClick={() => copyToClipboard(result.scriptInfo.scriptHash, 'copy-hash')} id="copy-hash" title="Copy hash">
                      {Icons.copy}
                    </button>
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
                  {enhancement?.diagram ? (
                    <>
                      <p>AI-generated architecture diagram showing validator logic flow.</p>
                      <MermaidDiagram chart={enhancement.diagram} />
                    </>
                  ) : decompiled && !enhancement ? (
                    <div style={{
                      padding: '2rem',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      background: 'var(--card-bg)',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--border)',
                    }}>
                      <div className="spinner" style={{ width: '32px', height: '32px', margin: '0 auto 1rem' }} />
                      <p>Generating architecture diagram with AI...</p>
                    </div>
                  ) : (
                    <div style={{
                      padding: '2rem',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      background: 'var(--card-bg)',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--border)',
                    }}>
                      <p>Architecture diagram unavailable for this contract.</p>
                      <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>AI enhancement may have failed or is still loading.</p>
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
                        <button className={`code-tab ${contractView === 'cbor' ? 'active' : ''}`} onClick={() => handleContractViewChange('cbor')}>
                          CBOR
                        </button>
                        <button className={`code-tab ${contractView === 'uplc' ? 'active' : ''}`} onClick={() => handleContractViewChange('uplc')}>
                          UPLC
                        </button>
                        <button 
                          className={`code-tab ${contractView === 'aiken' ? 'active' : ''}`} 
                          onClick={() => handleContractViewChange('aiken')}
                          title="Decompiled Aiken code"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                        >
                          Aiken
                          {decompiled && !enhancement && (
                            <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', margin: 0, flexShrink: 0, display: 'block', verticalAlign: 'middle' }} />
                          )}
                        </button>
                      </div>
                      <button
                        className="copy-btn"
                        id="copy-code"
                        onClick={() => {
                          let text = '';
                          if (contractView === 'cbor') text = result.scriptInfo.bytes;
                          else if (contractView === 'uplc') {
                            text = result.uplcPreview.replace(/\s+/g, ' ').trim();
                          } else if (contractView === 'aiken' && decompiled) {
                            text = getDisplayCode();
                          }
                          copyToClipboard(text, 'copy-code');
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    
                    <div className="code-block" style={{ position: 'relative' }}>
                      {contractView === 'aiken' && enhancement?.rewrite && (
                        <button
                          onClick={() => setShowOriginal(!showOriginal)}
                          style={{
                            position: 'sticky',
                            top: '0',
                            float: 'right',
                            marginTop: '-0.25rem',
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.7rem',
                            background: 'rgba(0,0,0,0.8)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '4px',
                            color: 'var(--text-code)',
                            cursor: 'pointer',
                            zIndex: 20,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.95)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.8)'}
                          title={showOriginal ? 'Show AI-enhanced code' : 'Show raw decompilation'}
                        >
                          {showOriginal ? 'AI' : 'Raw'}
                        </button>
                      )}
                        {contractView === 'cbor' && (
                          <pre className="cbor-hex">{result.scriptInfo.bytes}</pre>
                        )}
                        {contractView === 'uplc' && (
                          <pre className="cbor-hex" style={{ wordBreak: 'break-all' }}>
                            {result.uplcPreview.replace(/\s+/g, ' ').trim()}
                          </pre>
                        )}
                        {contractView === 'aiken' && (
                          decompiled ? (
                            <>
                              <CodeBlock code={getDisplayCode()} language="rust" />
                              {decompiled.error && (
                                <div style={{ marginTop: '1rem', color: 'var(--text-warning)', fontSize: '0.9rem' }}>
                                  Partial decompilation: {decompiled.error}
                                </div>
                              )}
                            </>
                        ) : decompiling ? (
                          <div className="coming-soon-section" style={{ padding: '2rem' }}>
                            <div className="spinner" style={{ width: '32px', height: '32px', margin: '0 auto 1rem' }} />
                            <h3 style={{ color: 'var(--text)' }}>Decompiling...</h3>
                            <p style={{ color: 'var(--text)' }}>Parsing UPLC and generating Aiken code...</p>
                          </div>
                        ) : (
                          <div className="coming-soon-section" style={{ padding: '2rem' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                            <h3>No decompilation available</h3>
                            <p>UPLC preview not available for this script</p>
                          </div>
                          )
                        )}
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'analysis' && (
                <section className="docs-section">
                  <h2>{Icons.analysis} Static Analysis</h2>
                  <p>Data extracted directly from UPLC bytecode.</p>

                  {/* Stats */}
                  <div className="stats-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', marginTop: '1rem' }}>
                    <div className="stat-card">
                      <div className="label">Builtins</div>
                      <div className="value">{result.stats.uniqueBuiltins}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Lambdas</div>
                      <div className="value">{result.stats.lambdaCount}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Applications</div>
                      <div className="value">{result.stats.applicationCount}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Force/Delay</div>
                      <div className="value">{result.stats.forceCount}/{result.stats.delayCount}</div>
                    </div>
                  </div>

                  {/* Trace Strings */}
                  <div style={{ marginTop: '1.5rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
                      Trace Strings ({result.errorMessages.length})
                    </h3>
                    {result.errorMessages.length > 0 ? (
                      <div>
                        {result.errorMessages.map((msg: string, i: number) => (
                          <div key={i} className="error-item">
                            <code>{msg}</code>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p>No trace strings found in bytecode</p>
                      </div>
                    )}
                  </div>

                  {/* Builtins */}
                  <div style={{ marginTop: '1.5rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
                      Builtin Functions
                    </h3>
                    {Object.keys(result.builtins).length > 0 ? (
                      <div className="builtin-table-wrapper">
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
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p>No builtins detected</p>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </main>
          </div>
        )}
      </div>

      <footer>
        <p>
          AI decompilation isn't free — if this helped, consider <a href="https://github.com/sponsors/will-break-it" target="_blank" rel="noopener">supporting</a>
          {' · '}
          <a href="https://github.com/will-break-it/uplc/issues/new?labels=bug&template=bug_report.md" target="_blank" rel="noopener">Found a bug?</a>
        </p>
      </footer>
    </div>
  );
}
