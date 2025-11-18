/**
 * @file types.ts
 * @description 이 파일은 매니저(Manager) 그래프의 상태(State) 객체에 대한 타입을 정의합니다.
 * 매니저 그래프는 전체 작업 흐름을 조율하는 역할을 하며, 이 상태 객체는
 * GitHub 이슈, PR, 작업 계획, 하위 에이전트 세션 등과 관련된 정보를 관리합니다.
 */

import { MessagesZodState } from "@langchain/langgraph";
import { TargetRepository, TaskPlan, AgentSession } from "../types.js";
import { z } from "zod";
import { withLangGraph } from "@langchain/langgraph/zod";

// 매니저 그래프의 상태를 정의하는 Zod 스키마 객체입니다.
export const ManagerGraphStateObj = MessagesZodState.extend({
  /**
   * 사용자의 요청과 관련된 GitHub 이슈 번호입니다.
   * 그래프 호출 시 제공되지 않으면 새로운 이슈를 생성합니다.
   */
  githubIssueId: z.number(),
  /**
   * 사용자의 요청을 해결하는 PR(Pull Request)의 GitHub 번호입니다.
   * 그래프 호출 시 제공되지 않으면 새로운 PR을 생성합니다.
   */
  githubPullRequestId: z.number().optional(),
  /**
   * 요청이 실행될 대상 저장소입니다.
   */
  targetRepository: z.custom<TargetRepository>(),
  /**
   * 이 요청에 대해 생성된 작업들입니다.
   */
  taskPlan: z.custom<TaskPlan>(),
  /**
   * 프로그래머(Programmer) 에이전트의 세션 정보입니다.
   */
  programmerSession: z.custom<AgentSession>().optional(),
  /**
   * 플래너(Planner) 에이전트의 세션 정보입니다.
   */
  plannerSession: z.custom<AgentSession>().optional(),
  /**
   * 체크아웃하여 변경 사항을 적용할 브랜치 이름입니다.
   * 사용자가 지정할 수 있으며, 기본값은 `open-swe/<manager-thread-id>`입니다.
   */
  branchName: z.string(),
  /**
   * 생성된 계획을 자동으로 수락할지 여부입니다.
   */
  autoAcceptPlan: withLangGraph(z.custom<boolean>().optional(), {
    reducer: {
      schema: z.custom<boolean>().optional(),
      fn: (_state, update) => update,
    },
  }),
});

// Zod 스키마로부터 추론된 TypeScript 타입입니다.
export type ManagerGraphState = z.infer<typeof ManagerGraphStateObj>;
export type ManagerGraphUpdate = Partial<ManagerGraphState>;