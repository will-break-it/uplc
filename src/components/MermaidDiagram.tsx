import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

interface Props {
  chart: string;
  id: string;
}

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#0d1117',
    primaryColor: '#58a6ff',
    primaryTextColor: '#c9d1d9',
    primaryBorderColor: '#30363d',
    lineColor: '#8b949e',
    secondaryColor: '#21262d',
    tertiaryColor: '#161b22',
  },
  flowchart: {
    curve: 'basis',
    padding: 20,
  },
});

export default function MermaidDiagram({ chart, id }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderDiagram = async () => {
      if (containerRef.current && chart) {
        try {
          // Clear previous content
          containerRef.current.innerHTML = '';
          
          // Render the diagram
          const { svg } = await mermaid.render(`mermaid-${id}`, chart);
          containerRef.current.innerHTML = svg;
        } catch (error) {
          console.error('Mermaid render error:', error);
          containerRef.current.innerHTML = `<pre style="color: #f85149;">Failed to render diagram: ${error}</pre>`;
        }
      }
    };

    renderDiagram();
  }, [chart, id]);

  return (
    <div 
      ref={containerRef}
      style={{
        background: 'var(--code-bg)',
        borderRadius: '8px',
        padding: '1rem',
        overflow: 'auto',
        minHeight: '200px',
      }}
    />
  );
}
