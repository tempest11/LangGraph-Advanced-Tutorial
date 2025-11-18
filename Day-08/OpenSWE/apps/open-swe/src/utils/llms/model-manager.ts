/**
 * @file LLM 모델 관리자 (서킷 브레이커 + Fallback)
 * @description
 * LLM 모델의 생명주기, fallback 전환, 서킷 브레이커 패턴을 구현하는 핵심 유틸리티입니다.
 * 모델 실패 시 자동으로 대체 제공자(OpenAI → Anthropic → Google)로 전환하여 고가용성을 보장합니다.
 *
 * 주요 기능:
 * 1. 모델 로딩 및 초기화 (작업별 설정)
 * 2. 서킷 브레이커 패턴 (연속 실패 감지 및 자동 복구)
 * 3. Provider Fallback (openai → anthropic → google-genai)
 * 4. API 키 관리 (사용자별 암호화 키 처리)
 * 5. Thinking 모델 지원 (o3, extended-thinking)
 * 6. 모델 설정 캐싱
 *
 * 서킷 브레이커 동작:
 * - CLOSED: 정상 작동 (요청 허용)
 * - OPEN: 실패 상태 (대체 모델로 전환)
 * - 자동 복구: 3분 후 CLOSED로 재시도
 *
 * Fallback 순서:
 * 1. OpenAI (gpt-5, o3 시리즈)
 * 2. Anthropic (claude-sonnet-4-0)
 * 3. Google GenAI (gemini-2.5-pro/flash)
 *
 * @example
 * const manager = getModelManager();
 * const model = await manager.loadModel(config, LLMTask.PROGRAMMER);
 */

// === LangChain 유니버설 모델 ===
import {
  ConfigurableModel,
  initChatModel,
} from "langchain/chat_models/universal";

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types";

// === 로깅 ===
import { createLogger, LogLevel } from "../logger.js";

// === LLM 작업 ===
import {
  LLMTask,
  TASK_TO_CONFIG_DEFAULTS_MAP,
} from "@openswe/shared/open-swe/llm-task";

// === 사용자 검증 ===
import { isAllowedUser } from "@openswe/shared/github/allowed-users";

// === 암호화 ===
import { decryptSecret } from "@openswe/shared/crypto";

// === 상수 ===
import { API_KEY_REQUIRED_MESSAGE } from "@openswe/shared/constants";

const logger = createLogger(LogLevel.INFO, "ModelManager");

type InitChatModelArgs = Parameters<typeof initChatModel>[1];

/**
 * 서킷 브레이커 상태 인터페이스
 *
 * @description
 * 각 모델/제공자별 서킷 브레이커 상태를 추적하는 인터페이스입니다.
 * 연속 실패 횟수, 마지막 실패 시간, 서킷 오픈 시간을 기록합니다.
 *
 * @interface
 * @property {CircuitState} state - 서킷 상태 (CLOSED 또는 OPEN)
 * @property {number} failureCount - 연속 실패 횟수
 * @property {number} lastFailureTime - 마지막 실패 타임스탬프 (ms)
 * @property {number} [openedAt] - 서킷이 OPEN된 시간 (ms, 선택사항)
 */
export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  openedAt?: number;
}

/**
 * 모델 로드 설정 인터페이스입니다.
 */
interface ModelLoadConfig {
  provider: Provider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  thinkingModel?: boolean;
  thinkingBudgetTokens?: number;
}

/**
 * 서킷 브레이커 상태 Enum
 *
 * @description
 * 서킷 브레이커의 현재 상태를 나타내는 열거형입니다.
 *
 * @enum {string}
 */
export enum CircuitState {
  /**
   * CLOSED: 정상 작동
   */
  CLOSED = "CLOSED",
  /**
   * OPEN: 실패, 대체 모델 사용
   */
  OPEN = "OPEN",
}

/**
 * Provider Fallback 우선순위 순서
 *
 * @description
 * 모델 실패 시 시도할 제공자들의 순서를 정의합니다.
 * 첫 번째 제공자부터 순서대로 시도하며, 모두 실패하면 최종 에러가 발생합니다.
 *
 * Fallback 순서:
 * 1. openai - OpenAI (gpt-5, o3 시리즈)
 * 2. anthropic - Anthropic (claude-sonnet-4-0)
 * 3. google-genai - Google GenAI (gemini-2.5-pro/flash)
 *
 * @constant {readonly string[]}
 */
export const PROVIDER_FALLBACK_ORDER = [
  "openai",
  "anthropic",
  "google-genai",
] as const;
export type Provider = (typeof PROVIDER_FALLBACK_ORDER)[number];

