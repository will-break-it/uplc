# UI Integration Guide - Claude API Enhancement

## Overview

The Claude API enhancement endpoint (`/api/enhance`) is ready to use. This guide shows how to integrate it into the existing React UI.

## Quick Integration

### 1. Add Enhancement Button to ScriptAnalyzer

**Location:** `src/components/ScriptAnalyzer.tsx`

**Add state:**
```typescript
const [enhancing, setEnhancing] = useState(false);
const [enhanced, setEnhanced] = useState<any>(null);
```

**Add enhancement function:**
```typescript
const enhanceCode = async () => {
  if (!result || !decompiled) return;

  setEnhancing(true);
  try {
    const response = await fetch('/api/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scriptHash: scriptHash,
        aikenCode: decompiled.aikenCode,
        uplcPreview: result.uplcPreview,
        purpose: decompiled.scriptPurpose,
        builtins: result.builtins,
        enhance: ['naming', 'annotations', 'diagram']
      })
    });

    const data = await response.json();
    setEnhanced(data);

    // Apply naming improvements to code
    if (data.naming) {
      let improvedCode = decompiled.aikenCode;
      for (const [oldName, newName] of Object.entries(data.naming)) {
        improvedCode = improvedCode.replace(
          new RegExp(`\\b${oldName}\\b`, 'g'),
          newName as string
        );
      }
      setDecompiled({
        ...decompiled,
        aikenCode: improvedCode
      });
    }
  } catch (error) {
    console.error('Enhancement failed:', error);
  } finally {
    setEnhancing(false);
  }
};
```

**Add button to UI:**
```typescript
{decompiled && contractView === 'aiken' && (
  <div className="enhance-section">
    <button
      onClick={enhanceCode}
      disabled={enhancing || enhanced}
      className="enhance-btn"
    >
      {enhancing ? '✨ Enhancing...' : enhanced ? '✅ Enhanced' : '✨ Enhance with AI'}
    </button>
    {enhanced?.cached && (
      <span className="cached-badge">Cached</span>
    )}
  </div>
)}
```

### 2. Display Architecture Diagram

**Add Mermaid diagram display:**
```typescript
{enhanced?.diagram && activeTab === 'architecture' && (
  <div className="architecture-section">
    <h2>Architecture Diagram</h2>
    <p className="diagram-note">
      AI-generated flowchart showing validator logic
      {enhanced.cached && ' (cached)'}
    </p>
    <MermaidDiagram chart={enhanced.diagram} />
  </div>
)}
```

**Update architecture tab:**
```typescript
{activeTab === 'architecture' && (
  <section className="docs-section">
    <h2>{Icons.architecture} Architecture</h2>

    {enhanced?.diagram ? (
      <MermaidDiagram chart={enhanced.diagram} />
    ) : (
      <div className="coming-soon-section">
        <div className="coming-soon-icon">🔮</div>
        <h3>AI-Powered Architecture Diagrams</h3>
        <p>
          Click "Enhance with AI" on the Contract tab to generate an
          interactive architecture diagram using Claude.
        </p>
        <button onClick={() => handleTabChange('contract')} className="coming-soon-link">
          Go to Contract Tab →
        </button>
      </div>
    )}
  </section>
)}
```

### 3. Add CSS Styles

**Location:** `src/styles/global.css`

```css
.enhance-section {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 1rem;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.enhance-btn {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.enhance-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.enhance-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cached-badge {
  padding: 0.25rem 0.75rem;
  background: var(--success);
  color: white;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.diagram-note {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--bg-info);
  border-left: 3px solid var(--primary);
  border-radius: 4px;
  font-size: 0.9rem;
}
```

## Advanced Integration

### Show Enhanced Variable Names

**Add badge to code block:**
```typescript
{enhanced?.naming && (
  <div className="enhancements-applied">
    <strong>✨ AI Enhancements Applied:</strong>
    <ul>
      {Object.entries(enhanced.naming).map(([old, new_]) => (
        <li key={old}>
          <code>{old}</code> → <code>{new_}</code>
        </li>
      ))}
    </ul>
  </div>
)}
```

### Display Annotations

**Show as comments in code:**
```typescript
{enhanced?.annotations && (
  <div className="annotations-section">
    <h4>📝 Generated Annotations</h4>
    {enhanced.annotations.map((annotation: string, i: number) => (
      <div key={i} className="annotation-item">
        <code>{annotation}</code>
      </div>
    ))}
  </div>
)}
```

### Loading States

**Progressive enhancement UX:**
```typescript
{enhancing && (
  <div className="enhancing-overlay">
    <div className="spinner" />
    <p>Analyzing with Claude AI...</p>
    <small>This may take a few seconds</small>
  </div>
)}
```

