/**
 * @file Programmer 그래프 정의
 * @description
 * Open SWE의 코드 작성 에이전트인 Programmer의 LangGraph 워크플로우를 정의합니다.
 *
 * Programmer는 Planner가 생성한 계획을 실행하여 실제 코드를 작성하는 역할을 합니다:
 * 1. 샌드박스 환경 초기화
 * 2. 계획의 각 작업을 순차적으로 실행
 * 3. 코드 변경 사항 리뷰 (Reviewer 호출)
 * 4. Pull Request 생성
 *
 * 워크플로우 흐름:
 * START → initialize → generate-action → take-action (반복)
 *   ↓
 * route-to-review-or-conclusion → reviewer-subgraph → generate-conclusion → open-pr → END
 */

// LangGraph 핵심 구성 요소
// - Command: 복잡한 라우팅 및 상태 전달을 위한 고급 제어 구조
// - Send: 병렬 실행을 위한 메시지 전송
// - StateGraph: 상태 기반 워크플로우 그래프
import { Command, END, Send, START, StateGraph } from "@langchain/langgraph";

// Programmer 그래프의 상태 및 설정 타입
import {
  GraphAnnotation,    // 그래프 상태 어노테이션 (Zod 스키마)
  GraphConfig,        // 그래프 실행 설정
  GraphConfiguration, // 그래프 설정 타입
  GraphState,         // 그래프 상태 타입
} from "@openswe/shared/open-swe/types";

// Programmer 그래프의 모든 노드 함수들
import {
  generateAction,      // LLM을 사용하여 다음 코드 작성 액션 생성
  takeAction,          // 생성된 액션 실행 (파일 수정, 명령 실행 등)
  generateConclusion,  // 최종 작업 결론 및 요약 생성
  openPullRequest,     // GitHub Pull Request 생성
  diagnoseError,       // 에러 진단 (shared 노드)
  requestHelp,         // 사용자에게 도움 요청
  updatePlan,          // 실행 계획 업데이트
  summarizeHistory,    // 긴 대화 히스토리 요약
  handleCompletedTask, // 완료된 작업 처리
} from "./nodes/index.js";

// LangChain 메시지 타입 및 검사 함수
import { BaseMessage, isAIMessage } from "@langchain/core/messages";

// 공유 노드: 샌드박스 초기화 (Planner와 공유)
import { initializeSandbox } from "../shared/initialize-sandbox.js";

// Reviewer 하위 그래프 (코드 리뷰 담당)
import { graph as reviewerGraph } from "../reviewer/index.js";

// 유틸리티: 작업 계획 관리
import { getRemainingPlanItems } from "../../utils/current-task.js";     // 남은 작업 목록 조회
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks";    // 활성 작업 목록 조회
import { createMarkTaskCompletedToolFields } from "@openswe/shared/open-swe/tools"; // 작업 완료 도구 스키마

/**
 * 마지막 N개의 메시지에서 도구 호출이 누락되었는지 검사하는 헬퍼 함수
 *
 * @description
 * LLM이 연속으로 도구를 호출하지 않은 경우를 감지합니다. 이는 LLM이
 * 무한 루프에 빠지거나, 다음 단계를 결정하지 못하는 상황을 방지하는 데 사용됩니다.
 *
 * 검사 로직:
 * 1. 마지막 N개의 메시지가 모두 AI 메시지인지 확인
 * 2. 각 메시지에 도구 호출이 없는지 확인
 * 3. 둘 다 만족하면 true 반환 (도구 호출 누락 상태)
 *
 * @param {BaseMessage[]} messages - 전체 메시지 배열
 * @param {number} threshold - 검사할 마지막 메시지 개수
 * @returns {boolean}
 *   - true: 마지막 N개 메시지가 모두 도구 호출이 없는 AI 메시지
 *   - false: 그 외의 경우 (도구 호출 있음 or AI 메시지 아님)
 *
 * @example
 * // 마지막 2개 메시지가 모두 도구 호출 없는 AI 응답인 경우
 * messages = [
 *   AIMessage({ content: "파일을 확인하겠습니다" }),  // 도구 호출 없음
 *   AIMessage({ content: "작업을 진행하겠습니다" })   // 도구 호출 없음
 * ]
 * lastMessagesMissingToolCalls(messages, 2) // → true (문제 감지!)
 */
