/**
 * @file Reviewer 그래프 정의
 * @description
 * Open SWE의 코드 리뷰 에이전트인 Reviewer의 LangGraph 워크플로우를 정의합니다.
 *
 * Reviewer는 Programmer가 작성한 코드를 검토하고 개선 제안을 하는 역할을 합니다:
 * 1. 코드 변경 사항 분석
 * 2. 문제점 및 개선 가능한 부분 식별
 * 3. 추가 확인이 필요한 경우 도구 사용 (파일 읽기 등)
 * 4. 최종 리뷰 의견 생성
 *
 * 워크플로우 흐름:
 * START → initialize-state → generate-review-actions → (take-review-actions 루프)
 *   ↓
 * final-review → END
 */

// LangGraph 핵심 구성 요소
import { END, START, StateGraph } from "@langchain/langgraph";

// Reviewer 그래프의 상태 타입 정의
import {
  ReviewerGraphState,     // 현재 상태 (읽기 전용)
  ReviewerGraphStateObj,  // 상태 객체 스키마
} from "@openswe/shared/open-swe/reviewer/types";

// 그래프 설정 타입
import { GraphConfiguration } from "@openswe/shared/open-swe/types";

// Reviewer 그래프의 모든 노드 함수들
import {
  finalReview,            // 최종 리뷰 의견 생성
  generateReviewActions,  // 리뷰 액션 생성 (추가 정보 수집)
  initializeState,        // 상태 초기화
  takeReviewerActions,    // 생성된 액션 실행
} from "./nodes/index.js";

// LangChain 메시지 타입 검사 함수
import { isAIMessage } from "@langchain/core/messages";

// 공유 노드: 에러 진단 (모든 그래프에서 사용)
import { diagnoseError } from "../shared/diagnose-error.js";

/**
 * 리뷰 액션 실행 또는 최종 리뷰 생성으로 라우팅하는 함수
 *
 * @description
 * LLM이 생성한 마지막 메시지를 검사하여 도구 호출이 포함되어 있는지 확인합니다.
 * 도구 호출이 있으면 추가 정보 수집이 필요한 것으로 판단하고,
 * 없으면 리뷰 준비가 완료된 것으로 간주합니다.
 *
 * 라우팅 로직:
 * - AI 메시지에 도구 호출 있음 → 'take-review-actions' (추가 정보 수집)
 * - 도구 호출 없음 → 'final-review' (최종 리뷰 생성)
 *
 * @param {ReviewerGraphState} state - 현재 Reviewer 그래프의 상태
 * @returns {"take-review-actions" | "final-review"} 다음 노드 이름
 *
 * @example
 * // Reviewer가 특정 파일을 확인하고 싶을 때
 * lastMessage = AIMessage({ tool_calls: [{ name: "view", args: {...} }] })
 * // → 'take-review-actions' 반환 (파일 읽기 실행)
 *
 * // Reviewer가 충분한 정보를 수집한 후
 * lastMessage = AIMessage({ content: "리뷰 준비 완료" })
 * // → 'final-review' 반환 (최종 리뷰 생성)
 */
function takeReviewActionsOrFinalReview(
  state: ReviewerGraphState,
): "take-review-actions" | "final-review" {
  const { reviewerMessages } = state;

  // 마지막 메시지 가져오기 (Reviewer LLM의 최신 응답)
  const lastMessage = reviewerMessages[reviewerMessages.length - 1];

  // AI 메시지이고 도구 호출이 있으면 추가 정보 수집 필요
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    return "take-review-actions";
  }

  // 도구 호출이 없으면 리뷰 준비 완료 → 최종 리뷰 생성
  return "final-review";
}

/**
 * Reviewer 워크플로우 정의
 *
 * @description
 * Reviewer 에이전트의 전체 실행 흐름을 정의하는 StateGraph 인스턴스입니다.
 * 코드 변경 사항 분석부터 최종 리뷰 의견 생성까지의 과정을 관리합니다.
 */
