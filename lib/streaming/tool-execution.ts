// @/lib/streaming/tool-execution.ts
import {
  CoreMessage,
  DataStreamWriter,
  generateId,
  generateText,
  JSONValue,
  ToolExecutionOptions // Ensure this is imported
} from 'ai';
import { z, ZodObject, ZodOptional } from 'zod';
import { searchSchema } from '../schema/search';
import { solanaTokenMarketDataSchema } from '../schema/solanaTokenMarketData';
import { search as executeSearchViaApi } from '../tools/search';
import { getSolanaTokenMarketDataTool } from '../tools/solanaTokenMarketData'; // Your tool object
import { ExtendedCoreMessage } from '../types';
import { getModel } from '../utils/registry';
import { parseToolCallXml } from './parse-tool-call';


// Helper function to safely get the shape of a Zod schema
function getZodObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
  if (schema instanceof ZodObject) {
    return schema.shape;
  }
  if (schema._def && typeof schema._def === 'object' && 'schema' in schema._def && schema._def.schema instanceof ZodObject) {
    return schema._def.schema.shape;
  }
  console.warn("Could not determine ZodObject shape for schema:", schema?.constructor?.name);
  return null;
}

interface ToolExecutionResult {
  toolCallDataAnnotation: ExtendedCoreMessage | null;
  toolCallMessages: CoreMessage[];
}

