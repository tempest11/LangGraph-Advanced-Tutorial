/**
 * @file caching.ts
 * @description
 * LLM 응답 캐싱 성능을 추적하고 콘텍스트 캐싱을 설정하는 유틸리티 함수들을 제공합니다.
 * Anthropic Claude의 Prompt Caching 기능을 활용하여 비용을 절감합니다.
 */

import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  isAIMessage,
  isHumanMessage,
  isToolMessage,
  MessageContent,
  ToolMessage,
} from "@langchain/core/messages";
import { CacheMetrics, ModelTokenData } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "./logger.js";
import { calculateCostSavings } from "@openswe/shared/caching";

const logger = createLogger(LogLevel.INFO, "Caching");

/**
 * 캐시 가능한 프롬프트 세그먼트 인터페이스입니다.
 */
export interface CacheablePromptSegment {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * LLM 응답의 캐시 성능을 추적하고 비용 절감을 기록합니다.
 *
 * @description
 * AIMessage에서 캐시 메트릭스를 추출하고 비용 절감을 계산하여 로깅합니다.
 *
 * @param response - LLM의 AIMessageChunk 응답
 * @param model - 사용된 모델 이름
 * @returns 모델 토큰 데이터 배열
 */
export function trackCachePerformance(
  response: AIMessageChunk,
  model: string,
): ModelTokenData[] {
  const metrics: CacheMetrics = {
    cacheCreationInputTokens:
      response.usage_metadata?.input_token_details?.cache_creation || 0,
    cacheReadInputTokens:
      response.usage_metadata?.input_token_details?.cache_read || 0,
    inputTokens: response.usage_metadata?.input_tokens || 0,
    outputTokens: response.usage_metadata?.output_tokens || 0,
  };

  const totalInputTokens =
    metrics.cacheCreationInputTokens +
    metrics.cacheReadInputTokens +
    metrics.inputTokens;

  const cacheHitRate =
    totalInputTokens > 0 ? metrics.cacheReadInputTokens / totalInputTokens : 0;
  const costSavings = calculateCostSavings(metrics).totalSavings;

  logger.info("캐시 성능", {
    model,
    cacheHitRate: `${(cacheHitRate * 100).toFixed(2)}%`,
    costSavings: `$${costSavings.toFixed(4)}`,
    ...metrics,
  });

  return [
    {
      ...metrics,
      model,
    },
  ];
}

/**
 * 메시지 내용에 캐시 제어 속성을 추가합니다.
 * @param messageContent - 수정할 메시지 내용.
 * @returns 캐시 제어 속성이 추가된 메시지 내용.
 */
function addCacheControlToMessageContent(
  messageContent: MessageContent,
): MessageContent {
  if (typeof messageContent === "string") {
    return [
      {
        type: "text",
        text: messageContent,
        cache_control: { type: "ephemeral" },
      },
    ];
  } else if (Array.isArray(messageContent)) {
    if ("cache_control" in messageContent[messageContent.length - 1]) {
      // 이미 설정됨, 아무 작업도 하지 않음
      return messageContent;
    }

    const newMessageContent = [...messageContent];
    newMessageContent[newMessageContent.length - 1] = {
      ...newMessageContent[newMessageContent.length - 1],
      cache_control: { type: "ephemeral" },
    };
    return newMessageContent;
  } else {
    logger.warn("알 수 없는 메시지 내용 유형", { messageContent });
    return messageContent;
  }
}

/**
 * 메시지를 캐시 제어 메시지로 변환합니다.
 * @param message - 변환할 BaseMessage.
 * @returns 캐시 제어 속성이 추가된 BaseMessage.
 */
function convertToCacheControlMessage(message: BaseMessage): BaseMessage {
  if (isAIMessage(message)) {
    return new AIMessage({
      ...message,
      content: addCacheControlToMessageContent(message.content),
    });
  } else if (isHumanMessage(message)) {
    return new HumanMessage({
      ...message,
      content: addCacheControlToMessageContent(message.content),
    });
  } else if (isToolMessage(message)) {
    return new ToolMessage({
      ...(message as ToolMessage),
      content: addCacheControlToMessageContent(
        (message as ToolMessage).content,
      ),
    });
  } else {
    return message;
  }
}

/**
 * 메시지 배열을 캐시 제어 메시지 배열로 변환합니다.
 * 마지막 메시지에만 캐시 제어 속성을 추가합니다.
 * @param messages - 변환할 BaseMessage 배열.
 * @returns 캐시 제어 속성이 추가된 메시지 배열.
 */
export function convertMessagesToCacheControlledMessages(
  messages: BaseMessage[],
) {
  if (messages.length === 0) {
    return messages;
  }

  const newMessages = [...messages];
  const lastIndex = newMessages.length - 1;
  newMessages[lastIndex] = convertToCacheControlMessage(newMessages[lastIndex]);
  return newMessages;
}
