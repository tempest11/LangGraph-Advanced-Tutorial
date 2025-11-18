/**
 * @file LLM 모델 로딩 및 Fallback 래핑
 * @description
 * 작업별 LLM 모델을 로드하고 실패 시 자동 fallback을 지원하는 유틸리티입니다.
 * ModelManager와 FallbackRunnable을 통합하여 고가용성 모델 사용을 보장합니다.
 *
 * 주요 기능:
 * 1. 작업별 모델 로딩 (Planner, Programmer, Reviewer 등)
 * 2. FallbackRunnable로 래핑 (실패 시 대체 모델 사용)
 * 3. 병렬 도구 호출 지원 여부 확인
 * 4. 제공자별 도구/메시지 옵션 지원
 *
 * 사용 위치:
 * - graphs/planner/planner.ts: Planner LLM 로드
 * - graphs/programmer/programmer.ts: Programmer LLM 로드
 * - graphs/reviewer/reviewer.ts: Reviewer LLM 로드
 *
 * @example
 * const model = await loadModel(config, LLMTask.PROGRAMMER, {
 *   providerTools: {
 *     openai: [shellTool, textEditorTool],
 *     anthropic: [shellTool, textEditorTool]
 *   }
 * });
 */

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types";

// === 모델 관리 ===
import { getModelManager, Provider } from "./model-manager.js";

// === Fallback 런타임 ===
import { FallbackRunnable } from "../runtime-fallback.js";

// === LangChain 타입 ===
import { BindToolsInput } from "@langchain/core/language_models/chat_models";
import { BaseMessageLike } from "@langchain/core/messages";

// === LLM 작업 ===
/**
 * LLM 작업 타입
 */
import {
  LLMTask,
  TASK_TO_CONFIG_DEFAULTS_MAP,
} from "@openswe/shared/open-swe/llm-task";

/**
 * 특정 작업을 위한 LLM 모델을 로드하고 Fallback으로 래핑합니다.
 *
 * @description
 * ModelManager를 사용하여 작업별 모델을 로드하고,
 * 실패 시 자동으로 대체 모델로 전환하는 FallbackRunnable로 래핑합니다.
 *
 * 로딩 프로세스:
 * 1. ModelManager 싱글톤 획듍
 * 2. 작업별 모델 로드 (config에서 모델명 추출)
 * 3. 모델 유효성 검증 (undefined 방지)
 * 4. FallbackRunnable로 래핑 (서킷 브레이커 + fallback)
 * 5. 래핑된 모델 반환
 *
 * Fallback 동작:
 * - 주 모델 실패 시 FallbackRunnable이 대체 모델로 자동 전환
 * - 제공자 순서: ModelManager의 fallbackOrder 따름
 * - 서킷 브레이커 패턴 적용 (2회 실패 시 OPEN)
 *
 * @param {GraphConfig} config - 그래프 실행 설정 (모델명, 온도 등 포함)
 * @param {LLMTask} task - LLM 작업 유형 (Planner, Programmer, Reviewer 등)
 * @param {Object} [options] - 추가 옵션
 * @param {Record<Provider, BindToolsInput[]>} [options.providerTools] - 제공자별 도구 배열
 * @param {Record<Provider, BaseMessageLike[]>} [options.providerMessages] - 제공자별 메시지 배열
 * @returns {Promise<FallbackRunnable>} Fallback 기능이 포함된 모델 런타임
 *
 * @throws {Error} 모델 로딩이 undefined를 반환한 경우
 *
 * @example
 * // 기본 사용
 * const programmerModel = await loadModel(config, LLMTask.PROGRAMMER);
 *
 * @example
 * // 도구와 함께 사용
 * const model = await loadModel(config, LLMTask.PROGRAMMER, {
 *   providerTools: {
 *     openai: [shellTool, editTool],
 *     anthropic: [shellTool, editTool]
 *   }
 * });
 */
export async function loadModel(
  config: GraphConfig,
  task: LLMTask,
  options?: {
    providerTools?: Record<Provider, BindToolsInput[]>;
    providerMessages?: Record<Provider, BaseMessageLike[]>;
  },
) {
  const modelManager = getModelManager();

  const model = await modelManager.loadModel(config, task);
  if (!model) {
    throw new Error(`모델 로딩이 ${task} 작업에 대해 undefined를 반환했습니다.`);
  }
  const fallbackModel = new FallbackRunnable(
    model,
    config,
    task,
    modelManager,
    options,
  );
  return fallbackModel;
}

/**
 * 병렬 도구 호출을 지원하지 않는 모델 목록
 *
 * @description
 * 특정 모델들은 병렬 도구 호출 (parallel_tool_calls) 파라미터를 지원하지 않습니다.
 * 이 목록에 포함된 모델에는 parallel_tool_calls 파라미터를 전달하지 않습니다.
 *
 * 포함된 모델:
 * - openai:o3: OpenAI o3 모델 (사고 모델)
 * - openai:o3-mini: OpenAI o3-mini 모델 (경량 사고 모델)
 *
 * @constant {string[]}
 */
export const MODELS_NO_PARALLEL_TOOL_CALLING = ["openai:o3", "openai:o3-mini"];

/**
 * 특정 작업의 모델이 병렬 도구 호출 파라미터를 지원하는지 확인합니다.
 *
 * @description
 * 현재 설정된 모델이 parallel_tool_calls 파라미터를 지원하는지 검사합니다.
 * MODELS_NO_PARALLEL_TOOL_CALLING 목록을 기반으로 판단합니다.
 *
 * 판단 로직:
 * 1. config에서 작업별 모델명 추출
 * 2. 모델명이 없으면 기본값 사용 (TASK_TO_CONFIG_DEFAULTS_MAP)
 * 3. MODELS_NO_PARALLEL_TOOL_CALLING 목록에 포함 여부 확인
 * 4. 포함되지 않으면 true 반환 (지원함)
 *
 * 사용 시나리오:
 * - 도구 바인딩 시 parallel_tool_calls 파라미터 설정
 * - o3/o3-mini 모델은 병렬 호출 미지원
 *
 * @param {GraphConfig} config - 그래프 실행 설정
 * @param {LLMTask} task - LLM 작업 유형
 * @returns {boolean} 병렬 도구 호출 지원 여부
 *
 * @example
 * if (supportsParallelToolCallsParam(config, LLMTask.PROGRAMMER)) {
 *   // parallel_tool_calls: true 설정 가능
 * }
 */
export function supportsParallelToolCallsParam(
  config: GraphConfig,
  task: LLMTask,
): boolean {
  const modelStr =
    config.configurable?.[`${task}ModelName`] ??
    TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName;

  return !MODELS_NO_PARALLEL_TOOL_CALLING.some((model) => modelStr === model);
}
