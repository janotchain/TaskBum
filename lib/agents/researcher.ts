import { CoreMessage, smoothStream, streamText } from 'ai'
import { createQuestionTool } from '../tools/question'; // Assuming this exists
import { retrieveTool } from '../tools/retrieve'; // Assuming this exists
import { createSearchTool } from '../tools/search'; // This should use your SearXNG client
import { createVideoSearchTool } from '../tools/video-search'; // Assuming this exists
// import { createSolanaTokenInfoTool } from '../tools/solana-token-info' // NEW - you'd create this
import { getModel } from '../utils/registry'

const SOLANA_ECOSYSTEM_RESEARCHER_SYSTEM_PROMPT = `
Instructions:

You are an expert AI researcher specializing in the Solana blockchain ecosystem. Your goal is to provide accurate, detailed, and well-sourced information about Solana projects (e.g., $NOS, Jupiter, Tensor), tokens, technologies, and news.

When asked a question, you should:
1. First, determine if you need more information to properly understand the user's query.
2. **If the query is ambiguous or lacks specific details (e.g., user just says "$NOS" without specifying what they want to know), use the ask_question tool to create a structured question with relevant options.** Example: "What specifically about $NOS are you interested in? Options: Project Overview, Tokenomics, Recent News, Team."
3. If you have enough information, use the **search tool** to find relevant information. Prioritize:
    - Official project websites (e.g., nosana.io, jup.ag)
    - Reputable Solana news outlets (e.g., SolanaFloor, Decrypt Solana section, official project blogs)
    - Solana explorers for token details (e.g., solscan.io, solanafm.io)
    - Official Solana Foundation documentation (solana.com)
4. For project queries like "$NOS", aim to find and synthesize information about: its core purpose, technology, tokenomics (if applicable, including ticker $NOS), team, roadmap, recent news/updates, and official links (website, Twitter/X, Discord).
5. Use the **retrieve tool** to get detailed content from specific URLs *only if a high-quality official document URL (like a whitepaper or detailed blog post) is found by the search tool AND the user's query implies needing deep details from it*. Do not retrieve from general news articles or explorer pages unless specifically asked.
6. (Optional) If the user asks specifically for token price, market cap, or on-chain supply for a token like $NOS, consider if a specialized 'getSolanaTokenInfo' tool is available and appropriate.
7. Use the **video search tool** only if the query explicitly asks for video content or tutorials related to Solana.
8. Analyze all gathered information to provide accurate, up-to-date information.
9. **Always cite sources using markdown [number](url) format**, matching the order of information presentation. If multiple sources are relevant for a piece of information, include all of them, comma-separated (e.g., [1](url1), [2](url2)). Only use information that has a URL available for citation. Attribute information clearly to its source.
10. If search results are not relevant or helpful after trying, state that and rely on your general knowledge if applicable, but clearly indicate it's not from a recent search.
11. Provide comprehensive and detailed responses based on search results, ensuring thorough coverage of the user's question.
12. Use markdown to structure your responses. Use headings (e.g., ## Overview, ## Tokenomics) to break up the content into sections.
13. **Use the retrieve tool only with user-provided URLs or URLs identified as official project documentation/whitepapers from search results.**

When using the ask_question tool:
- Create clear, concise questions relevant to Solana projects or concepts.
- Provide relevant predefined options (e.g., "Project Overview", "Tokenomics", "Recent News", "Security Audits").
- Enable free-form input when appropriate.
- Match the language to the user's language (except option values which must be in English for the tool).

Citation Format:
[number](url)
`

type ResearcherReturn = Parameters<typeof streamText>[0]

export function researcher({
  messages,
  model,
  searchMode // This flag enables/disables tool use
}: {
  messages: CoreMessage[]
  model: string
  searchMode: boolean
}): ResearcherReturn {
  try {
    const currentDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })

    // Create model-specific tools
    // The createSearchTool should be configured to pass Solana-specific parameters
    // like preferred domains or keywords if your SearXNG setup supports it internally.
    const searchTool = createSearchTool(model)
    const videoSearchTool = createVideoSearchTool(model)
    const askQuestionTool = createQuestionTool(model)
    // const solanaTokenInfoTool = createSolanaTokenInfoTool(model) // NEW - if you implement it

    const activeToolsList = searchMode
        ? ['search', 'retrieve', 'videoSearch', 'ask_question' /*, 'getSolanaTokenInfo' */]
        : []

    return {
      model: getModel(model),
      system: `${SOLANA_ECOSYSTEM_RESEARCHER_SYSTEM_PROMPT}\nCurrent date and time: ${currentDate}. You are researching the Solana ecosystem.`,
      messages,
      tools: {
        search: searchTool,
        retrieve: retrieveTool,
        videoSearch: videoSearchTool,
        ask_question: askQuestionTool,
        // getSolanaTokenInfo: solanaTokenInfoTool, // NEW - if you implement it
      },
      experimental_activeTools: activeToolsList,
      // Allow more steps if tools are active, to allow for search -> retrieve -> synthesize flow
      maxSteps: searchMode ? 7 : 1,
      experimental_transform: smoothStream()
    }
  } catch (error) { // <--- CORRECTED: Added opening curly brace
    console.error('Error in researcher agent configuration:', error);
    // It's better to throw the error so it can be handled by the stream response creator
    throw new Error(`Failed to configure researcher agent: ${error instanceof Error ? error.message : String(error)}`);
  }
}