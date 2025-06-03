// @/lib/agents/manual-researcher.ts
import { CoreMessage, smoothStream, streamText } from 'ai';
import { getModel } from '../utils/registry';

// Base prompt for Solana focus, emphasizing detail and structure
const BASE_SOLANA_RESEARCHER_PROMPT = `
You are an expert AI assistant specializing in the Solana blockchain ecosystem.
Your goal is to provide comprehensive, accurate, and well-sourced information.

General Instructions:
1. Provide detailed and thorough responses to the user's questions.
2. Structure your responses clearly using markdown, including headings (e.g., ## Overview, ## Tokenomics, ## Market Data).
3. If you are uncertain about specific details based on the provided information, acknowledge this.
4. Focus on accuracy. If information seems conflicting or unclear, point it out.
`;

// Prompt when search results (or other tool results) are available
const PROCESS_TOOL_OUTPUT_PROMPT = `
${BASE_SOLANA_RESEARCHER_PROMPT}

You have been provided with output from a tool (either 'search' or 'getSolanaTokenMarketDataTool') in the preceding assistant message.
Your task is to analyze this tool output and synthesize a comprehensive answer to the user's original query, considering our entire conversation history.

If the preceding tool output is from the 'search' tool:
1.  Analyze the provided search results (which are in JSON format, typically an array of objects with 'title', 'url', 'content').
2.  Synthesize the information from relevant search results to answer the user's question.
3.  **Always cite sources using markdown [number](url) format**, corresponding to the 'url' field from the search results. If multiple sources are relevant for a piece of information, include all applicable citations.
4.  Only use information that has an explicit URL for citation from the search results.
5.  If the search results do not contain relevant information, clearly state this.

If the preceding tool output is from the 'getSolanaTokenMarketDataTool':
1.  The tool output is a JSON object containing fields like 'birdeye' (for price, volume, etc.) and 'solscan' (for supply, holders, etc.), and an overall 'lastUpdated' timestamp.
2.  Present the key market data clearly. For example:
    *   Current Price (from Birdeye): $X.XX
    *   24h Volume (from Birdeye): $Y,YYY
    *   Market Cap (from Birdeye or Solscan): $Z,ZZZ
    *   Circulating/Total Supply (from Solscan): A / B tokens
    *   Holders (from Solscan): N
3.  **Clearly attribute data to its source (Birdeye or Solscan) as indicated in the tool output.**
4.  Include the direct URLs for the token on Birdeye and Solscan if provided in the tool's output, as citations or for user verification.
5.  Mention the 'lastUpdated' time of the data.
6.  If the tool output indicates errors in fetching data from a source, mention that the data for that source might be unavailable or incomplete.

If the tool output indicates an error in tool execution itself:
1.  Acknowledge that the tool encountered an issue and the requested information might not be available.

After processing the tool output, provide a final, well-structured answer.
`;

// Prompt when no search/tool use was enabled or occurred
const GENERAL_KNOWLEDGE_SOLANA_PROMPT = `
${BASE_SOLANA_RESEARCHER_PROMPT}

Important:
1. Provide responses based on your general knowledge of the Solana ecosystem.
2. Be clear about any limitations in your knowledge, especially regarding real-time data or very recent developments.
3. You can suggest that using search or specialized tools (if available in the platform) might provide more up-to-date or specific information if you feel your knowledge is insufficient.
`;

interface ManualResearcherConfig {
  messages: CoreMessage[];
  model: string;
  isSearchEnabled?: boolean; // This now more broadly means "are tools enabled/used"
}

type ManualResearcherReturn = Parameters<typeof streamText>[0];

export function manualResearcher({
  messages,
  model,
  isSearchEnabled = true // If false, implies no tool was used in the preceding step.
}: ManualResearcherConfig): ManualResearcherReturn {
  try {
    const currentDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    // Determine the system prompt based on whether a tool was likely used.
    // The last user message in `executeToolCall` guides this LLM.
    // If `isSearchEnabled` is true, we assume a tool's output is in the latest messages.
    const systemPrompt = isSearchEnabled
      ? PROCESS_TOOL_OUTPUT_PROMPT
      : GENERAL_KNOWLEDGE_SOLANA_PROMPT;

    return {
      model: getModel(model),
      system: `${systemPrompt}\nCurrent date and time: ${currentDate}. You are acting as a Solana Ecosystem Researcher.`,
      messages, // These messages will include the [Tool Used:] output and the guiding user prompt
      temperature: 0.5, // Slightly lower temp for more factual synthesis
      // topP: 1, // Defaults are usually fine
      // topK: 40,
      experimental_transform: smoothStream()
    };
  } catch (error) {
    console.error('Error in manualResearcher:', error);
    throw error;
  }
}