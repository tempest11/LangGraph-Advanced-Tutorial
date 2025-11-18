/**
 * @file runtime-fallback.ts
 * @description
 * LLM 호출의 런타임 폴백과 서킷 브레이커 로직을 처리하는 Runnable 클래스를 제공합니다.
 * 기본 모델 실패 시 대체 모델로 자동 전환합니다.
 */

import { GraphConfig } from "@openswe/shared/open-swe/types";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { ModelManager, Provider } from "./llms/model-manager.js";
import { createLogger, LogLevel } from "./logger.js";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { StructuredToolInterface } from "@langchain/core/tools";
import {
  ConfigurableChatModelCallOptions,
  ConfigurableModel,
} from "langchain/chat_models/universal";
import {
  AIMessageChunk,
  BaseMessage,
  BaseMessageLike,
} from "@langchain/core/messages";
import { ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { BindToolsInput } from "@langchain/core/language_models/chat_models";
import { getMessageContentString } from "@openswe/shared/messages";
import { getConfig } from "@langchain/langgraph";
import { MODELS_NO_PARALLEL_TOOL_CALLING } from "./llms/load-model.js";

const logger = createLogger(LogLevel.DEBUG, "FallbackRunnable");

/**
 * 추출된 도구 인터페이스입니다.
 */
interface ExtractedTools {
  tools: BindToolsInput[];
  kwargs: Record<string, any>;
}

/**
 * 제공자별 메시지를 사용합니다.
 * @param initialInput - 초기 입력.
 * @param providerMessages - 제공자별 메시지.
 * @param provider - 제공자.
 * @returns 제공자별 메시지 또는 초기 입력.
 */
function useProviderMessages(
  initialInput: BaseLanguageModelInput,
  providerMessages?: Record<Provider, BaseMessageLike[]>,
  provider?: Provider,
): BaseLanguageModelInput {
  if (!provider || !providerMessages?.[provider]) {
    return initialInput;
  }
  return providerMessages[provider];
}

/**
 * LLM 호출의 런타임 폴백과 서킷 브레이커를 처리하는 Runnable 클래스
 *
 * @description
 * 기본 모델 호출 실패 시 대체 모델 목록을 순차적으로 시도합니다.
 * 서킷 브레이커가 OPEN 상태인 모델은 생략합니다.
 *
 * @template RunInput - 입력 타입
 * @template CallOptions - 호출 옵션 타입
 */
export class FallbackRunnable<
  RunInput extends BaseLanguageModelInput = BaseLanguageModelInput,
  CallOptions extends
    ConfigurableChatModelCallOptions = ConfigurableChatModelCallOptions,
> extends ConfigurableModel<RunInput, CallOptions> {
  private primaryRunnable: any;
  private config: GraphConfig;
  private task: LLMTask;
  private modelManager: ModelManager;
  private providerTools?: Record<Provider, BindToolsInput[]>;
  private providerMessages?: Record<Provider, BaseMessageLike[]>;

  constructor(
    primaryRunnable: any,
    config: GraphConfig,
    task: LLMTask,
    modelManager: ModelManager,
    options?: {
      providerTools?: Record<Provider, BindToolsInput[]>;
      providerMessages?: Record<Provider, BaseMessageLike[]>;
    },
  ) {
    super({
      configurableFields: "any",
      configPrefix: "fallback",
      queuedMethodOperations: {},
      disableStreaming: false,
    });
    this.primaryRunnable = primaryRunnable;
    this.config = config;
    this.task = task;
    this.modelManager = modelManager;
    this.providerTools = options?.providerTools;
    this.providerMessages = options?.providerMessages;
  }

  async _generate(
    messages: BaseMessage[],
    options?: Record<string, any>,
  ): Promise<ChatResult> {
    const result = await this.invoke(messages, options);
    const generation: ChatGeneration = {
      message: result,
      text: result?.content ? getMessageContentString(result.content) : "",
    };
    return {
      generations: [generation],
      llmOutput: {},
    };
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: Record<string, any>,
  ): Promise<AIMessageChunk> {
    const modelConfigs = this.modelManager.getModelConfigs(
      this.config,
      this.task,
      this.getPrimaryModel(),
    );

    let lastError: Error | undefined;

    for (let i = 0; i < modelConfigs.length; i++) {
      const modelConfig = modelConfigs[i];
      const modelKey = `${modelConfig.provider}:${modelConfig.modelName}`;

      if (!this.modelManager.isCircuitClosed(modelKey)) {
        logger.warn(`서킷 브레이커가 ${modelKey}에 대해 열려 있어 건너뜁니다.`);
        continue;
      }

      const graphConfig = getConfig() as GraphConfig;

      try {
        const model = await this.modelManager.initializeModel(
          modelConfig,
          graphConfig,
        );
        let runnableToUse: Runnable<BaseLanguageModelInput, AIMessageChunk> =
          model;

        // 이 제공자에 대한 제공자별 도구가 있는지 확인합니다.
        const providerSpecificTools =
          this.providerTools?.[modelConfig.provider];
        let toolsToUse: ExtractedTools | null = null;

        if (providerSpecificTools) {
          // 사용 가능한 경우 제공자별 도구 사용
          const extractedTools = this.extractBoundTools();
          toolsToUse = {
            tools: providerSpecificTools,
            kwargs: extractedTools?.kwargs || {},
          };
        } else {
          // 기본 모델에서 추출된 바인딩된 도구로 대체
          toolsToUse = this.extractBoundTools();
        }

        if (
          toolsToUse &&
          "bindTools" in runnableToUse &&
          runnableToUse.bindTools
        ) {
          const supportsParallelToolCall =
            !MODELS_NO_PARALLEL_TOOL_CALLING.some(
              (modelName) => modelKey === modelName,
            );

          const kwargs = { ...toolsToUse.kwargs };
          if (!supportsParallelToolCall && "parallel_tool_calls" in kwargs) {
            delete kwargs.parallel_tool_calls;
          }

          runnableToUse = (runnableToUse as ConfigurableModel).bindTools(
            toolsToUse.tools,
            kwargs,
          );
        }

        const config = this.extractConfig();
        if (config) {
          runnableToUse = runnableToUse.withConfig(config);
        }

        const result = await runnableToUse.invoke(
          useProviderMessages(
            input,
            this.providerMessages,
            modelConfig.provider,
          ),
          options,
        );
        this.modelManager.recordSuccess(modelKey);
        return result;
      } catch (error) {
        logger.warn(
          `${modelKey} 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
        lastError = error instanceof Error ? error : new Error(String(error));
        this.modelManager.recordFailure(modelKey);
      }
    }

    throw new Error(
      `${this.task} 작업에 대한 모든 대체 모델이 소진되었습니다. 마지막 오류: ${lastError?.message}`,
    );
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Record<string, any>,
  ): ConfigurableModel<RunInput, CallOptions> {
    const boundPrimary =
      this.primaryRunnable.bindTools?.(tools, kwargs) ?? this.primaryRunnable;
    return new FallbackRunnable(
      boundPrimary,
      this.config,
      this.task,
      this.modelManager,
      {
        providerTools: this.providerTools,
        providerMessages: this.providerMessages,
      },
    ) as unknown as ConfigurableModel<RunInput, CallOptions>;
  }

  // @ts-expect-error - 타입이 어렵습니다 :/
  withConfig(
    config?: RunnableConfig,
  ): ConfigurableModel<RunInput, CallOptions> {
    const configuredPrimary =
      this.primaryRunnable.withConfig?.(config) ?? this.primaryRunnable;
    return new FallbackRunnable(
      configuredPrimary,
      this.config,
      this.task,
      this.modelManager,
      {
        providerTools: this.providerTools,
        providerMessages: this.providerMessages,
      },
    ) as unknown as ConfigurableModel<RunInput, CallOptions>;
  }

  private getPrimaryModel(): ConfigurableModel {
    let current = this.primaryRunnable;

    // 실제 모델에 도달하기 위해 모든 LangChain 바인딩을 해제합니다.
    while (current?.bound) {
      current = current.bound;
    }

    // 래핑되지 않은 객체는 _llmType을 가진 채팅 모델이어야 합니다.
    if (current && typeof current._llmType !== "undefined") {
      return current;
    }

    throw new Error(
      "runnable에서 기본 모델을 추출할 수 없습니다 - _llmType을 찾을 수 없습니다.",
    );
  }

  private extractBoundTools(): ExtractedTools | null {
    let current: any = this.primaryRunnable;

    while (current) {
      if (current._queuedMethodOperations?.bindTools) {
        const bindToolsOp = current._queuedMethodOperations.bindTools;

        if (Array.isArray(bindToolsOp) && bindToolsOp.length > 0) {
          const tools = bindToolsOp[0] as StructuredToolInterface[];
          const toolOptions = bindToolsOp[1] || {};

          return {
            tools: tools,
            kwargs: {
              tool_choice: (toolOptions as Record<string, any>).tool_choice,
              parallel_tool_calls: (toolOptions as Record<string, any>)
                .parallel_tool_calls,
            },
          };
        }
      }
      current = current.bound;
    }

    return null;
  }

  private extractConfig(): Partial<RunnableConfig> | null {
    let current: any = this.primaryRunnable;

    while (current) {
      if (current.config) {
        return current.config;
      }
      current = current.bound;
    }

    return null;
  }
}
