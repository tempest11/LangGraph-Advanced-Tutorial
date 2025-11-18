/**
 * @file types.ts
 * @description 이 파일은 검토자(Reviewer) 그래프의 상태(State) 객체에 대한 타입을 정의합니다.
 * 검토자 그래프는 코드 변경 사항을 검토하는 역할을 하며, 이 상태 객체는 검토 과정에
 * 필요한 모든 정보(예: 내부 메시지, 변경된 파일, 검토 횟수 등)를 관리합니다.
 */

import "@langchain/langgraph/zod";
import { z } from "zod";
import {
  Messages,
  messagesStateReducer,
  MessagesZodState,
} from "@langchain/langgraph";
import {
  CustomRules,
  ModelTokenData,
  TargetRepository,
  TaskPlan,
} from "../types.js";
import { withLangGraph } from "@langchain/langgraph/zod";
import { BaseMessage } from "@langchain/core/messages";
import { tokenDataReducer } from "../../caching.js";

// 검토자 그래프의 상태를 정의하는 Zod 스키마 객체입니다.
export const ReviewerGraphStateObj = MessagesZodState.extend({
  /**
   * 내부 메시지 목록입니다. 검토자가 대화의 정확한 그림을 가질 수 있도록
   * LLM에 전달되는 메시지들을 포함합니다.
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
   * 검토자 전용 메시지 목록입니다. 사용자에게 보여주거나 프로그래머에게 전파할 필요가 없는
   * 내부 메시지를 추적하고, 검토자 작업 실행 횟수를 결정하는 데 사용됩니다.
   */
  reviewerMessages: withLangGraph(z.custom<BaseMessage[]>(), {
    reducer: {
      schema: z.custom<Messages>(),
      fn: messagesStateReducer,
    },
    jsonSchemaExtra: {
      langgraph_type: "messages",
    },
    default: () => [],
  }),
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
  taskPlan: withLangGraph(z.custom<TaskPlan>(), {
    reducer: {
      schema: z.custom<TaskPlan>(),
      fn: (_state, update) => update,
    },
  }),
  branchName: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 비교 대상이 되는 기본 브랜치 이름입니다.
   */
  baseBranchName: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  /**
   * 변경된 파일 목록입니다.
   */
  changedFiles: withLangGraph(z.string(), {
    reducer: {
      schema: z.string(),
      fn: (_state, update) => update,
    },
  }),
  customRules: withLangGraph(z.custom<CustomRules>().optional(), {
    reducer: {
      schema: z.custom<CustomRules>().optional(),
      fn: (_state, update) => update,
    },
  }),
  dependenciesInstalled: withLangGraph(z.boolean(), {
    reducer: {
      schema: z.boolean(),
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

// Zod 스키마로부터 추론된 TypeScript 타입입니다.
export type ReviewerGraphState = z.infer<typeof ReviewerGraphStateObj>;
export type ReviewerGraphUpdate = Partial<ReviewerGraphState>;