function lastMessagesMissingToolCalls(
  messages: BaseMessage[],
  threshold: number,
): boolean {
  // 마지막 N개 메시지 추출
  const lastMessages = messages.slice(-threshold);

  // 모든 메시지가 AI 메시지인지 확인
  if (!lastMessages.every(isAIMessage)) {
    // AI 메시지가 아닌 것이 포함되어 있으면 정상 (사용자 메시지 등)
    return false;
  }

  // 모든 AI 메시지에 도구 호출이 없는지 확인
  // 도구 호출이 하나도 없으면 true 반환 (문제 상황)
  return lastMessages.every((m) => !m.tool_calls?.length);
}

/**
 * 액션 생성 후 다음 노드로 라우팅하는 핵심 함수
 *
 * @description
 * LLM이 생성한 액션(도구 호출)을 분석하여 다음 실행 단계를 결정합니다.
 * 이 함수는 Programmer 그래프의 가장 복잡한 분기 로직을 담당합니다.
 *
 * 라우팅 결정 우선순위:
 * 1. **도구 호출이 있는 경우**: 도구 종류에 따라 분기
 *    - "request_human_help" → request-help (사용자 도움 요청)
 *    - "update_plan" → update-plan (계획 수정, Send 사용)
 *    - "mark_task_completed" → handle-completed-task (작업 완료 처리)
 *    - 기타 도구 → take-action (일반 액션 실행)
 *
 * 2. **도구 호출이 없는 경우**: 작업 상태에 따라 분기
 *    - 남은 작업 있음 + 최근 도구 호출 있음 → generate-action (재시도)
 *    - 그 외 → route-to-review-or-conclusion (리뷰 또는 종료)
 *
 * @param {GraphState} state - 현재 Programmer 그래프의 상태
 * @returns {string | Send} 다음 노드 이름 또는 Send 객체
 *   - "take-action": 일반 도구 실행
 *   - "request-help": 사용자에게 도움 요청
 *   - Send("update-plan"): 계획 업데이트 (상태 전달)
 *   - "handle-completed-task": 완료된 작업 처리
 *   - "generate-action": 다음 액션 재생성
 *   - "route-to-review-or-conclusion": 리뷰 또는 결론 단계로 이동
 */
function routeGeneratedAction(
  state: GraphState,
):
  | "route-to-review-or-conclusion"
  | "take-action"
  | "request-help"
  | "generate-action"
  | "handle-completed-task"
  | Send {
  const { internalMessages } = state;

  // 마지막 메시지 가져오기 (LLM의 최신 응답)
  const lastMessage = internalMessages[internalMessages.length - 1];

  // === 분기 1: 도구 호출이 있는 경우 ===
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    const toolCall = lastMessage.tool_calls[0];

    // 특수 도구 1: 사용자 도움 요청
    // LLM이 스스로 해결할 수 없는 문제를 만났을 때 사용
    if (toolCall.name === "request_human_help") {
      return "request-help";
    }

    // 특수 도구 2: 계획 업데이트
    // LLM이 기존 계획이 부적절하다고 판단하여 수정을 요청할 때 사용
    // Send를 사용하여 planChangeRequest 상태를 함께 전달
    if (
      toolCall.name === "update_plan" &&
      "update_plan_reasoning" in toolCall.args &&
      typeof toolCall.args?.update_plan_reasoning === "string"
    ) {
      return new Send("update-plan", {
        ...state,
        planChangeRequest: toolCall.args?.update_plan_reasoning,
      });
    }

    // 특수 도구 3: 작업 완료 표시
    // LLM이 특정 작업을 완료했다고 판단할 때 사용
    const taskMarkedCompleted =
      toolCall.name === createMarkTaskCompletedToolFields().name;
    if (taskMarkedCompleted) {
      return "handle-completed-task";
    }

    // 일반 도구: 파일 수정, 명령 실행 등
    return "take-action";
  }

  // === 분기 2: 도구 호출이 없는 경우 ===

  // 남은 작업 확인
  const activePlanItems = getActivePlanItems(state.taskPlan);
  const hasRemainingTasks = getRemainingPlanItems(activePlanItems).length > 0;

  // 남은 작업이 있지만 LLM이 도구를 호출하지 않은 경우
  // → 최근 2개 메시지에 도구 호출이 있었는지 확인
  // → 있었다면 일시적인 문제일 수 있으므로 재시도
  if (hasRemainingTasks && !lastMessagesMissingToolCalls(internalMessages, 2)) {
    return "generate-action";
  }

  // 남은 작업이 없거나, 연속으로 도구 호출을 하지 않은 경우
  // → 리뷰 단계로 이동 (작업 완료 가능성)
  return "route-to-review-or-conclusion";
}