## Testing

### 1. Test Locally

```bash
# Terminal 1: Start dev server
pnpm dev

# Terminal 2: Test enhancement endpoint
curl -X POST http://localhost:4321/api/enhance \
  -H "Content-Type: application/json" \
  -d '{
    "scriptHash": "test",
    "aikenCode": "validator test { spend(d, r, ref, tx) { True } }",
    "purpose": "spend",
    "builtins": {},
    "enhance": ["naming"]
  }'
```

### 2. Test in Browser

1. Go to http://localhost:4321
2. Enter a script hash (e.g., Minswap)
3. Click "Enhance with AI" button
4. Verify:
   - Loading state shows
   - Diagram renders
   - Variable names update
   - Cache indicator appears on 2nd request

### 3. Test Error Handling

```typescript
const enhanceCode = async () => {
  try {
    // ... enhancement code ...
  } catch (error) {
    setError(`Enhancement failed: ${error.message}`);
    // Show error toast or message
  }
};
```

## Performance Tips

### 1. Debounce Enhancement Requests

```typescript
const enhanceCodeDebounced = useMemo(
  () => debounce(enhanceCode, 1000),
  [decompiled]
);
```

### 2. Cache in LocalStorage

```typescript
// Check localStorage first
const cacheKey = `enhanced:${scriptHash}`;
const cached = localStorage.getItem(cacheKey);
if (cached) {
  setEnhanced(JSON.parse(cached));
  return;
}

// After enhancement
localStorage.setItem(cacheKey, JSON.stringify(enhanced));
```

### 3. Lazy Load Mermaid

```typescript
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

{enhanced?.diagram && (
  <Suspense fallback={<div>Loading diagram...</div>}>
    <MermaidDiagram chart={enhanced.diagram} />
  </Suspense>
)}
```

## User Experience

### Good UX Patterns

1. **Progressive Disclosure**
   - Show basic decompilation immediately
   - Offer enhancement as optional upgrade
   - Cache enhanced version

2. **Clear Feedback**
   - Loading spinner during enhancement
   - Success message when done
   - Cache indicator for fast responses

3. **Graceful Degradation**
   - Work without enhancement (show basic code)
   - Handle API errors gracefully
   - Provide fallback for diagram failures

### Bad UX Patterns

❌ Automatic enhancement (slow, costly)
❌ No loading indicator (confusing)
❌ Blocking UI during enhancement
❌ No error messages

## Cost Management

### Display Usage to User

```typescript
{enhanced && (
  <div className="cost-note">
    <small>
      💡 This enhancement used AI analysis
      {enhanced.cached ? ' (served from cache)' : ''}
    </small>
  </div>
)}
```

### Implement Rate Limiting

```typescript
const enhanceCode = async () => {
  const lastEnhanced = localStorage.getItem('lastEnhanced');
  if (lastEnhanced) {
    const timeSince = Date.now() - parseInt(lastEnhanced);
    if (timeSince < 5000) { // 5 second cooldown
      setError('Please wait a few seconds between enhancements');
      return;
    }
  }

  // ... enhancement code ...

  localStorage.setItem('lastEnhanced', Date.now().toString());
};
```

## Deployment Checklist

- [ ] API key set in Cloudflare
- [ ] Enhancement button added to UI
- [ ] Mermaid diagram component integrated
- [ ] Loading states implemented
- [ ] Error handling added
- [ ] Cache indicators shown
- [ ] CSS styles added
- [ ] Tested locally
- [ ] Tested in production
- [ ] Monitoring enabled

## Next Steps

1. **Implement basic enhancement button** (30 minutes)
   - Add button to Contract tab
   - Wire up API call
   - Show loading state

2. **Add diagram display** (20 minutes)
   - Update Architecture tab
   - Use existing MermaidDiagram component
   - Handle loading/errors

3. **Polish UX** (30 minutes)
   - Add CSS animations
   - Show cache indicators
   - Implement rate limiting

4. **Test & Deploy** (20 minutes)
   - Test all paths
   - Deploy to production
   - Monitor usage

**Total time:** ~2 hours for full integration

## Support

- **Example contracts to test:**
  - Minswap: `e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309`
  - JPG Store: `4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a`
  - SundaeSwap: `ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a`

- **Debugging:**
  - Check browser console for errors
  - Check Cloudflare logs: `wrangler pages deployment tail`
  - Verify API key: `wrangler pages secret list`

- **Questions:**
  - Create GitHub issue with `ui-integration` label
  - Include browser console output
  - Include screenshot if applicable

---

**Quick Start:**
1. Copy enhancement function from section 1
2. Add button to existing UI
3. Test with Minswap script hash
4. Deploy! 🚀
