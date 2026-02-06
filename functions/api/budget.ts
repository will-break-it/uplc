// Cloudflare Pages Function to fetch recent redeemer execution units from Koios

interface Env {}

interface RedeemerInfo {
  script_hash: string;
  redeemer_hash: string;
  tx_hash: string;
  tx_index: number;
  unit_mem: string;
  unit_steps: string;
  purpose: string;
}

interface BudgetResult {
  samples: number;
  avg_mem: number;
  avg_cpu: number;
  max_mem: number;
  max_cpu: number;
  pct_mem: number;
  pct_cpu: number;
}

// Current Plutus budget limits (as of 2024)
const MAX_MEM = 14_000_000;  // 14M memory units
const MAX_CPU = 10_000_000_000;  // 10B CPU steps

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const url = new URL(context.request.url);
    const scriptHash = url.searchParams.get('hash');
    
    if (!scriptHash) {
      return new Response(JSON.stringify({ error: 'Missing hash parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Fetch last 5 redeemers for this script
    const response = await fetch('https://api.koios.rest/api/v1/script_redeemers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        _script_hash: scriptHash,
        _limit: 5
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Koios error: ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const redeemers = await response.json() as RedeemerInfo[];
    
    if (!redeemers || redeemers.length === 0) {
      return new Response(JSON.stringify({ error: 'No redeemer data available' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Calculate stats
    const mems = redeemers.map(r => parseInt(r.unit_mem, 10));
    const cpus = redeemers.map(r => parseInt(r.unit_steps, 10));
    
    const avg_mem = Math.round(mems.reduce((a, b) => a + b, 0) / mems.length);
    const avg_cpu = Math.round(cpus.reduce((a, b) => a + b, 0) / cpus.length);
    const max_mem = Math.max(...mems);
    const max_cpu = Math.max(...cpus);

    const result: BudgetResult = {
      samples: redeemers.length,
      avg_mem,
      avg_cpu,
      max_mem,
      max_cpu,
      pct_mem: Math.round((avg_mem / MAX_MEM) * 1000) / 10,  // 1 decimal
      pct_cpu: Math.round((avg_cpu / MAX_CPU) * 1000) / 10,
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};