/**
 * Reviewer 완료 후 다음 단계를 결정하는 라우팅 함수
 *
 * @description
 * 코드 리뷰가 완료된 후, 계획의 모든 작업이 완료되었는지 확인하여
 * 최종 결론 단계로 이동할지, 추가 작업을 계속할지 결정합니다.
 *
 * 라우팅 로직:
 * - 모든 작업 완료됨 → "generate-conclusion" (최종 요약 및 PR 생성)
 * - 남은 작업 있음 → "generate-action" (다음 작업 계속)
 *
 * @param {GraphState} state - 현재 그래프 상태
 * @returns {"generate-conclusion" | "generate-action"} 다음 노드 이름
 */
function routeGenerateActionsOrEnd(
  state: GraphState,
): "generate-conclusion" | "generate-action" {
  // 활성 작업 목록 가져오기
  const activePlanItems = getActivePlanItems(state.taskPlan);

  // 모든 작업이 완료되었는지 확인
  const allCompleted = activePlanItems.every((p) => p.completed);

  if (allCompleted) {
    // 모든 작업 완료 → 최종 결론 생성 및 PR 준비
    return "generate-conclusion";
  }

  // 남은 작업 있음 → 다음 액션 생성 단계로 복귀
  return "generate-action";
}

/**
 * 리뷰 단계로 진입할지, 최대 리뷰 횟수 도달로 결론 단계로 넘어갈지 결정
 *
 * @description
 * 코드 변경 사항에 대한 리뷰를 실행하거나, 리뷰 횟수 제한에 도달한 경우
 * 리뷰를 건너뛰고 최종 결론으로 이동합니다.
 *
 * 리뷰 제한 이유:
 * - 무한 리뷰 루프 방지 (Reviewer가 계속 수정 요청하는 경우)
 * - 시간 및 비용 관리
 * - 기본 최대 리뷰 횟수: 3회
 *
 * @param {GraphState} state - 현재 그래프 상태
 *   - reviewsCount: 현재까지 수행된 리뷰 횟수
 * @param {GraphConfig} config - 그래프 설정
 *   - maxReviewCount: 허용되는 최대 리뷰 횟수 (기본값: 3)
 *
 * @returns {Command} LangGraph Command 객체 (라우팅 지시)
 *   - goto: "reviewer-subgraph" → 리뷰 실행
 *   - goto: "generate-conclusion" → 리뷰 건너뛰고 결론으로 이동
 */
function routeToReviewOrConclusion(
  state: GraphState,
  config: GraphConfig,
): Command {
  // 설정에서 최대 리뷰 횟수 가져오기 (기본값: 3)
  const maxAllowedReviews = config.configurable?.maxReviewCount ?? 3;

  // 최대 리뷰 횟수에 도달한 경우
  if (state.reviewsCount >= maxAllowedReviews) {
    // 리뷰를 건너뛰고 최종 결론 단계로 이동
    return new Command({
      goto: "generate-conclusion",
    });
  }

  // 아직 리뷰 가능 횟수가 남음 → Reviewer 하위 그래프 실행
  return new Command({
    goto: "reviewer-subgraph",
  });
}

