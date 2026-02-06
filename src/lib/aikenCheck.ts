// Aiken syntax checker using client-side WASM
// ~880KB WASM bundle, runs entirely in browser

let wasmModule: any = null;
let initPromise: Promise<void> | null = null;

interface AikenCheckResult {
  valid: boolean;
  errors?: string[];
}

async function initWasm(): Promise<void> {
  if (wasmModule) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const wasmUrl = '/wasm/aiken_check_wasm_bg.wasm';
      const jsUrl = '/wasm/aiken_check_wasm.js';
      // Use @vite-ignore to prevent Rollup from trying to resolve at build time
      const jsModule = await import(/* @vite-ignore */ jsUrl);
      
      const wasmResponse = await fetch(wasmUrl);
      const wasmBytes = await wasmResponse.arrayBuffer();
      
      await jsModule.default(wasmBytes);
      wasmModule = jsModule;
    } catch (err) {
      console.error('Failed to load Aiken WASM:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

export async function checkAikenSyntax(code: string): Promise<AikenCheckResult> {
  try {
    await initWasm();
    
    if (!wasmModule?.check_aiken) {
      return { valid: false, errors: ['WASM module not loaded'] };
    }

    const resultJson = wasmModule.check_aiken(code);
    const result = JSON.parse(resultJson);
    
    return {
      valid: result.valid === true,
      errors: result.errors || []
    };
  } catch (err) {
    console.error('Aiken check error:', err);
    return { 
      valid: false, 
      errors: [err instanceof Error ? err.message : 'Unknown error'] 
    };
  }
}

// Preload WASM in background (call on page load)
export function preloadAikenWasm(): void {
  initWasm().catch(() => {
    // Silently fail on preload - will retry on actual use
  });
}
