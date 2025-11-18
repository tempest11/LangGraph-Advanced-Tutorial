/**
 * @file Manager 그래프 정의
 * @description
 * Open SWE 시스템의 최상위 조율자인 Manager 에이전트의 LangGraph 워크플로우를 정의합니다.
 *
 * Manager는 전체 시스템의 진입점으로서 다음 역할을 수행합니다:
 * 1. GitHub 이슈 초기화 및 메타데이터 설정
 * 2. 들어오는 메시지 유형 분류 (새 작업, 기존 세션 참여 등)
 * 3. 적절한 하위 에이전트(Planner)로 라우팅 또는 새 세션 생성
 *
 * 워크플로우 흐름:
 * START → initialize-github-issue → classify-message → (start-planner | create-new-session | END)
 */

// LangGraph의 핵심 구성 요소 임포트
// - StateGraph: 상태 기반 그래프 워크플로우 생성 클래스
// - START/END: 그래프의 시작과 종료 노드를 나타내는 특수 심볼
import { END, START, StateGraph } from "@langchain/langgraph";

// 그래프 설정 타입 (설정 가능한 매개변수 정의)
import { GraphConfiguration } from "@openswe/shared/open-swe/types";

// Manager 그래프의 상태 객체 타입 정의
// 이 타입은 그래프 실행 중 유지되는 모든 상태 정보를 포함합니다
import { ManagerGraphStateObj } from "@openswe/shared/open-swe/manager/types";

// Manager 그래프에서 사용하는 모든 노드 함수들을 임포트
// 각 노드는 특정 작업을 수행하고 상태를 업데이트합니다
import {
  initializeGithubIssue,  // GitHub 이슈 초기화 노드
  classifyMessage,        // 메시지 분류 노드 (라우팅 결정)
  startPlanner,           // Planner 에이전트 시작 노드
  createNewSession,       // 새 세션 생성 노드
} from "./nodes/index.js";

/**
 * Manager 에이전트의 워크플로우를 정의하는 StateGraph 인스턴스
 *
 * @description
 * Manager는 Open SWE의 최상위 조율자로, GitHub 이슈를 초기화하고
 * 들어오는 메시지를 분류하여 적절한 다음 단계로 라우팅합니다.
 *
 * 주요 기능:
 * - GitHub 이슈 메타데이터 초기화 및 검증
 * - LLM을 사용한 메시지 의도 분류
 * - 새 작업의 경우 Planner 에이전트로 전달
 * - 기존 세션 참여 또는 종료 처리
 *
 * @type {StateGraph<ManagerGraphStateObj, GraphConfiguration>}
 */
const workflow = new StateGraph(ManagerGraphStateObj, GraphConfiguration)
  /**
   * 노드 1: GitHub 이슈 초기화
   * - GitHub API를 통해 이슈 정보 조회
   * - 이슈 메타데이터(제목, 본문, 라벨 등) 파싱
   * - 상태 객체에 이슈 정보 저장
   */
  .addNode("initialize-github-issue", initializeGithubIssue)

  /**
   * 노드 2: 메시지 분류 (핵심 라우팅 로직)
   * - LLM을 사용하여 메시지 의도 분석
   * - 가능한 분류 결과:
   *   1. 새 작업 요청 → start-planner로 라우팅
   *   2. 기존 세션 참여 → create-new-session으로 라우팅
   *   3. 종료 요청 → END로 라우팅
   * - ends 옵션: 이 노드가 동적으로 선택할 수 있는 다음 노드들
   */
  .addNode("classify-message", classifyMessage, {
    ends: [END, "start-planner", "create-new-session"],
  })

  /**
   * 노드 3: 새 세션 생성
   * - 기존 실행 중인 에이전트와 별도로 새 세션 시작
   * - 사용자가 진행 중인 작업에 추가 요청을 할 때 사용
   * - 세션 메타데이터 생성 후 종료
   */
  .addNode("create-new-session", createNewSession)

  /**
   * 노드 4: Planner 에이전트 시작
   * - 새로운 코딩 작업을 위한 Planner 그래프 호출
   * - Planner는 작업 계획을 수립하고 Programmer로 전달
   * - 하위 그래프 실행 후 Manager는 종료
   */
  .addNode("start-planner", startPlanner)

  /**
   * 엣지 1: 워크플로우 시작
   * START 노드에서 initialize-github-issue 노드로 무조건 이동
   */
  .addEdge(START, "initialize-github-issue")

  /**
   * 엣지 2: 이슈 초기화 후 메시지 분류
   * GitHub 이슈 정보를 로드한 후, 메시지 분류 단계로 이동
   */
  .addEdge("initialize-github-issue", "classify-message")

  /**
   * 엣지 3: 새 세션 생성 후 종료
   * 새 세션 메타데이터 생성이 완료되면 Manager 워크플로우 종료
   */
  .addEdge("create-new-session", END)

  /**
   * 엣지 4: Planner 시작 후 종료
   * Planner 에이전트가 시작되면 Manager의 역할은 완료되므로 종료
   * (Planner는 독립적으로 실행됨)
   */
  .addEdge("start-planner", END);

/**
 * 워크플로우 컴파일
 *
 * @description
 * StateGraph를 실행 가능한 형태로 컴파일합니다.
 * 컴파일 과정에서 다음을 수행합니다:
 * - 노드와 엣지의 유효성 검증
 * - 실행 순서 최적화
 * - 런타임 실행기 생성
 */
export const graph = workflow.compile();

// 그래프에 사람이 읽기 쉬운 이름 할당 (로깅 및 디버깅용)
graph.name = "Open SWE - Manager";