/**
 * 모델 관리자 설정 인터페이스입니다.
 */
export interface ModelManagerConfig {
  /**
   * 서킷을 열기 전 실패 횟수
   */
  circuitBreakerFailureThreshold: number;
  /**
   * 다시 시도하기 전 대기 시간 (ms)
   */
  circuitBreakerTimeoutMs: number;
  fallbackOrder: Provider[];
}

/**
 * 기본 ModelManager 설정
 *
 * @description
 * ModelManager의 기본 설정값을 정의합니다.
 * 서킷 브레이커 임계값, 타임아웃, fallback 순서가 포함됩니다.
 *
 * 설정값:
 * - circuitBreakerFailureThreshold: 2회 (2회 연속 실패 시 서킷 OPEN)
 * - circuitBreakerTimeoutMs: 180000ms (3분 후 자동 복구)
 * - fallbackOrder: PROVIDER_FALLBACK_ORDER 사용
 *
 * @constant {ModelManagerConfig}
 */
export const DEFAULT_MODEL_MANAGER_CONFIG: ModelManagerConfig = {
  circuitBreakerFailureThreshold: 2, // 미정, 테스트 필요
  circuitBreakerTimeoutMs: 180000, // 3분 시간 초과
  fallbackOrder: [...PROVIDER_FALLBACK_ORDER],
};

const MAX_RETRIES = 3;
const THINKING_BUDGET_TOKENS = 5000;

/**
 * 제공자 이름에 해당하는 API 키를 반환합니다.
 * @param providerName - 제공자 이름.
 * @param apiKeys - API 키 맵.
 * @returns API 키 문자열.
 */
const providerToApiKey = (
  providerName: string,
  apiKeys: Record<string, string>,
): string => {
  switch (providerName) {
    case "openai":
      return apiKeys.openaiApiKey;
    case "anthropic":
      return apiKeys.anthropicApiKey;
    case "google-genai":
      return apiKeys.googleApiKey;
    default:
      throw new Error(`알 수 없는 제공자: ${providerName}`);
  }
};

/**
 * LLM 모델 관리자 클래스 (서킷 브레이커 + Fallback)
 *
 * @description
 * LLM 모델의 전체 생명주기를 관리하는 중앙 관리자입니다.
 * 모델 로딩, API 키 관리, 서킷 브레이커 패턴, provider fallback을 통합 제공합니다.
 *
 * 핵심 기능:
 * 1. **모델 로딩**: 작업별 모델 초기화 (Planner, Programmer, Reviewer 등)
 * 2. **서킷 브레이커**: 연속 실패 감지 및 자동 복구 (2회 실패 → 3분 대기)
 * 3. **Provider Fallback**: 자동 제공자 전환 (OpenAI → Anthropic → Google)
 * 4. **API 키 관리**: 사용자별 암호화된 API 키 처리
 * 5. **Thinking 모델**: o3, extended-thinking 모델 특별 처리
 *
 * 서킷 브레이커 워크플로우:
 * 1. CLOSED (정상) → 요청 허용
 * 2. 2회 연속 실패 → OPEN (차단)
 * 3. OPEN 상태에서 대체 모델로 전환
 * 4. 3분 후 자동으로 CLOSED로 복구 시도
 *
 * @class
 */
