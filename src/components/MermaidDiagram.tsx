import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

interface Props {
  chart: string;
  id: string;
}

// Initialize mermaid with light theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    background: '#ffffff',
    primaryColor: '#e0f2fe',
    primaryTextColor: '#1e293b',
    primaryBorderColor: '#3b82f6',
    lineColor: '#64748b',
    secondaryColor: '#f1f5f9',
    tertiaryColor: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
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
          containerRef.current.innerHTML = '';
          const { svg } = await mermaid.render(`mermaid-${id}`, chart);
          containerRef.current.innerHTML = svg;
        } catch (error) {
          console.error('Mermaid render error:', error);
          containerRef.current.innerHTML = `<pre style="color: #ef4444; padding: 1rem;">Failed to render diagram</pre>`;
        }
      }
    };

    renderDiagram();
  }, [chart, id]);

  return (
    <div 
      ref={containerRef}
      style={{
        background: '#fff',
        borderRadius: '8px',
        padding: '1rem',
        overflow: 'auto',
        minHeight: '200px',
        border: '1px solid #e2e8f0',
      }}
    />
  );
}
