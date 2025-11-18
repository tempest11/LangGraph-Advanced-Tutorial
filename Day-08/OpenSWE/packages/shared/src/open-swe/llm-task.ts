/**
 * @file llm-task.ts
 * @description 이 파일은 에이전트 내에서 LLM이 수행할 수 있는 다양한 작업 유형을 열거형(enum)으로 정의합니다.
 * 각 작업 유형에 대한 기본 모델 및 설정을 매핑하여 일관된 모델 사용을 보장합니다.
 */

export enum LLMTask {
  /**
   * 계획 수립(planner) 작업을 위해 사용됩니다. 코드 작성, 계획 생성, 컨텍스트 수집 활동 등을 포함합니다.
   */
  PLANNER = "planner",
  /**
   * 프로그래머(programmer) 작업을 위해 사용됩니다. 코드 작성, 계획 생성, 컨텍스트 수집 활동 등을 포함합니다.
   */
  PROGRAMMER = "programmer",
  /**
   * 라우팅(routing) 작업을 위해 사용됩니다. 초기 요청을 다른 에이전트로 분기하는 작업을 포함합니다.
   */
  ROUTER = "router",
  /**
   * 검토(reviewer) 작업을 위해 사용됩니다. 코드 검토, 계획 생성, 컨텍스트 수집 활동 등을 포함합니다.
   */
  REVIEWER = "reviewer",
  /**
   * 요약(summarizer) 작업을 위해 사용됩니다. 대화 기록 요약, 작업 실행 중 취한 조치 요약 등을 포함합니다.
   * 약간 더 발전된 모델을 사용해야 합니다.
   */
  SUMMARIZER = "summarizer",
}

// 각 LLM 작업 유형에 대한 기본 모델 및 설정을 매핑합니다.
export const TASK_TO_CONFIG_DEFAULTS_MAP = {
  [LLMTask.PLANNER]: {
    modelName: "anthropic:claude-sonnet-4-0",
    temperature: 0,
  },
  [LLMTask.PROGRAMMER]: {
    modelName: "anthropic:claude-sonnet-4-0",
    temperature: 0,
  },
  [LLMTask.REVIEWER]: {
    modelName: "anthropic:claude-sonnet-4-0",
    temperature: 0,
  },
  [LLMTask.ROUTER]: {
    modelName: "anthropic:claude-3-5-haiku-latest",
    temperature: 0,
  },
  [LLMTask.SUMMARIZER]: {
    modelName: "anthropic:claude-3-5-haiku-latest",
    temperature: 0,
  },
};