/**
 * Programmer 워크플로우 정의
 *
 * @description
 * Programmer 에이전트의 전체 실행 흐름을 정의하는 StateGraph 인스턴스입니다.
 * 계획 실행부터 코드 작성, 리뷰, PR 생성까지의 전 과정을 관리합니다.
 */
const workflow = new StateGraph(GraphAnnotation, GraphConfiguration)
  /**
   * 노드 1: initialize (샌드박스 초기화)
   * - Daytona 샌드박스 환경 생성 또는 재사용
   * - GitHub 저장소 클론 및 브랜치 체크아웃
   * - 코드베이스 트리 생성
   * - 공유 노드 (Planner와 동일한 로직 사용)
   */
  .addNode("initialize", initializeSandbox)

  /**
   * 노드 2: generate-action (액션 생성) ⭐ 핵심 노드
   * - LLM을 사용하여 다음 코드 작성 단계 결정
   * - 파일 수정, 명령 실행 등의 도구 호출 생성
   * - 작업 계획을 참조하여 우선순위 결정
   */
  .addNode("generate-action", generateAction)

  /**
   * 노드 3: take-action (액션 실행)
   * - LLM이 생성한 도구 호출을 실제로 실행
   * - 파일 편집, 셸 명령 실행, grep 검색 등
   * - ends: 성공 시 generate-action, 에러 시 diagnose-error
   */
  .addNode("take-action", takeAction, {
    ends: ["generate-action", "diagnose-error"],
  })

  /**
   * 노드 4: update-plan (계획 업데이트)
   * - LLM이 기존 계획이 부적절하다고 판단한 경우 호출
   * - 새로운 작업 추가, 기존 작업 수정 또는 삭제
   * - 업데이트된 계획을 사용자에게 알림
   */
  .addNode("update-plan", updatePlan)

  /**
   * 노드 5: handle-completed-task (완료된 작업 처리)
   * - LLM이 특정 작업을 완료했다고 표시한 경우 호출
   * - 작업 완료 상태 업데이트
   * - 필요시 히스토리 요약 또는 리뷰 단계로 이동
   * - ends: summarize-history, generate-action, route-to-review-or-conclusion
   */
  .addNode("handle-completed-task", handleCompletedTask, {
    ends: [
      "summarize-history",
      "generate-action",
      "route-to-review-or-conclusion",
    ],
  })

  /**
   * 노드 6: generate-conclusion (최종 결론 생성)
   * - 모든 작업이 완료된 후 전체 작업 요약 생성
   * - 변경 사항 요약, 주요 결정 사항 정리
   * - PR 생성 준비 또는 종료
   * - ends: open-pr, END
   */
  .addNode("generate-conclusion", generateConclusion, {
    ends: ["open-pr", END],
  })

  /**
   * 노드 7: request-help (사용자 도움 요청)
   * - LLM이 스스로 해결할 수 없는 문제에 직면한 경우
   * - 사용자에게 명확한 질문 또는 도움 요청
   * - ends: 사용자 응답 후 generate-action, 또는 종료
   */
  .addNode("request-help", requestHelp, {
    ends: ["generate-action", END],
  })

  /**
   * 노드 8: route-to-review-or-conclusion (리뷰/결론 라우팅)
   * - 리뷰 횟수 제한 확인
   * - 제한 미달 시 reviewer-subgraph 호출
   * - 제한 도달 시 generate-conclusion으로 이동
   * - ends: generate-conclusion, reviewer-subgraph
   */
  .addNode("route-to-review-or-conclusion", routeToReviewOrConclusion, {
    ends: ["generate-conclusion", "reviewer-subgraph"],
  })

  /**
   * 노드 9: reviewer-subgraph (코드 리뷰 하위 그래프)
   * - Reviewer 에이전트를 별도 그래프로 실행
   * - 코드 변경 사항 검토 및 개선 제안
   * - 문제 발견 시 Programmer에게 수정 요청
   */
  .addNode("reviewer-subgraph", reviewerGraph)

  /**
   * 노드 10: open-pr (Pull Request 생성)
   * - GitHub API를 통해 PR 생성
   * - 변경 사항 요약 및 설명 작성
   * - 관련 이슈와 연결
   */
  .addNode("open-pr", openPullRequest)

  /**
   * 노드 11: diagnose-error (에러 진단)
   * - 도구 실행 중 발생한 에러 분석
   * - LLM을 사용한 원인 파악 및 해결책 제시
   * - 공유 노드 (모든 그래프에서 사용)
   */
  .addNode("diagnose-error", diagnoseError)

  /**
   * 노드 12: summarize-history (히스토리 요약)
   * - 긴 대화 히스토리를 압축하여 컨텍스트 길이 관리
   * - 중요한 정보만 유지하고 중복 제거
   * - 토큰 사용량 최적화
   */
  .addNode("summarize-history", summarizeHistory)

  // === 엣지 정의 (노드 간 전환 규칙) ===

  /**
   * 엣지 1: START → initialize
   * 워크플로우 시작 시 항상 샌드박스 초기화부터 시작
   */
  .addEdge(START, "initialize")

  /**
   * 엣지 2: initialize → generate-action
   * 샌드박스 초기화 완료 후 첫 번째 액션 생성 단계로 이동
   */
  .addEdge("initialize", "generate-action")

  /**
   * 엣지 3: generate-action → (조건부 분기) ⭐ 핵심 라우팅
   * LLM이 생성한 액션 종류에 따라 다양한 경로로 분기:
   * - take-action: 일반 도구 실행
   * - request-help: 사용자 도움 요청
   * - route-to-review-or-conclusion: 리뷰 또는 종료
   * - update-plan: 계획 업데이트 (Send 사용)
   * - generate-action: 재시도
   * - handle-completed-task: 작업 완료 처리
   */
  .addConditionalEdges("generate-action", routeGeneratedAction, [
    "take-action",
    "request-help",
    "route-to-review-or-conclusion",
    "update-plan",
    "generate-action",
    "handle-completed-task",
  ])

  /**
   * 엣지 4: update-plan → generate-action
   * 계획 업데이트 후 새로운 계획에 따라 다음 액션 생성
   */
  .addEdge("update-plan", "generate-action")

  /**
   * 엣지 5: diagnose-error → generate-action
   * 에러 진단 및 해결책 제시 후 다음 액션 재생성
   */
  .addEdge("diagnose-error", "generate-action")

  /**
   * 엣지 6: reviewer-subgraph → (조건부 분기)
   * 리뷰 완료 후 작업 완료 여부에 따라 분기:
   * - generate-conclusion: 모든 작업 완료
   * - generate-action: 추가 작업 필요
   */
  .addConditionalEdges("reviewer-subgraph", routeGenerateActionsOrEnd, [
    "generate-conclusion",
    "generate-action",
  ])

  /**
   * 엣지 7: summarize-history → generate-action
   * 히스토리 요약 후 컨텍스트 최적화된 상태로 다음 액션 생성
   */
  .addEdge("summarize-history", "generate-action")

  /**
   * 엣지 8: open-pr → END
   * Pull Request 생성 완료 후 워크플로우 종료
   */
  .addEdge("open-pr", END);

/**
 * Programmer 그래프 컴파일 및 내보내기
 *
 * @description
 * 정의된 워크플로우를 실행 가능한 형태로 컴파일합니다.
 * Zod 타입 안정성 문제로 인해 any로 캐스팅합니다.
 *
 * @note
 * Programmer 그래프는 Open SWE의 핵심 실행 엔진으로,
 * 복잡한 조건부 라우팅과 하위 그래프 통합을 포함합니다.
 */
export const graph = workflow.compile() as any;

// 그래프에 사람이 읽기 쉬운 이름 할당 (로깅 및 디버깅용)
graph.name = "Open SWE - Programmer";