const workflow = new StateGraph(ReviewerGraphStateObj, GraphConfiguration)
  /**
   * 노드 1: initialize-state (상태 초기화)
   * - Programmer로부터 전달받은 코드 변경 사항 로드
   * - 리뷰 컨텍스트 설정
   * - Reviewer 전용 메시지 버퍼 초기화
   */
  .addNode("initialize-state", initializeState)

  /**
   * 노드 2: generate-review-actions (리뷰 액션 생성)
   * - LLM을 사용하여 리뷰에 필요한 정보 수집 액션 생성
   * - 파일 읽기, 코드 검색 등의 도구 호출 생성
   * - 충분한 정보가 있으면 도구 호출 없이 리뷰 준비 완료 신호
   */
  .addNode("generate-review-actions", generateReviewActions)

  /**
   * 노드 3: take-review-actions (리뷰 액션 실행)
   * - LLM이 생성한 도구 호출을 실행하여 추가 정보 수집
   * - 파일 내용, 코드 구조 등 확인
   * - ends: 성공 시 generate-review-actions, 에러 시 diagnose-reviewer-error, 완료 시 final-review
   */
  .addNode("take-review-actions", takeReviewerActions, {
    ends: [
      "generate-review-actions",
      "diagnose-reviewer-error",
      "final-review",
    ],
  })

  /**
   * 노드 4: diagnose-reviewer-error (리뷰어 에러 진단)
   * - 리뷰 중 발생한 에러 분석
   * - LLM을 사용한 에러 원인 파악 및 해결책 제시
   * - 공유 노드 (diagnoseError 사용)
   */
  .addNode("diagnose-reviewer-error", diagnoseError)

  /**
   * 노드 5: final-review (최종 리뷰 생성) ⭐ 핵심 노드
   * - 수집한 정보를 바탕으로 최종 리뷰 의견 생성
   * - 문제점, 개선 제안, 코드 품질 평가 등 포함
   * - Programmer에게 전달할 피드백 생성
   */
  .addNode("final-review", finalReview)

  // === 엣지 정의 (노드 간 전환 규칙) ===

  /**
   * 엣지 1: START → initialize-state
   * 워크플로우 시작 시 항상 상태 초기화부터 시작
   */
  .addEdge(START, "initialize-state")

  /**
   * 엣지 2: initialize-state → generate-review-actions
   * 상태 초기화 완료 후 리뷰 액션 생성 단계로 이동
   */
  .addEdge("initialize-state", "generate-review-actions")

  /**
   * 엣지 3: generate-review-actions → (조건부 분기)
   * - AI가 도구 호출 생성 → take-review-actions (추가 정보 수집)
   * - 도구 호출 없음 → final-review (리뷰 준비 완료)
   */
  .addConditionalEdges(
    "generate-review-actions",
    takeReviewActionsOrFinalReview,
    ["take-review-actions", "final-review"],
  )

  /**
   * 엣지 4: diagnose-reviewer-error → generate-review-actions
   * 에러 진단 후 다시 리뷰 액션 생성 단계로 복귀
   */
  .addEdge("diagnose-reviewer-error", "generate-review-actions")

  /**
   * 엣지 5: final-review → END
   * 최종 리뷰 생성 완료 후 워크플로우 종료
   * (결과는 Programmer 그래프로 반환됨)
   */
  .addEdge("final-review", END);

/**
 * Reviewer 그래프 컴파일 및 내보내기
 *
 * @description
 * 정의된 워크플로우를 실행 가능한 형태로 컴파일합니다.
 * Reviewer는 Programmer의 하위 그래프로 호출되어 코드 품질을 보장합니다.
 */
export const graph = workflow.compile();

// 그래프에 사람이 읽기 쉬운 이름 할당 (로깅 및 디버깅용)
graph.name = "Open SWE - Reviewer";