export async function executeToolCall(
  coreMessages: CoreMessage[], // These are the messages we need for ToolExecutionOptions
  dataStream: DataStreamWriter,
  model: string,
  searchMode: boolean
): Promise<ToolExecutionResult> {
  if (!searchMode) {
    return { toolCallDataAnnotation: null, toolCallMessages: [] };
  }

  const searchShape = getZodObjectShape(searchSchema);
  const marketDataShape = getZodObjectShape(solanaTokenMarketDataSchema);

  let toolDescriptions = `
Available tools:
1.  **search**: Use for finding general information, project details, news, documentation about Solana projects, tokens, or concepts. Also use this tool FIRST to find a token's **Mint Address** if only a symbol is known and market data is subsequently needed.
    Search parameters (for 'search' tool):
    ${searchShape ? Object.entries(searchShape)
      .map(([key, value]) => {
        const fieldSchema = value as z.ZodTypeAny;
        const description =
          (fieldSchema as any).description ||
          (fieldSchema._def as any)?.description ||
          ((fieldSchema._def as any)?.innerType?._def as any)?.description ||
          'No description available';
        const isOptional = fieldSchema instanceof ZodOptional || (fieldSchema._def as any)?.typeName === 'ZodOptional';
        return `- ${key}${isOptional ? ' (optional)' : ''}: ${description}`;
      })
      .join('\n') : 'Search parameters not available.'}
    Default max_results for search is 7. search_depth can be 'basic' or 'advanced'.
    include_domains example: 'solana.com,nosana.io'.

2.  **getSolanaTokenMarketDataTool**: Use *after* you know the token symbol and preferably its Mint Address (which you might find using the 'search' tool). This tool fetches current market data like price, volume, market cap, supply, and holder counts from sources like Birdeye and Solscan.
    getSolanaTokenMarketDataTool parameters:
    ${marketDataShape ? Object.entries(marketDataShape)
      .map(([key, value]) => {
        const fieldSchema = value as z.ZodTypeAny;
        const description =
          (fieldSchema as any).description ||
          (fieldSchema._def as any)?.description ||
          ((fieldSchema._def as any)?.innerType?._def as any)?.description ||
          'No description available';
        const isOptional = fieldSchema instanceof ZodOptional || (fieldSchema._def as any)?.typeName === 'ZodOptional';
        return `- ${key}${isOptional ? ' (optional)' : ''}: ${description}`;
      })
      .join('\n') : 'Market data tool parameters not available.'}
    (Either tokenSymbol or tokenMintAddress must be provided for getSolanaTokenMarketDataTool. Mint address is more reliable.)
`;

  const currentDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const defaultMaxResultsSearch = model?.includes('ollama') ? 5 : 7;

  const toolSelectionResponse = await generateText({
    model: getModel(model),
    system: `You are an intelligent assistant specializing in the Solana ecosystem.
Your task is to analyze the user's latest query in the conversation and decide which tool, if any, is most appropriate to use.
Current date and time: ${currentDate}.

${toolDescriptions}

Based on the user's last message, choose a tool or decide if no tool is needed.
If the user asks for market data (price, MC, volume) of a token (e.g., "$NOS"), and you don't know its mint address, FIRST use the 'search' tool to find the mint address. THEN, in a subsequent step (not this one), the system can use 'getSolanaTokenMarketDataTool'.
If the mint address IS known or provided, or if the symbol is very unique, you can directly choose 'getSolanaTokenMarketDataTool'.

Respond ONLY in XML format.
If using 'search' tool:
<tool_call>
  <tool>search</tool>
  <parameters>
    <query>Solana-focused search query text</query>
    <max_results>${defaultMaxResultsSearch}</max_results>
    <search_depth>basic</search_depth>
    <include_domains>solana.com,nosana.io,jup.ag,solscan.io,coingecko.com,decrypt.co/solana,solanafloor.com</include_domains>
  </parameters>
</tool_call>

If using 'getSolanaTokenMarketDataTool':
<tool_call>
  <tool>getSolanaTokenMarketDataTool</tool>
  <parameters>
    <tokenSymbol>$XYZ</tokenSymbol> <!-- e.g., $NOS -->
    <tokenMintAddress>XYZ_MINT_ADDRESS_IF_KNOWN</tokenMintAddress> <!-- e.g., NosPrivate... -->
  </parameters>
</tool_call>

If no tool is needed, respond with:
<tool_call><tool></tool></tool_call>
`,
    // Pass only a subset of messages relevant for tool selection to this LLM
    // The full `coreMessages` will be passed to the tool's execute function via ToolExecutionOptions
    messages: coreMessages.slice(-Math.min(coreMessages.length, 5))
  });

  const parsedXmlForToolName = parseToolCallXml(toolSelectionResponse.text);
  const chosenToolName = parsedXmlForToolName.tool;

  let toolCall: any;
  if (chosenToolName === 'search') {
    toolCall = parseToolCallXml(toolSelectionResponse.text, searchSchema);
  } else if (chosenToolName === 'getSolanaTokenMarketDataTool') {
    toolCall = parseToolCallXml(toolSelectionResponse.text, solanaTokenMarketDataSchema);
  } else if (chosenToolName) {
    console.warn(`LLM chose tool '${chosenToolName}' but no specific schema was found for parsing its parameters.`);
    toolCall = parsedXmlForToolName;
  }


  if (!toolCall || !toolCall.tool) {
    return { toolCallDataAnnotation: null, toolCallMessages: [] };
  }

  const toolCallId = `call_${generateId()}`;
  let toolResultJson: string | undefined;
  const finalToolName = toolCall.tool;

  // --- Prepare ToolExecutionOptions ---
  // It requires 'toolCallId' and 'messages' (the full conversation context for the tool if needed)
  const toolExecutionOptions: ToolExecutionOptions = {
    toolCallId: toolCallId,
    messages: coreMessages, // Pass the full current message history
    // run: undefined, // Optional: If you have a 'run' object for tracing
    // functions: undefined // Optional: If functions are needed by the tool
  };

  try {
    dataStream.writeData({ type: 'tool_call', data: { state: 'call', toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters) } });

    if (finalToolName === 'search') {
      if (!toolCall.parameters?.query) {
        console.warn("Search tool called without a query parameter.");
        toolResultJson = JSON.stringify({ error: "Search query missing." });
      } else {
        // If executeSearchViaApi was defined using Vercel AI SDK's `tool()`, it would also need toolExecutionOptions.
        // Assuming it's a direct function call for now.
        const searchResults = await executeSearchViaApi(
          toolCall.parameters.query,
          toolCall.parameters.max_results || defaultMaxResultsSearch,
          toolCall.parameters.search_depth as 'basic' | 'advanced' || 'basic',
          toolCall.parameters.include_domains || [],
          toolCall.parameters.exclude_domains || []
        );
        toolResultJson = JSON.stringify(searchResults);
      }
    } else if (finalToolName === 'getSolanaTokenMarketDataTool') {
      if (!toolCall.parameters?.tokenSymbol && !toolCall.parameters?.tokenMintAddress) {
        console.warn("getSolanaTokenMarketDataTool called without symbol or mint address.");
        toolResultJson = JSON.stringify({ error: "Token symbol or mint address missing for market data." });
      } else {
        const marketData = await getSolanaTokenMarketDataTool.execute(
          toolCall.parameters,
          toolExecutionOptions // Pass the options object with messages
        );
        toolResultJson = JSON.stringify(marketData);
      }
    } else {
      console.warn(`Unknown tool selected by LLM or tool not implemented: ${finalToolName}`);
      toolResultJson = JSON.stringify({ error: `Tool '${finalToolName}' is not implemented or recognized.` });
    }

    dataStream.writeMessageAnnotation({ type: 'tool_call', data: { state: 'result', toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters), result: toolResultJson } });

  } catch (toolError: any) {
    console.error(`Error executing tool ${finalToolName}:`, toolError);
    toolResultJson = JSON.stringify({ error: `Failed to execute tool ${finalToolName}: ${toolError.message}` });
    dataStream.writeMessageAnnotation({ type: 'tool_call', data: { state: 'error', toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters), result: toolResultJson } });
  }

  const toolCallDataAnnotation: ExtendedCoreMessage = {
    role: 'data',
    content: { type: 'tool_call', data: { toolCallId, toolName: finalToolName, args: JSON.stringify(toolCall.parameters), result: toolResultJson } } as JSONValue
  };

  const toolCallMessages: CoreMessage[] = [
    {
      role: 'assistant',
      content: `[Tool Used: ${finalToolName}]\nOutput:\n${toolResultJson}`
    },
    {
      role: 'user',
      content: `The user's original query led to the use of the '${finalToolName}' tool, and the output is provided above.
Please analyze this output in the context of our conversation.
- If the tool was 'search', synthesize the search results to answer the user's question about the Solana ecosystem. Cite sources using [number](url) format.
- If the tool was 'getSolanaTokenMarketDataTool', present the key market data (price, volume, market cap, supply, holders) clearly. Mention the sources (Birdeye, Solscan) and the 'lastUpdated' time from the tool's output.
- If there were errors from the tool, acknowledge them.
Now, provide a comprehensive response to the user based on this information.`
    }
  ];

  return { toolCallDataAnnotation, toolCallMessages };
}