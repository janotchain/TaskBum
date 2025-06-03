// @/lib/tools/solanaTokenMarketData.ts
import { SolanaTokenMarketDataParams, solanaTokenMarketDataSchema } from '@/lib/schema/solanaTokenMarketData';
import { tool } from 'ai';

// --- Placeholder Data Structures (Define these based on actual API responses) ---
interface BirdeyeData {
  price?: number;
  volume24h?: number;
  liquidity?: number;
  mc?: number; // Market Cap
  source?: string;
  url?: string;
  error?: string;
}

interface SolscanData {
  price?: number; // Solscan might not always have live price for all tokens
  marketCap?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  holders?: number;
  source?: string;
  url?: string;
  error?: string;
}

interface CombinedMarketData {
  tokenSymbol?: string;
  tokenMintAddress?: string;
  birdeye?: BirdeyeData;
  solscan?: SolscanData;
  lastUpdated?: string;
  errors?: string[];
}
// --- End Placeholder Data Structures ---


// --- API Fetching Logic (Implement these with actual API calls or scraping) ---

async function fetchBirdeyeData(params: SolanaTokenMarketDataParams): Promise<BirdeyeData> {
  // IMPORTANT: Replace with actual Birdeye API call if available and you have a key.
  // This is a conceptual placeholder. Birdeye has an API - check their documentation.
  // https://birdeye.so/documentation/reference/price
  // https://birdeye.so/documentation/reference/tokenoverview
  console.log(`Fetching Birdeye data for: ${params.tokenSymbol || params.tokenMintAddress}`);
  const birdeyeApiKey = process.env.BIRDEYE_API_KEY;
  if (!birdeyeApiKey) return { error: "Birdeye API key not configured.", source: "Birdeye" };

  let identifier = params.tokenMintAddress || params.tokenSymbol; // Birdeye might prefer mint address

  // Example: Using mint address if available
  if (params.tokenMintAddress) {
    try {
      const response = await fetch(`https://public-api.birdeye.so/public/price?address=${params.tokenMintAddress}`, {
        headers: { 'X-API-KEY': birdeyeApiKey }
      });
      if (!response.ok) throw new Error(`Birdeye API error (price): ${response.status}`);
      const priceData = await response.json();

      const overviewResponse = await fetch(`https://public-api.birdeye.so/public/overview/token/${params.tokenMintAddress}`, {
         headers: { 'X-API-KEY': birdeyeApiKey }
      });
      if (!overviewResponse.ok) throw new Error(`Birdeye API error (overview): ${overviewResponse.status}`);
      const overviewData = await overviewResponse.json();


      return {
        price: priceData.data?.value,
        // mc: overviewData.data?.mc, // Example, adapt to actual response
        // volume24h: overviewData.data?.v24hUSD, // Example
        source: "Birdeye API",
        url: `https://birdeye.so/token/${params.tokenMintAddress}?chain=solana`,
      };
    } catch (e: any) {
      console.error("Birdeye API fetch error:", e.message);
      return { error: `Birdeye API fetch error: ${e.message}`, source: "Birdeye" };
    }
  }
  return { error: "Birdeye: Mint address preferred for precise data.", source: "Birdeye" };
}

async function fetchSolscanData(params: SolanaTokenMarketDataParams): Promise<SolscanData> {
  // IMPORTANT: Replace with actual Solscan API call if available.
  // Solscan has a public API, but check its capabilities for market data.
  // https://public-api.solscan.io/docs/#/
  // This is a conceptual placeholder.
  console.log(`Fetching Solscan data for: ${params.tokenSymbol || params.tokenMintAddress}`);
  const identifier = params.tokenMintAddress || params.tokenSymbol;

  if (params.tokenMintAddress) {
    try {
      // Example: Fetching token metadata from Solscan
      // Note: Solscan's public API might not provide real-time price for all tokens.
      // It's excellent for supply, holders, metadata.
      const response = await fetch(`https://public-api.solscan.io/token/meta?tokenAddress=${params.tokenMintAddress}`);
      if (!response.ok) throw new Error(`Solscan API error: ${response.status}`);
      const data = await response.json();

      return {
        // price: data.priceUsdt, // If available, otherwise LLM should know Solscan isn't primary price source
        marketCap: data.marketCapFD, // Fully diluted market cap
        circulatingSupply: data.supply, // This is often total supply on Solscan, clarify if it's circulating
        totalSupply: data.supply,
        holders: data.holder,
        source: "Solscan API",
        url: `https://solscan.io/token/${params.tokenMintAddress}`,
      };
    } catch (e: any) {
      console.error("Solscan API fetch error:", e.message);
      return { error: `Solscan API fetch error: ${e.message}`, source: "Solscan" };
    }
  }
  return { error: "Solscan: Mint address required for precise data.", source: "Solscan" };
}

// --- The Tool Definition ---
export const getSolanaTokenMarketDataTool = tool({
  description: "Fetches current market data (price, volume, market cap, supply etc.) for a specific Solana token from sources like Birdeye (for price/trading) and Solscan (for supply/holders).",
  parameters: solanaTokenMarketDataSchema,
  execute: async (params: SolanaTokenMarketDataParams): Promise<CombinedMarketData | { error: string }> => {
    if (!params.tokenSymbol && !params.tokenMintAddress) {
      return { error: "Tool execution error: Token symbol or mint address is required." };
    }

    const results: CombinedMarketData = {
      tokenSymbol: params.tokenSymbol,
      tokenMintAddress: params.tokenMintAddress,
      errors: []
    };

    // Fetch from Birdeye (prioritize for price/market data)
    const birdeyeResult = await fetchBirdeyeData(params);
    if (birdeyeResult.error) results.errors?.push(birdeyeResult.error);
    results.birdeye = birdeyeResult;

    // Fetch from Solscan (good for supply, holders, general metadata)
    const solscanResult = await fetchSolscanData(params);
    if (solscanResult.error) results.errors?.push(solscanResult.error);
    results.solscan = solscanResult;

    results.lastUpdated = new Date().toISOString();

    if (!birdeyeResult.price && !solscanResult.circulatingSupply && (results.errors?.length || 0) > 1) {
        return { error: `Failed to fetch significant market data. Errors: ${results.errors?.join('; ')}` };
    }

    // The LLM will receive this structured object.
    // It needs to be prompted on how to interpret and present this data.
    return results;
  }
});