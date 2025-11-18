/**
 * @file Planner 그래프 정의
 * @description
 * Open SWE의 계획 수립 에이전트인 Planner의 LangGraph 워크플로우를 정의합니다.
 *
 * Planner는 사용자 요청을 분석하고 실행 가능한 계획을 수립하는 역할을 합니다:
 * 1. 샌드박스 환경 초기화
 * 2. 코드베이스 컨텍스트 수집 (필요시)
 * 3. LLM을 사용한 실행 계획 생성
 * 4. 사용자 승인 대기 (human-in-the-loop)
 *
 * 워크플로우 흐름:
 * START → prepare-graph-state → initialize-sandbox → generate-plan-context-action
 *   ↓                                                           ↓
 * (컨텍스트 수집 루프) → generate-plan → notetaker → interrupt-proposed-plan
 *   ↓
 * 사용자 승인 후 → determine-needs-context → (추가 컨텍스트 or Programmer로 전달)
 */

// LangGraph 핵심 구성 요소
// - StateGraph: 상태 기반 워크플로우 그래프
// - START/END: 그래프의 시작과 종료 노드
import { END, START, StateGraph } from "@langchain/langgraph";

// Planner 그래프의 상태 타입 정의
import {
  PlannerGraphState,     // 현재 상태 (읽기 전용)
  PlannerGraphStateObj,  // 상태 객체 스키마
} from "@openswe/shared/open-swe/planner/types";

// 그래프 설정 타입 (런타임 매개변수)
import { GraphConfiguration } from "@openswe/shared/open-swe/types";

// Planner 그래프의 모든 노드 함수들
import {
  generateAction,         // LLM을 사용하여 다음 액션 생성
  generatePlan,          // 실행 계획 생성 (핵심 노드)
  interruptProposedPlan, // 사용자 승인 대기 (중단점)
  prepareGraphState,     // 그래프 상태 준비 및 검증
  notetaker,             // 수집한 컨텍스트 요약
  takeActions,           // 도구를 사용하여 액션 실행
  determineNeedsContext, // 추가 컨텍스트 필요 여부 판단
} from "./nodes/index.js";

// LangChain 메시지 타입 검사 함수
import { isAIMessage } from "@langchain/core/messages";

// 공유 노드: 샌드박스 초기화 (Programmer와도 공유)
import { initializeSandbox } from "../shared/initialize-sandbox.js";

// 공유 노드: 에러 진단 (모든 그래프에서 사용)
import { diagnoseError } from "../shared/diagnose-error.js";

/**
 * 컨텍스트 수집 단계에서 다음 액션을 결정하는 라우팅 함수
 *
 * @description
 * LLM이 생성한 마지막 메시지를 검사하여 도구 호출이 포함되어 있는지 확인합니다.
 * 이를 통해 컨텍스트 수집을 계속할지, 계획 생성으로 넘어갈지 결정합니다.
 *
 * 라우팅 로직:
 * - AI 메시지에 도구 호출이 있음 → 'take-plan-actions' (도구 실행)
 * - 도구 호출이 없음 → 'generate-plan' (컨텍스트 수집 완료, 계획 생성 시작)
 *
 * @param {PlannerGraphState} state - 현재 Planner 그래프의 상태
 * @returns {"take-plan-actions" | "generate-plan"} 다음 노드 이름
 *
 * @example
 * // AI가 파일 읽기 도구를 호출한 경우
 * lastMessage = AIMessage({ tool_calls: [{ name: "view", args: {...} }] })
 * // → 'take-plan-actions' 반환 (도구 실행)
 *
 * // AI가 충분한 컨텍스트를 수집했다고 판단한 경우
 * lastMessage = AIMessage({ content: "충분한 정보를 수집했습니다" })
 * // → 'generate-plan' 반환 (계획 생성 시작)
 */
function takeActionOrGeneratePlan(
  state: PlannerGraphState,
): "take-plan-actions" | "generate-plan" {
  const { messages } = state;

  // 마지막 메시지 가져오기
  const lastMessage = messages[messages.length - 1];

  // AI 메시지이고 도구 호출이 있으면 도구를 실행해야 함
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    return "take-plan-actions";
  }

  // 도구 호출이 없으면 컨텍스트 수집이 완료된 것으로 간주하고 계획 생성으로 이동
  return "generate-plan";
}

/**
 * Planner 워크플로우 정의
 *
 * @description
 * Planner 에이전트의 전체 실행 흐름을 정의하는 StateGraph 인스턴스입니다.
 * 사용자 요청부터 실행 계획 수립 및 승인까지의 전 과정을 관리합니다.
 */
