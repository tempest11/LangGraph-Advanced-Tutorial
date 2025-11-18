/**
 * @file types.ts
 * @description 이 파일은 플래너(Planner) 그래프의 상태(State) 객체에 대한 타입을 정의합니다.
 * 플래너 그래프는 작업 계획을 생성하고 수정하는 역할을 하며, 이 상태 객체는
 * 계획 수립 과정에 필요한 모든 정보(예: 저장소 정보, 코드베이스 트리, 제안된 계획 등)를 관리합니다.
 */

import "@langchain/langgraph/zod";
import { z } from "zod";
import { MessagesZodState } from "@langchain/langgraph";
import {
  AgentSession,
  CustomRules,
  ModelTokenData,
  TargetRepository,
  TaskPlan,
} from "../types.js";
import { withLangGraph } from "@langchain/langgraph/zod";
import { tokenDataReducer } from "../../caching.js";

// 플래너 그래프의 상태를 정의하는 Zod 스키마 객체입니다.
export const PlannerGraphStateObj = MessagesZodState.extend({
  sandboxSessionId: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  targetRepository: withLangGraph(z.custom<TargetRepository>(), {
    reducer: {
      schema: z.custom<TargetRepository>(),
      fn: (_state, update) => update,
    },
  }),
  githubIssueId: withLangGraph(z.custom<number>(), {
    reducer: {
      schema: z.custom<number>(),
      fn: (_state, update) => update,
    },
  }),
  codebaseTree: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * URL을 키로 사용하여 가져온 문서 콘텐츠의 캐시입니다.
   */
  documentCache: withLangGraph(z.custom<Record<string, string>>(), {
    reducer: {
      schema: z.custom<Record<string, string>>(),
      fn: (state, update) => ({ ...state, ...update }),
    },
    default: () => ({}),
  }),
  taskPlan: withLangGraph(z.custom<TaskPlan>(), {
    reducer: {
      schema: z.custom<TaskPlan>(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 에이전트가 제안한 계획 항목들의 배열입니다.
   */
  proposedPlan: withLangGraph(z.custom<string[]>(), {
    reducer: {
      schema: z.custom<string[]>(),
      fn: (_state, update) => update,
    },
    default: (): string[] => [],
  }),
  /**
   * 컨텍스트 수집 단계에서 작성된 노트입니다.
   */
  contextGatheringNotes: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
    default: () => "",
  }),
  branchName: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 사용자가 계획 변경을 요청한 내용입니다.
   */
  planChangeRequest: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  programmerSession: withLangGraph(z.custom<AgentSession>(), {
    reducer: {
      schema: z.custom<AgentSession>(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 제안된 계획의 제목입니다.
   */
  proposedPlanTitle: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
    default: () => "",
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
   * 계획을 자동으로 수락할지 여부입니다.
   */
  autoAcceptPlan: withLangGraph(z.custom<boolean>().optional(), {
    reducer: {
      schema: z.custom<boolean>().optional(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 모델별 토큰 사용량 데이터입니다.
   */
  tokenData: withLangGraph(z.custom<ModelTokenData[]>().optional(), {
    reducer: {
      schema: z.custom<ModelTokenData[]>().optional(),
      fn: tokenDataReducer,
    },
  }),
});

// Zod 스키마로부터 추론된 TypeScript 타입입니다.
export type PlannerGraphState = z.infer<typeof PlannerGraphStateObj>;
export type PlannerGraphUpdate = Partial<PlannerGraphState>;