export class ModelManager {
  private config: ModelManagerConfig;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_MANAGER_CONFIG, ...config };

    logger.info("초기화됨", {
      config: this.config,
      fallbackOrder: this.config.fallbackOrder,
    });
  }

  /**
   * 단일 모델을 로드합니다 (로딩 중 대체 없음).
   * @param graphConfig - 그래프 설정.
   * @param task - LLM 작업 유형.
   * @returns 로드된 모델.
   */
  async loadModel(graphConfig: GraphConfig, task: LLMTask) {
    const baseConfig = this.getBaseConfigForTask(graphConfig, task);
    const model = await this.initializeModel(baseConfig, graphConfig);
    return model;
  }

  /**
   * 사용자의 API 키를 가져옵니다.
   * @param graphConfig - 그래프 설정.
   * @param provider - 제공자.
   * @returns API 키 또는 null.
   */
  private getUserApiKey(
    graphConfig: GraphConfig,
    provider: Provider,
  ): string | null {
    const userLogin = (graphConfig.configurable as any)?.langgraph_auth_user
      ?.display_name;
    const secretsEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;

    if (!secretsEncryptionKey) {
      throw new Error(
        "SECRETS_ENCRYPTION_KEY 환경 변수가 필요합니다.",
      );
    }
    if (!userLogin) {
      throw new Error("설정에서 사용자 로그인을 찾을 수 없습니다.");
    }

    // 사용자가 허용된 경우 조기 반환 가능
    if (isAllowedUser(userLogin)) {
      return null;
    }

    const apiKeys = graphConfig.configurable?.apiKeys;
    if (!apiKeys) {
      throw new Error(API_KEY_REQUIRED_MESSAGE);
    }

    const missingProviderKeyMessage = `${provider} 제공자에 대한 API 키를 찾을 수 없습니다. 설정 페이지에서 추가하십시오.`;

    const providerApiKey = providerToApiKey(provider, apiKeys);
    if (!providerApiKey) {
      throw new Error(missingProviderKeyMessage);
    }

    const apiKey = decryptSecret(providerApiKey, secretsEncryptionKey);
    if (!apiKey) {
      throw new Error(missingProviderKeyMessage);
    }

    return apiKey;
  }

  /**
   * 모델 인스턴스를 초기화합니다.
   * @param config - 모델 로드 설정.
   * @param graphConfig - 그래프 설정.
   * @returns 초기화된 모델.
   */
  public async initializeModel(
    config: ModelLoadConfig,
    graphConfig: GraphConfig,
  ) {
    const {
      provider,
      modelName,
      temperature,
      maxTokens,
      thinkingModel,
      thinkingBudgetTokens,
    } = config;

    const thinkingMaxTokens = thinkingBudgetTokens
      ? thinkingBudgetTokens * 4
      : undefined;

    let finalMaxTokens = maxTokens ?? 10_000;
    if (modelName.includes("claude-3-5-haiku")) {
      finalMaxTokens = finalMaxTokens > 8_192 ? 8_192 : finalMaxTokens;
    }

    const apiKey = this.getUserApiKey(graphConfig, provider);

    const modelOptions: InitChatModelArgs = {
      modelProvider: provider,
      max_retries: MAX_RETRIES,
      ...(apiKey ? { apiKey } : {}),
      ...(thinkingModel && provider === "anthropic"
        ? {
            thinking: { budget_tokens: thinkingBudgetTokens, type: "enabled" },
            maxTokens: thinkingMaxTokens,
          }
        : modelName.includes("gpt-5")
          ? {
              max_completion_tokens: finalMaxTokens,
              temperature: 1,
            }
          : {
              maxTokens: finalMaxTokens,
              temperature: thinkingModel ? undefined : temperature,
            }),
    };

    logger.debug("모델 초기화 중", {
      provider,
      modelName,
    });

    return await initChatModel(modelName, modelOptions);
  }

  /**
   * 선택된 모델에 대한 모델 설정을 가져옵니다.
   * @param config - 그래프 설정.
   * @param task - LLM 작업 유형.
   * @param selectedModel - 선택된 모델.
   * @returns 모델 로드 설정 배열.
   */
  public getModelConfigs(
    config: GraphConfig,
    task: LLMTask,
    selectedModel: ConfigurableModel,
  ) {
    const configs: ModelLoadConfig[] = [];
    const baseConfig = this.getBaseConfigForTask(config, task);

    const defaultConfig = selectedModel._defaultConfig;
    let selectedModelConfig: ModelLoadConfig | null = null;

    if (defaultConfig) {
      const provider = defaultConfig.modelProvider as Provider;
      const modelName = defaultConfig.model;

      if (provider && modelName) {
        const isThinkingModel = baseConfig.thinkingModel;
        selectedModelConfig = {
          provider,
          modelName,
          ...(modelName.includes("gpt-5")
            ? {
                max_completion_tokens:
                  defaultConfig.maxTokens ?? baseConfig.maxTokens,
                temperature: 1,
              }
            : {
                maxTokens: defaultConfig.maxTokens ?? baseConfig.maxTokens,
                temperature:
                  defaultConfig.temperature ?? baseConfig.temperature,
              }),
          ...(isThinkingModel
            ? {
                thinkingModel: true,
                thinkingBudgetTokens: THINKING_BUDGET_TOKENS,
              }
            : {}),
        };
        configs.push(selectedModelConfig);
      }
    }

    // 대체 모델 추가
    for (const provider of this.config.fallbackOrder) {
      const fallbackModel = this.getDefaultModelForProvider(provider, task);
      if (
        fallbackModel &&
        (!selectedModelConfig ||
          fallbackModel.modelName !== selectedModelConfig.modelName)
      ) {
        // 대체 모델이 생각하는 모델인지 확인
        const isThinkingModel =
          (provider === "openai" && fallbackModel.modelName.startsWith("o")) ||
          fallbackModel.modelName.includes("extended-thinking");

        const fallbackConfig = {
          ...fallbackModel,
          ...(fallbackModel.modelName.includes("gpt-5")
            ? {
                max_completion_tokens: baseConfig.maxTokens,
                temperature: 1,
              }
            : {
                maxTokens: baseConfig.maxTokens,
                temperature: isThinkingModel
                  ? undefined
                  : baseConfig.temperature,
              }),
          ...(isThinkingModel
            ? {
                thinkingModel: true,
                thinkingBudgetTokens: THINKING_BUDGET_TOKENS,
              }
            : {}),
        };
        configs.push(fallbackConfig);
      }
    }

    return configs;
  }

  /**
   * GraphConfig에서 작업에 대한 모델 이름을 가져옵니다.
   * @param config - 그래프 설정.
   * @param task - LLM 작업 유형.
   * @returns 모델 이름.
   */
  public getModelNameForTask(config: GraphConfig, task: LLMTask): string {
    const baseConfig = this.getBaseConfigForTask(config, task);
    return baseConfig.modelName;
  }

  /**
   * GraphConfig에서 작업에 대한 기본 설정을 가져옵니다.
   * @param config - 그래프 설정.
   * @param task - LLM 작업 유형.
   * @returns 모델 로드 설정.
   */
  private getBaseConfigForTask(
    config: GraphConfig,
    task: LLMTask,
  ): ModelLoadConfig {
    const taskMap = {
      [LLMTask.PLANNER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ??
          TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.PROGRAMMER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ??
          TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.REVIEWER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ??
          TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.ROUTER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ??
          TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.SUMMARIZER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ??
          TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
    };

    const taskConfig = taskMap[task];
    const modelStr = taskConfig.modelName;
    const [modelProvider, ...modelNameParts] = modelStr.split(":");

    let thinkingModel = false;
    if (modelNameParts[0] === "extended-thinking") {
      thinkingModel = true;
      modelNameParts.shift();
    }

    const modelName = modelNameParts.join(":");
    if (modelProvider === "openai" && modelName.startsWith("o")) {
      thinkingModel = true;
    }

    const thinkingBudgetTokens = THINKING_BUDGET_TOKENS;

    return {
      modelName,
      provider: modelProvider as Provider,
      ...(modelName.includes("gpt-5")
        ? {
            max_completion_tokens: config.configurable?.maxTokens ?? 10_000,
            temperature: 1,
          }
        : {
            maxTokens: config.configurable?.maxTokens ?? 10_000,
            temperature: taskConfig.temperature,
          }),
      thinkingModel,
      thinkingBudgetTokens,
    };
  }

  /**
   * 제공자 및 작업에 대한 기본 모델을 가져옵니다.
   * @param provider - 제공자.
   * @param task - LLM 작업 유형.
   * @returns 모델 로드 설정 또는 null.
   */
  private getDefaultModelForProvider(
    provider: Provider,
    task: LLMTask,
  ): ModelLoadConfig | null {
    const defaultModels: Record<Provider, Record<LLMTask, string>> = {
      anthropic: {
        [LLMTask.PLANNER]: "claude-sonnet-4-0",
        [LLMTask.PROGRAMMER]: "claude-sonnet-4-0",
        [LLMTask.REVIEWER]: "claude-sonnet-4-0",
        [LLMTask.ROUTER]: "claude-3-5-haiku-latest",
        [LLMTask.SUMMARIZER]: "claude-sonnet-4-0",
      },
      "google-genai": {
        [LLMTask.PLANNER]: "gemini-2.5-flash",
        [LLMTask.PROGRAMMER]: "gemini-2.5-pro",
        [LLMTask.REVIEWER]: "gemini-2.5-flash",
        [LLMTask.ROUTER]: "gemini-2.5-flash",
        [LLMTask.SUMMARIZER]: "gemini-2.5-pro",
      },
      openai: {
        [LLMTask.PLANNER]: "gpt-5",
        [LLMTask.PROGRAMMER]: "gpt-5",
        [LLMTask.REVIEWER]: "gpt-5",
        [LLMTask.ROUTER]: "gpt-5-nano",
        [LLMTask.SUMMARIZER]: "gpt-5-mini",
      },
    };

    const modelName = defaultModels[provider][task];
    if (!modelName) {
      return null;
    }
    return { provider, modelName };
  }

  /**
   * 서킷 브레이커 메서드
   */
  public isCircuitClosed(modelKey: string): boolean {
    const state = this.getCircuitState(modelKey);

    if (state.state === CircuitState.CLOSED) {
      return true;
    }

    if (state.state === CircuitState.OPEN && state.openedAt) {
      const timeElapsed = Date.now() - state.openedAt;
      if (timeElapsed >= this.config.circuitBreakerTimeoutMs) {
        state.state = CircuitState.CLOSED;
        state.failureCount = 0;
        delete state.openedAt;

        logger.info(
          `${modelKey}: 서킷 브레이커가 자동으로 복구되었습니다: OPEN → CLOSED`,
          {
            timeElapsed: (timeElapsed / 1000).toFixed(1) + "s",
          },
        );
        return true;
      }
    }

    return false;
  }

  private getCircuitState(modelKey: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(modelKey)) {
      this.circuitBreakers.set(modelKey, {
        state: CircuitState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
      });
    }
    return this.circuitBreakers.get(modelKey)!;
  }

  public recordSuccess(modelKey: string): void {
    const circuitState = this.getCircuitState(modelKey);

    circuitState.state = CircuitState.CLOSED;
    circuitState.failureCount = 0;
    delete circuitState.openedAt;

    logger.debug(`${modelKey}: 성공적인 요청 후 서킷 브레이커 재설정`);
  }

  public recordFailure(modelKey: string): void {
    const circuitState = this.getCircuitState(modelKey);
    const now = Date.now();

    circuitState.lastFailureTime = now;
    circuitState.failureCount++;

    if (
      circuitState.failureCount >= this.config.circuitBreakerFailureThreshold
    ) {
      circuitState.state = CircuitState.OPEN;
      circuitState.openedAt = now;

      logger.warn(
        `${modelKey}: ${circuitState.failureCount}번의 실패 후 서킷 브레이커가 열렸습니다.`,
        {
          timeoutMs: this.config.circuitBreakerTimeoutMs,
          willRetryAt: new Date(
            now + this.config.circuitBreakerTimeoutMs,
          ).toISOString(),
        },
      );
    }
  }

  /**
   * 모니터링 및 관찰 가능성 메서드
   */
  public getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }

  /**
   * 종료 시 정리
   */
  public shutdown(): void {
    this.circuitBreakers.clear();
    logger.info("종료 완료");
  }
}

