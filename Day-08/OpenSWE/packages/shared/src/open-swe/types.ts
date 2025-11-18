/**
 * @file types.ts
 * @description 이 파일은 Open SWE 에이전트의 여러 그래프(Manager, Planner, Programmer 등)에서
 * 공유되는 핵심 데이터 구조와 타입을 정의합니다. Task, Plan, Repository 정보 등
 * 에이전트의 상태와 설정을 구성하는 기본 요소들을 포함합니다.
 */

import "@langchain/langgraph/zod";
import { z } from "zod";
import {
  LangGraphRunnableConfig,
  Messages,
  messagesStateReducer,
  MessagesZodState,
} from "@langchain/langgraph/web";
import { MODEL_OPTIONS, MODEL_OPTIONS_NO_THINKING } from "./models.js";
import { ConfigurableFieldUIMetadata } from "../configurable-metadata.js";
import {
  GITHUB_INSTALLATION_NAME,
  GITHUB_INSTALLATION_TOKEN_COOKIE,
  GITHUB_TOKEN_COOKIE,
  GITHUB_USER_ID_HEADER,
  GITHUB_USER_LOGIN_HEADER,
  GITHUB_PAT,
  GITHUB_INSTALLATION_ID,
} from "../constants.js";
import { withLangGraph } from "@langchain/langgraph/zod";
import { BaseMessage } from "@langchain/core/messages";
import { tokenDataReducer } from "../caching.js";

// 캐시 사용량 메트릭
export interface CacheMetrics {
  cacheCreationInputTokens: number; // 캐시 생성에 사용된 입력 토큰
  cacheReadInputTokens: number; // 캐시 읽기에 사용된 입력 토큰
  inputTokens: number; // 일반 입력 토큰
  outputTokens: number; // 출력 토큰
}

// 모델별 토큰 데이터
export interface ModelTokenData extends CacheMetrics {
  /**
   * 이 토큰 사용량 데이터를 생성한 모델 이름
   * 예: "anthropic:claude-sonnet-4-0", "openai:gpt-4.1-mini"
   */
  model: string;
}

// 계획 항목 타입
export type PlanItem = {
  /**
   * 계획 항목의 인덱스. 실행 순서를 나타냅니다.
   */
  index: number;
  /**
   * 수행할 실제 작업 내용입니다.
   */
  plan: string;
  /**
   * 계획 항목의 완료 여부입니다.
   */
  completed: boolean;
  /**
   * 완료된 작업에 대한 요약입니다.
   */
  summary?: string;
};

// 계획 리비전(수정 이력) 타입
export type PlanRevision = {
  /**
   * 계획의 리비전 인덱스. 에이전트나 사용자에 의한 수정 이력을 추적합니다.
   */
  revisionIndex: number;
  /**
   * 해당 작업 및 리비전의 계획들입니다.
   */
  plans: PlanItem[];
  /**
   * 이 리비전이 생성된 타임스탬프입니다.
   */
  createdAt: number;
  /**
   * 이 리비전을 생성한 주체입니다 ('agent' 또는 'user').
   */
  createdBy: "agent" | "user";
};

// 작업(Task) 타입
export type Task = {
  /**
   * 작업의 고유 식별자입니다.
   */
  id: string;
  /**
   * 시간 순서에 따른 사용자의 작업 인덱스입니다.
   */
  taskIndex: number;
  /**
   * 이 작업을 생성한 원본 사용자 요청입니다.
   */
  request: string;
  /**
   * LLM이 생성한 작업의 제목입니다.
   */
  title: string;
  /**
   * 작업이 생성된 시간입니다.
   */
  createdAt: number;
  /**
   * 작업 완료 여부입니다.
   */
  completed: boolean;
  /**
   * 작업이 완료된 시간입니다 (해당하는 경우).
   */
  completedAt?: number;
  /**
   * 완료된 작업에 대한 전체 요약입니다.
   */
  summary?: string;
  /**
   * 이 작업을 위해 생성된 계획들입니다.
   * revisionIndex 순으로 정렬되며, 마지막 리비전이 활성 상태입니다.
   */
  planRevisions: PlanRevision[];
  /**
   * 현재 활성 상태인 계획 리비전의 인덱스입니다.
   */
  activeRevisionIndex: number;
  /**
   * 이 작업이 다른 작업에서 파생된 경우의 부모 작업 ID입니다.
   */
  parentTaskId?: string;
  /**
   * 이 작업과 관련된 풀 리퀘스트 번호입니다.
   */
  pullRequestNumber?: number;
};

// 작업 계획(TaskPlan) 타입
export type TaskPlan = {
  /**
   * 시스템의 모든 작업들입니다.
   */
  tasks: Task[];
  /**
   * 현재 활성 상태인 작업의 인덱스입니다.
   */
  activeTaskIndex: number;
};

