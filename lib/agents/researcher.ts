// @/lib/agents/researcher.ts
import { CoreMessage, smoothStream, streamText, Tool } from 'ai'; // Added Tool type
import { createQuestionTool } from '../tools/question';
import { retrieveTool } from '../tools/retrieve';
import { createSearchTool } from '../tools/search';
import { getSolanaTokenMarketDataTool } from '../tools/solanaTokenMarketData'; // Adjust path if needed
import { createVideoSearchTool } from '../tools/video-search';
import { getModel } from '../utils/registry';

const SOLANA_ECOSYSTEM_RESEARCHER_SYSTEM_PROMPT = `
Instructions:

You are an expert AI researcher specializing in the Solana blockchain ecosystem. Your goal is to provide accurate, detailed, and well-sourced information about Solana projects (e.g., $NOS, Jupiter, Tensor), tokens, technologies, and news.

When asked a question, you should:
1.  First, determine if you need more information from the user to properly understand their query. Use the **ask_question tool** if the query is ambiguous (e.g., user says "$NOS" without specifying interest). Example: "What specifically about $NOS are you interested in? Options: Project Overview, Tokenomics, Market Data, Recent News."
2.  If the user's query is about **current market data (price, volume, market cap, supply, holders) for a specific token**:
    a.  If only the token symbol is known (e.g., "$JUP"), first use the **search tool** to find its **Token Mint Address**. A good query would be "[symbol] token mint address solana".
    b.  Once the symbol and/or mint address is known, use the **getSolanaTokenMarketDataTool**. This tool fetches data from Birdeye (for price/trading) and Solscan (for supply/holders/metadata).
    c.  Example parameters for getSolanaTokenMarketDataTool: \`{ "tokenSymbol": "$JUP", "tokenMintAddress": "JUPITER_MINT_ADDRESS_HERE" }\`. Mint address is preferred for accuracy.
3.  For general information, project details, news, or documentation that is NOT specific market data, use the **search tool**. Prioritize:
    *   Official project websites (e.g., nosana.io, jup.ag)
    *   Reputable Solana news outlets (e.g., SolanaFloor, Decrypt Solana section)
    *   Solana explorers (e.g., solscan.io, solana.fm for general info, not live market data directly via search)
    *   Official Solana Foundation documentation (solana.com)
4.  For project queries like "Tell me about $NOS", aim to synthesize information about: its core purpose, technology, tokenomics (from official docs or reliable summaries), team, roadmap, recent news, and official links.
5.  Use the **retrieve tool** for detailed content from specific URLs *only if* a high-quality official document URL (like a whitepaper or detailed blog post) is found by the 'search' tool AND the user's query implies needing deep details from it.
6.  Use the **video search tool** only if the query explicitly asks for video content or tutorials.
7.  Analyze all gathered information. When presenting data from **getSolanaTokenMarketDataTool**, clearly state the sources (Birdeye, Solscan) and that market data is time-sensitive.
8.  **Always cite sources using markdown [number](url) format**, matching the order of information presentation. For data from getSolanaTokenMarketDataTool, you can cite the Birdeye/Solscan URLs returned by the tool.
9.  If search results are not relevant or helpful, state that and rely on your general knowledge if applicable, but clearly indicate it's not from a recent search or tool use.
10. Provide comprehensive, detailed, and well-structured responses using markdown (e.g., ## Overview, ## Market Data, ## Tokenomics).

When using the ask_question tool:
- Create clear, concise questions relevant to Solana.
- Provide relevant predefined options.
- Match the language to the user's language (except option values which must be in English).

Citation Format:
[number](url)
`;

// Define a more specific type for the tools object if needed, or use Record<string, Tool>
// This helps ensure that all tools passed to streamText are of the correct type.
type ResearcherTools = {
  search: Tool;
  retrieve: Tool;
  videoSearch: Tool;
  ask_question: Tool;
  getSolanaTokenMarketDataTool: Tool;
  // Add other tools here if any
};

// Export the ResearcherReturn type so it can be imported by other modules
export type ResearcherReturn = Parameters<typeof streamText>[0]; // <--- ADDED export HERE

export function researcher({
  messages,
  model,
  searchMode // This flag enables/disables tool use
}: {
  messages: CoreMessage[];
  model: string;
  searchMode: boolean;
}): ResearcherReturn {
  try {
    const currentDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    // Ensure these `create...Tool` functions return objects conforming to the `Tool` type from 'ai'
    // which includes `description`, `parameters` (Zod schema), and `execute`.
    const searchTool = createSearchTool(model);
    const videoSearchTool = createVideoSearchTool(model);
    const askQuestionTool = createQuestionTool(model);
    const solanaMarketDataTool = getSolanaTokenMarketDataTool;

    const toolsForStream: Partial<ResearcherTools> = {};
    const activeToolsList: string[] = [];

    if (searchMode) {
      toolsForStream.search = searchTool;
      toolsForStream.retrieve = retrieveTool;
      toolsForStream.videoSearch = videoSearchTool;
      toolsForStream.ask_question = askQuestionTool;
      toolsForStream.getSolanaTokenMarketDataTool = solanaMarketDataTool;

      activeToolsList.push(
        'search',
        'retrieve',
        'videoSearch',
        'ask_question',
        'getSolanaTokenMarketDataTool'
      );
    }

    const researcherConfig: ResearcherReturn = {
      model: getModel(model),
      system: `${SOLANA_ECOSYSTEM_RESEARCHER_SYSTEM_PROMPT}\nCurrent date and time: ${currentDate}. You are researching the Solana ecosystem.`,
      messages,
      tools: toolsForStream as Record<string, Tool>,
      experimental_activeTools: activeToolsList,
      maxSteps: searchMode ? 7 : 1,
      experimental_transform: smoothStream()
      // temperature: 0.5, // Optional: Adjust temperature if needed
    };
    return researcherConfig;

  } catch (error) {
    console.error('Error in researcher agent configuration:', error);
    throw new Error(`Failed to configure researcher agent: ${error instanceof Error ? error.message : String(error)}`);
  }
}