/**
 * 전역 ModelManager 싱글톤 인스턴스
 * 애플리케이션 전체에서 하나의 ModelManager만 사용합니다.
 */
let globalModelManager: ModelManager | null = null;

/**
 * 전역 ModelManager 싱글톤 인스턴스를 반환합니다.
 *
 * @description
 * ModelManager를 싱글톤으로 관리하여 서킷 브레이커 상태를 애플리케이션 전체에서 공유합니다.
 * 첫 호출 시 인스턴스를 생성하고, 이후 호출에서는 동일한 인스턴스를 반환합니다.
 *
 * 싱글톤 패턴 이유:
 * - 서킷 브레이커 상태를 전역 공유 (모든 그래프에서 동일한 상태)
 * - 모델 설정 캐시 재사용
 * - 메모리 효율성
 *
 * @param {Partial<ModelManagerConfig>} [config] - ModelManager 설정 (선택사항)
 * @returns {ModelManager} ModelManager 싱글톤 인스턴스
 *
 * @example
 * const manager = getModelManager();
 * const model = await manager.loadModel(config, LLMTask.PROGRAMMER);
 */
export function getModelManager(
  config?: Partial<ModelManagerConfig>,
): ModelManager {
  if (!globalModelManager) {
    globalModelManager = new ModelManager(config);
  }
  return globalModelManager;
}

/**
 * 전역 ModelManager를 재설정합니다 (테스트용).
 *
 * @description
 * 현재 ModelManager 인스턴스를 종료하고 싱글톤을 초기화합니다.
 * 주로 테스트나 설정 변경 시 사용됩니다.
 *
 * 재설정 프로세스:
 * 1. 기존 인스턴스 shutdown() 호출 (서킷 브레이커 상태 정리)
 * 2. globalModelManager를 null로 초기화
 * 3. 다음 getModelManager() 호출 시 새 인스턴스 생성
 *
 * @example
 * resetModelManager();
 * const newManager = getModelManager({ circuitBreakerFailureThreshold: 3 });
 */
export function resetModelManager(): void {
  if (globalModelManager) {
    globalModelManager.shutdown();
    globalModelManager = null;
  }
}