// 대상 저장소 타입
export type TargetRepository = {
  owner: string;
  repo: string;
  branch?: string;
  baseCommit?: string;
};

// 사용자 정의 규칙 타입
export type CustomRules = {
  generalRules?: string;
  repositoryStructure?: string;
  dependenciesAndInstallation?: string;
  testingInstructions?: string;
  pullRequestFormatting?: string;
};

// 그래프 상태(State)의 Zod 스키마 정의
export const GraphAnnotation = MessagesZodState.extend({
  /**
   * 내부 메시지. LLM에 전달되고, 잘리거나 제거되는 등의 수정이 가해지는 메시지입니다.
   * 메인 `messages` 키는 클라이언트에 표시되는 내용을 유지하기 위해 수정되지 않습니다.
   */
  internalMessages: withLangGraph(z.custom<BaseMessage[]>(), {
    reducer: {
      schema: z.custom<Messages>(),
      fn: messagesStateReducer,
    },
    jsonSchemaExtra: {
      langgraph_type: "messages",
    },
    default: () => [],
  }),
  /**
   * 플래닝 에이전트가 생성한 작업 계획. 사용자나 에이전트의 수정을 포함합니다.
   */
  taskPlan: withLangGraph(z.custom<TaskPlan>(), {
    reducer: {
      schema: z.custom<TaskPlan>(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 플래닝 에이전트가 수행한 작업에 기반한 노트입니다.
   */
  contextGatheringNotes: withLangGraph(z.custom<string>(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
    default: () => "",
  }),
  /**
   * 사용할 샌드박스의 세션 ID입니다.
   */
  sandboxSessionId: withLangGraph(z.custom<string>(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
    default: () => "",
  }),
  /**
   * 이 스레드의 변경 사항이 푸시될 브랜치 이름입니다.
   */
  branchName: withLangGraph(z.custom<string>(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
    default: () => "",
  }),
  /**
   * 대상 저장소 정보입니다.
   */
  targetRepository: withLangGraph(z.custom<TargetRepository>(), {
    reducer: {
      schema: z.custom<TargetRepository>(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 에이전트가 작업 중인 코드베이스의 현재 트리 구조입니다.
   */
  codebaseTree: withLangGraph(z.custom<string>(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * URL을 키로 사용하는, 가져온 문서 콘텐츠의 캐시입니다.
   */
  documentCache: withLangGraph(z.custom<Record<string, string>>(), {
    reducer: {
      schema: z.custom<Record<string, string>>(),
      fn: (state, update) => ({ ...state, ...update }),
    },
    default: () => ({}),
  }),
  /**
   * 이 스레드와 연관된 GitHub 이슈의 ID입니다.
   */
  githubIssueId: withLangGraph(z.custom<number>(), {
    reducer: {
      schema: z.custom<number>(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 샌드박스에 의존성이 이미 설치되었는지 여부입니다.
   */
  dependenciesInstalled: withLangGraph(z.custom<boolean>(), {
    reducer: {
      schema: z.custom<boolean>(),
      fn: (_state, update) => update,
    },
    default: () => false,
  }),
  /**
   * 사용자 정의 규칙입니다.
   */
  customRules: withLangGraph(z.custom<CustomRules>().optional(), {
    reducer: {
      schema: z.custom<CustomRules>().optional(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 검토자 하위 그래프가 실행된 횟수입니다.
   */
  reviewsCount: withLangGraph(z.custom<number>(), {
    reducer: {
      schema: z.custom<number>(),
      fn: (_state, update) => update,
    },
    default: () => 0,
  }),

  tokenData: withLangGraph(z.custom<ModelTokenData[]>().optional(), {
    reducer: {
      schema: z.custom<ModelTokenData[]>().optional(),
      fn: tokenDataReducer,
    },
  }),
});

export type GraphState = z.infer<typeof GraphAnnotation>;
export type GraphUpdate = Partial<GraphState>;

// 그래프 설정 필드에 대한 UI 메타데이터
export const GraphConfigurationMetadata: {
  [key: string]: {
    x_open_swe_ui_config:
      | Omit<ConfigurableFieldUIMetadata, "label">
      | { type: "hidden" };
  };
} = {
  // ... (UI 설정 관련 메타데이터 정의) ...
};

// 그래프 설정을 위한 Zod 스키마
export const GraphConfiguration = z.object({
  // ... (각 설정 필드에 대한 Zod 정의) ...
});

export type GraphConfig = LangGraphRunnableConfig<
  z.infer<typeof GraphConfiguration> & {
    thread_id: string;
    assistant_id: string;
  }
>;

// 에이전트 세션 타입
export interface AgentSession {
  threadId: string;
  runId: string;
}