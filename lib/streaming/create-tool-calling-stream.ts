import { researcher, ResearcherReturn } from '@/lib/agents/researcher';
import {
  convertToCoreMessages,
  CoreMessage,
  createDataStreamResponse,
  DataStreamWriter,
  streamText,
  StreamTextResult,
  ToolCall as VercelToolCall,
  ToolResult as VercelToolResult
} from 'ai';
import { getMaxAllowedTokens, truncateMessages } from '../utils/context-window';
import { isReasoningModel } from '../utils/registry';
import { handleStreamFinish } from './handle-stream-finish';
import { BaseStreamConfig } from './types';

// Function to check if a message contains ask_question tool invocation
function containsAskQuestionTool(message: CoreMessage): boolean {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return false;
  }
  return message.content.some(
    (item) => item.type === 'tool-call' && item.toolName === 'ask_question'
  );
}

export function createToolCallingStreamResponse(config: BaseStreamConfig) {
  return createDataStreamResponse({
    execute: async (dataStream: DataStreamWriter) => {
      const { messages, model, chatId, searchMode, userId } = config;
      const modelId = `${model.providerId}:${model.id}`;

      try {
        const coreMessages = convertToCoreMessages(messages);
        const truncatedMessages = truncateMessages(
          coreMessages,
          getMaxAllowedTokens(model)
        );

        const researcherConfig: ResearcherReturn = researcher({
          messages: truncatedMessages,
          model: modelId,
          searchMode
        });

        console.log('============================================================');
        console.log('[NATIVE_TOOL_STREAM_INIT] Initializing streamText for native tool calling.');
        console.log('[NATIVE_TOOL_STREAM_INIT] Chat ID:', chatId);
        console.log('[NATIVE_TOOL_STREAM_INIT] User ID:', userId);
        console.log('[NATIVE_TOOL_STREAM_INIT] Model ID:', modelId);
        console.log('[NATIVE_TOOL_STREAM_INIT] Search Mode:', searchMode);
        console.log('[NATIVE_TOOL_STREAM_INIT] System Prompt Snippet:', researcherConfig.system?.substring(0, 250) + "...");
        console.log('[NATIVE_TOOL_STREAM_INIT] Tools Registered:', Object.keys(researcherConfig.tools || {}));
        console.log('[NATIVE_TOOL_STREAM_INIT] Active Tools:', researcherConfig.experimental_activeTools);
        console.log('[NATIVE_TOOL_STREAM_INIT] Max Steps:', researcherConfig.maxSteps);
        console.log('============================================================');

        // Corrected typing for streamTextResult
        const streamTextResult: StreamTextResult<
          typeof researcherConfig.tools, // First generic: The ToolSet
          false                       // Second generic: For EXPERIMENTAL_STREAM_DATA or similar, defaulting to false
        > = await streamText({
          ...researcherConfig,

          onToolCall: (toolCallDetails: { toolCall: VercelToolCall; DONT_EXECUTE?: boolean }) => {
            const { toolCall } = toolCallDetails;
            console.log('------------------------------------------------------------');
            console.log('[NATIVE_TOOL_CALL_ATTEMPT] LLM is attempting to call a tool:');
            console.log('[NATIVE_TOOL_CALL_ATTEMPT] Tool Name:', toolCall.toolName);
            console.log('[NATIVE_TOOL_CALL_ATTEMPT] Tool Call ID:', toolCall.toolCallId);
            console.log('[NATIVE_TOOL_CALL_ATTEMPT] Arguments:', JSON.stringify(toolCall.args, null, 2));
            console.log('------------------------------------------------------------');
          },

          onToolResult: (toolResultDetails: { toolCall: VercelToolCall; toolResult: VercelToolResult }) => {
            const { toolResult } = toolResultDetails;
            console.log('------------------------------------------------------------');
            console.log('[NATIVE_TOOL_RESULT] Tool execution finished:');
            console.log('[NATIVE_TOOL_RESULT] Tool Name:', toolResult.toolName);
            console.log('[NATIVE_TOOL_RESULT] Tool Call ID:', toolResult.toolCallId);
            const resultSummary = typeof toolResult.result === 'string'
              ? toolResult.result.substring(0, 300) + (toolResult.result.length > 300 ? "..." : "")
              : JSON.stringify(toolResult.result).substring(0, 300) + (JSON.stringify(toolResult.result).length > 300 ? "..." : "");
            console.log('[NATIVE_TOOL_RESULT] Result (summary):', resultSummary);
            console.log('------------------------------------------------------------');
          },

          onFinish: async (resultDetails) => {
            console.log('============================================================');
            console.log('[NATIVE_TOOL_STREAM_FINISH] streamText finished.');
            console.log('[NATIVE_TOOL_STREAM_FINISH] Finish Reason:', resultDetails.finishReason);
            console.log('============================================================');

            const finalMessagesFromStream = resultDetails.messages;

            const shouldSkipRelatedQuestions =
              isReasoningModel(modelId) ||
              (finalMessagesFromStream.length > 0 &&
                containsAskQuestionTool(
                  finalMessagesFromStream[finalMessagesFromStream.length - 1]
                ));

            await handleStreamFinish({
              responseMessages: finalMessagesFromStream,
              originalMessages: messages,
              model: modelId,
              chatId,
              dataStream,
              userId,
              skipRelatedQuestions: shouldSkipRelatedQuestions
            });
          }
        });

        if (typeof (streamTextResult as any)?.mergeIntoDataStream === 'function') {
             (streamTextResult as any).mergeIntoDataStream(dataStream);
        }

      } catch (error) {
        console.error('[NATIVE_TOOL_STREAM_ERROR] Stream execution error in createToolCallingStreamResponse:', error);
        throw error;
      }
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[NATIVE_TOOL_STREAM_ERROR_CALLBACK] onError in createToolCallingStreamResponse:', errorMessage);
      return errorMessage;
    }
  });
}