const workflow = new StateGraph(PlannerGraphStateObj, GraphConfiguration)
  /**
   * 노드 1: prepare-graph-state (상태 준비)
   * - 그래프 초기 상태 검증 및 설정
   * - 필요한 메타데이터 초기화
   * - ends: 조건에 따라 END 또는 initialize-sandbox로 분기 가능
   */
  .addNode("prepare-graph-state", prepareGraphState, {
    ends: [END, "initialize-sandbox"],
  })

  /**
   * 노드 2: initialize-sandbox (샌드박스 초기화)
   * - Daytona를 통한 샌드박스 환경 생성
   * - GitHub 저장소 클론
   * - 코드베이스 트리 생성
   * - 공유 노드 (Programmer와도 사용)
   */
  .addNode("initialize-sandbox", initializeSandbox)

  /**
   * 노드 3: generate-plan-context-action (컨텍스트 수집 액션 생성)
   * - LLM이 계획 수립에 필요한 정보 수집을 위한 액션 생성
   * - 파일 읽기, 코드 검색 등의 도구 호출 생성
   */
  .addNode("generate-plan-context-action", generateAction)

  /**
   * 노드 4: take-plan-actions (액션 실행)
   * - LLM이 생성한 도구 호출을 실제로 실행
   * - 파일 내용, 검색 결과 등을 수집
   * - ends: 성공 시 generate-plan-context-action, 에러 시 diagnose-error, 완료 시 generate-plan
   */
  .addNode("take-plan-actions", takeActions, {
    ends: ["generate-plan-context-action", "diagnose-error", "generate-plan"],
  })

  /**
   * 노드 5: generate-plan (실행 계획 생성) ⭐ 핵심 노드
   * - 수집한 컨텍스트를 바탕으로 LLM이 단계별 실행 계획 생성
   * - 작업 분해 및 우선순위 결정
   * - 구조화된 계획 문서 생성
   */
  .addNode("generate-plan", generatePlan)

  /**
   * 노드 6: notetaker (노트 작성)
   * - 컨텍스트 수집 과정에서 얻은 주요 정보 요약
   * - 계획 수립에 사용된 핵심 인사이트 정리
   * - 사용자에게 제시할 요약 정보 생성
   */
  .addNode("notetaker", notetaker)

  /**
   * 노드 7: interrupt-proposed-plan (계획 승인 대기) 🛑 중단점
   * - Human-in-the-loop: 사용자의 계획 승인 대기
   * - 사용자가 계획을 검토하고 수정 요청 또는 승인 가능
   * - ends: 승인 시 determine-needs-context, 거부 시 END
   */
  .addNode("interrupt-proposed-plan", interruptProposedPlan, {
    ends: [END, "determine-needs-context"],
  })

  /**
   * 노드 8: determine-needs-context (추가 컨텍스트 필요 여부 판단)
   * - 사용자 피드백을 바탕으로 추가 정보 수집 필요 여부 결정
   * - 필요 시 다시 컨텍스트 수집 루프로 진입
   * - 불필요 시 계획 재생성
   * - ends: 추가 컨텍스트 필요 시 generate-plan-context-action, 아니면 generate-plan
   */
  .addNode("determine-needs-context", determineNeedsContext, {
    ends: ["generate-plan-context-action", "generate-plan"],
  })

  /**
   * 노드 9: diagnose-error (에러 진단)
   * - 도구 실행 중 발생한 에러 분석
   * - LLM을 사용한 에러 원인 파악 및 해결책 제시
   * - 공유 노드 (모든 그래프에서 사용)
   */
  .addNode("diagnose-error", diagnoseError)

  // === 엣지 정의 (노드 간 전환 규칙) ===

  /**
   * 엣지 1: START → prepare-graph-state
   * 워크플로우 시작 시 항상 상태 준비부터 시작
   */
  .addEdge(START, "prepare-graph-state")

  /**
   * 엣지 2: initialize-sandbox → generate-plan-context-action
   * 샌드박스 초기화 완료 후 컨텍스트 수집 시작
   */
  .addEdge("initialize-sandbox", "generate-plan-context-action")

  /**
   * 엣지 3: generate-plan-context-action → (조건부 분기)
   * - AI가 도구 호출 생성 → take-plan-actions (도구 실행)
   * - 도구 호출 없음 → generate-plan (컨텍스트 수집 완료, 계획 생성)
   */
  .addConditionalEdges(
    "generate-plan-context-action",
    takeActionOrGeneratePlan,
    ["take-plan-actions", "generate-plan"],
  )

  /**
   * 엣지 4: diagnose-error → generate-plan-context-action
   * 에러 진단 후 다시 액션 생성 단계로 복귀
   */
  .addEdge("diagnose-error", "generate-plan-context-action")

  /**
   * 엣지 5: generate-plan → notetaker
   * 계획 생성 완료 후 노트 작성
   */
  .addEdge("generate-plan", "notetaker")

  /**
   * 엣지 6: notetaker → interrupt-proposed-plan
   * 노트 작성 후 사용자 승인 대기 (중단점)
   */
  .addEdge("notetaker", "interrupt-proposed-plan");

/**
 * Planner 그래프 컴파일 및 내보내기
 *
 * @description
 * 정의된 워크플로우를 실행 가능한 형태로 컴파일합니다.
 * 컴파일 과정에서 노드와 엣지의 유효성을 검증하고 최적화합니다.
 */
export const graph = workflow.compile();

// 그래프에 사람이 읽기 쉬운 이름 할당 (로깅 및 디버깅용)
graph.name = "Open SWE - Planner";
