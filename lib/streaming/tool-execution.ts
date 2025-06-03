// (Likely in @/lib/streaming/tool-execution.ts)
import {
  CoreMessage,
  DataStreamWriter,
  generateId,
  generateText,
  JSONValue
} from 'ai'
import { z } from 'zod'
import { getModel } from '../utils/registry'
// Make sure searchSchema reflects parameters your SearXNG API route can use
// and that the LLM can reasonably provide for Solana queries.
import { searchSchema } from '../schema/search'; // This schema is used by the LLM
import { search as executeSearchViaApi } from '../tools/search'; // This is your client calling the /api/search POST endpoint
// import { getSolanaTokenInfo } from '../tools/solana-token-info' // NEW - if you create this tool
import { ExtendedCoreMessage } from '../types'
import { parseToolCallXml } from './parse-tool-call'

interface ToolExecutionResult {
  toolCallDataAnnotation: ExtendedCoreMessage | null
  toolCallMessages: CoreMessage[]
}

export async function executeToolCall(
  coreMessages: CoreMessage[],
  dataStream: DataStreamWriter,
  model: string, // Model for deciding tool call
  searchMode: boolean // From user preference
): Promise<ToolExecutionResult> {
  if (!searchMode) {
    return { toolCallDataAnnotation: null, toolCallMessages: [] }
  }

  // Dynamically generate a string representation of the search schema for the LLM prompt
  let toolDescriptions = `
Search parameters (for 'search' tool):
${Object.entries(searchSchema.shape)
    .map(([key, value]) => {
        // @ts-ignore
      const description = value.description || value._def?.innerType?.description || 'No description';
      const isOptional = value instanceof z.ZodOptional;
      return `- ${key}${isOptional ? ' (optional)' : ''}: ${description}`;
    })
    .join('\n')}
Default max_results for search is 10. search_depth can be 'basic' or 'advanced'.
include_domains can be a comma-separated list like 'solana.com,nosana.io'.
`
  // Add descriptions for other tools if they exist
  // E.g., if you add getSolanaTokenInfoTool:
  // toolDescriptions += `\n\ngetSolanaTokenInfo parameters:\n- tokenSymbol: string - The token symbol (e.g., $NOS, $JUP)\n- contractAddress (optional): string - The token's contract address on Solana.`

  const currentDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
  const defaultMaxResults = model?.includes('ollama') ? 5 : 10 // Adjusted for Solana

  const toolSelectionResponse = await generateText({
    model: getModel(model), // Use the specified model for tool decision
    system: `You are an intelligent assistant specializing in the Solana ecosystem.
Your task is to analyze the user's latest query in the conversation and decide if a tool is needed.
Current date and time: ${currentDate}.

Available tools:
1. search: Use for finding general information, project details, news, or documentation about Solana projects, tokens, or concepts.
2. (Future) getSolanaTokenInfo: Use *only if* the user specifically asks for current price, market cap, or detailed on-chain supply metrics for a specific token AND 'search' tool is unlikely to provide this directly.

Based on the user's last message, choose a tool or decide if no tool is needed.
Prioritize official sources and documentation when crafting search queries. For a query like "What is $NOS?", a good search query parameter might be "Nosana $NOS project overview solana".

Respond ONLY in XML format.
If using a tool:
<tool_call>
  <tool>tool_name</tool>
  <parameters>
    <query>search query text for 'search' tool</query>
    <max_results>${defaultMaxResults}</max_results>
    <search_depth>basic</search_depth> <!-- default to basic for speed -->
    <include_domains>solana.com,nosana.io,jup.ag,solscan.io,coingecko.com,decrypt.co/solana,solanafloor.com</include_domains> <!-- Suggest good starting domains -->
    <!-- <tokenSymbol>$XYZ</tokenSymbol> for 'getSolanaTokenInfo' tool -->
  </parameters>
</tool_call>

If no tool is needed, respond with:
<tool_call><tool></tool></tool_call>

Tool descriptions:
${toolDescriptions}
`,
    messages: coreMessages.slice(-3) // Use last few messages for context to decide tool
  })

  // Use your existing parseToolCallXml. It might need adjustment if your XML structure changes.
  const toolCall = parseToolCallXml(toolSelectionResponse.text, searchSchema) // Pass searchSchema for 'search' tool

  if (!toolCall || !toolCall.tool) {
    return { toolCallDataAnnotation: null, toolCallMessages: [] }
  }

  const toolCallId = `call_${generateId()}`
  let toolResultJson: string | undefined;
  let finalToolName = toolCall.tool; // For annotation

  // --- Tool Execution Logic ---
  try {
    dataStream.writeData({ type: 'tool_call', data: { state: 'call', toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters) } })

    if (toolCall.tool === 'search') {
      if (!toolCall.parameters?.query) {
        console.warn("Search tool called without a query parameter.");
        toolResultJson = JSON.stringify({ error: "Search query missing." });
      } else {
        // `executeSearchViaApi` is your function that calls the /api/search POST endpoint we defined earlier
        const searchResults = await executeSearchViaApi(
          toolCall.parameters.query,
          toolCall.parameters.max_results || defaultMaxResults,
          toolCall.parameters.search_depth as 'basic' | 'advanced' || 'basic',
          toolCall.parameters.include_domains || [], // Expects array
          toolCall.parameters.exclude_domains || []  // Expects array
        )
        toolResultJson = JSON.stringify(searchResults)
      }
    }
    // else if (toolCall.tool === 'getSolanaTokenInfo') { // Example for a new tool
    //   if (!toolCall.parameters?.tokenSymbol) {
    //     toolResultJson = JSON.stringify({ error: "Token symbol missing for getSolanaTokenInfo." });
    //   } else {
    //     const tokenInfo = await getSolanaTokenInfo(toolCall.parameters.tokenSymbol, toolCall.parameters.contractAddress);
    //     toolResultJson = JSON.stringify(tokenInfo);
    //   }
    // }
    else {
      console.warn(`Unknown tool selected by LLM: ${toolCall.tool}`)
      toolResultJson = JSON.stringify({ error: `Tool '${toolCall.tool}' is not implemented.` })
    }

    dataStream.writeMessageAnnotation({ type: 'tool_call', data: { state: 'result', toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters), result: toolResultJson }})

  } catch (toolError) {
    console.error(`Error executing tool ${finalToolName}:`, toolError);
    toolResultJson = JSON.stringify({ error: `Failed to execute tool ${finalToolName}: ${toolError instanceof Error ? toolError.message : String(toolError)}` });
    dataStream.writeMessageAnnotation({ type: 'tool_call', data: { state: 'error', toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters), result: toolResultJson }})
  }


  const toolCallDataAnnotation: ExtendedCoreMessage = {
    role: 'data',
    content: { type: 'tool_call', data: { toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters), result: toolResultJson } } as JSONValue
  }

  const toolCallMessages: CoreMessage[] = [
    // The Vercel AI SDK examples often use a 'tool' role message.
    // Or, you can use an assistant message that "pretends" it got the result.
    // For simple string results, assistant message is okay. For complex objects, 'tool' role is better.
    {
      role: 'assistant', // Or 'tool' role if your main LLM supports it better with `tool_results` name
      content: `[Tool Used: ${finalToolName}] Output:\n${toolResultJson}`
    },
    {
      role: 'user',
      content: 'Based on the tool output and our previous conversation, please provide a comprehensive answer to my original question about the Solana ecosystem. Ensure you synthesize the information and cite sources if they were part of the tool output.'
    }
  ]

  return { toolCallDataAnnotation, toolCallMessages }
}