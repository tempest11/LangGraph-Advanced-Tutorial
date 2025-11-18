/**
 * @file Planner 시작 노드
 * @description
 * Manager 그래프의 마지막 노드로, 새로운 Planner 그래프 실행을 시작합니다.
 *
 * 주요 기능:
 * 1. Planner 스레드 ID 생성 또는 재사용
 * 2. 최근 사용자 요청 추출 (후속 작업 시)
 * 3. GitHub 설치 토큰 재생성 (만료 방지)
 * 4. LangGraph SDK를 통한 Planner 그래프 실행 생성
 * 5. Planner 세션 메타데이터 반환
 *
 * 실행 환경:
 * - 로컬 모드: LOCAL_MODE_HEADER를 사용하여 GitHub 없이 실행
 * - 클라우드 모드: GitHub 인증 토큰을 사용하여 원격 실행
 */

// UUID v4 생성 함수 - Planner 스레드 ID 생성용
import { v4 as uuidv4 } from "uuid";

// 그래프 설정 타입
import { GraphConfig } from "@openswe/shared/open-swe/types";

// 로컬 모드 감지 함수
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

// Manager 그래프 상태 및 업데이트 타입
import {
  ManagerGraphState,      // 현재 상태
  ManagerGraphUpdate,     // 반환할 업데이트
} from "@openswe/shared/open-swe/manager/types";

// LangGraph SDK 클라이언트 생성 함수
import { createLangGraphClient } from "../../../utils/langgraph-client.js";

// 시스템 상수
import {
  OPEN_SWE_STREAM_MODE,               // 스트림 모드 설정
  PLANNER_GRAPH_ID,                   // Planner 그래프 식별자
  LOCAL_MODE_HEADER,                  // 로컬 모드 헤더 키
  GITHUB_INSTALLATION_ID,             // GitHub 설치 ID 헤더 키
  GITHUB_INSTALLATION_TOKEN_COOKIE,   // GitHub 설치 토큰 쿠키 키
  GITHUB_PAT,                         // GitHub 개인 액세스 토큰 헤더 키
} from "@openswe/shared/constants";

// 로거 생성 함수
import { createLogger, LogLevel } from "../../../utils/logger.js";

// Git 브랜치 이름 생성 함수
import { getBranchName } from "../../../utils/github/git.js";

// Planner 그래프 업데이트 타입
import { PlannerGraphUpdate } from "@openswe/shared/open-swe/planner/types";

// HTTP 헤더 생성 함수
import { getDefaultHeaders } from "../../../utils/default-headers.js";

// 설정 가능한 필드 추출 함수
import { getCustomConfigurableFields } from "@openswe/shared/open-swe/utils/config";

// 최근 사용자 요청 추출 함수
import { getRecentUserRequest } from "../../../utils/user-request.js";

// LangGraph SDK 스트림 모드 타입
import { StreamMode } from "@langchain/langgraph-sdk";

// GitHub 설치 토큰 재생성 함수
import { regenerateInstallationToken } from "../../../utils/github/regenerate-token.js";

// GitHub 이슈 생성 여부 결정 함수
import { shouldCreateIssue } from "../../../utils/should-create-issue.js";

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "StartPlanner");

/**
 * 새로운 Planner 그래프 실행을 시작하는 노드 함수
 *
 * @description
 * Manager 워크플로우의 마지막 단계로, LangGraph SDK를 사용하여
 * Planner 그래프의 새 실행을 생성합니다. Planner는 작업 계획을 수립하고
 * Programmer로 전달하는 역할을 담당합니다.
 *
 * 주요 처리 흐름:
 * 1. Planner 스레드 ID 생성 또는 재사용
 * 2. 최근 사용자 요청 메시지 추출 (후속 작업 시)
 * 3. 실행 환경에 맞는 HTTP 헤더 설정
 * 4. GitHub 설치 토큰 재생성 (만료 방지)
 * 5. Planner 그래프 실행 생성 및 시작
 * 6. Planner 세션 메타데이터 반환
 *
 * @param {ManagerGraphState} state - 현재 Manager 그래프 상태
 *   - plannerSession: 기존 Planner 세션 정보 (재사용 시)
 *   - messages: 메시지 이력
 *   - githubIssueId: GitHub 이슈 번호
 *   - targetRepository: 대상 저장소 정보
 *   - taskPlan: 작업 계획
 *   - branchName: Git 브랜치 이름
 *   - autoAcceptPlan: 계획 자동 승인 여부
 *
 * @param {GraphConfig} config - 그래프 실행 설정
 *   - 환경 변수 및 인증 정보
 *   - 로컬 모드 플래그
 *
 * @returns {Promise<ManagerGraphUpdate>} Planner 세션 정보
 *   - plannerSession.threadId: Planner 스레드 ID
 *   - plannerSession.runId: Planner 실행 ID
 *
 * @throws {Error} Planner 시작 실패 시
 */
export async function startPlanner(
  state: ManagerGraphState,
  config: GraphConfig,
): Promise<ManagerGraphUpdate> {
  // === 1단계: Planner 스레드 ID 결정 ===
  // 기존 Planner 세션이 있으면 재사용, 없으면 새 UUID 생성
  // (재사용: 같은 스레드에서 계속 실행, 새 생성: 독립적인 새 실행)
  const plannerThreadId = state.plannerSession?.threadId ?? uuidv4();

  // === 2단계: 최근 사용자 요청 메시지 추출 ===
  // 후속 작업(followup)인 경우 가장 최근 사용자 요청을 Planner에 전달
  // returnFullMessage: true로 전체 메시지 객체 반환
  const followupMessage = getRecentUserRequest(state.messages, {
    returnFullMessage: true,  // 메시지 ID 및 메타데이터 포함
    config,                    // 설정 정보 전달
  });

  // === 3단계: 실행 환경에 맞는 HTTP 헤더 설정 ===
  const localMode = isLocalMode(config);

  // 로컬 모드인 경우: LOCAL_MODE_HEADER만 설정
  // 클라우드 모드인 경우: GitHub 인증 정보 포함된 전체 헤더
  const defaultHeaders = localMode
    ? { [LOCAL_MODE_HEADER]: "true" }
    : getDefaultHeaders(config);

  // === 4단계: GitHub 설치 토큰 재생성 (필요 시) ===
  // GitHub App 설치 토큰은 시간이 지나면 만료되므로 재생성 필요
  // 조건: 로컬 모드가 아니고, PAT(Personal Access Token)를 사용하지 않는 경우
  if (!localMode && !(GITHUB_PAT in defaultHeaders)) {
    logger.info("플래너 실행 전에 설치 토큰을 재생성합니다.");

    // GitHub API를 통해 새 설치 토큰 발급
    // 기존 설치 ID를 사용하여 토큰 갱신
    defaultHeaders[GITHUB_INSTALLATION_TOKEN_COOKIE] =
      await regenerateInstallationToken(defaultHeaders[GITHUB_INSTALLATION_ID]);

    logger.info("플래너 실행 전에 설치 토큰을 재생성했습니다.");
  }

  // === 5단계: Planner 그래프 실행 생성 ===
  try {
    // LangGraph SDK 클라이언트 생성
    // defaultHeaders를 사용하여 원격 LangGraph 서버와 인증
    const langGraphClient = createLangGraphClient({
      defaultHeaders,
    });

    // Planner 그래프의 초기 입력 데이터 구성
    const runInput: PlannerGraphUpdate = {
      // GitHub 이슈 ID - Planner가 이슈에서 요구사항 읽기용
      githubIssueId: state.githubIssueId,

      // 대상 저장소 정보 (owner, repo) - 저장소 복제 및 작업용
      targetRepository: state.targetRepository,

      // 기존 작업 계획 - 후속 작업 시 컨텍스트로 사용
      taskPlan: state.taskPlan,

      // Git 브랜치 이름 - 상태에 있으면 사용, 없으면 새로 생성
      branchName: state.branchName ?? getBranchName(config),

      // 계획 자동 승인 여부 - true면 사용자 확인 없이 바로 실행
      autoAcceptPlan: state.autoAcceptPlan,

      // 후속 메시지 또는 로컬 모드인 경우 메시지 추가
      // (최초 실행 시에는 GitHub 이슈에서 메시지를 읽으므로 불필요)
      ...(followupMessage || localMode ? { messages: [followupMessage] } : {}),

      // GitHub 이슈 생성을 하지 않는 모드에서 후속 메시지가 있으면
      // internalMessages로 전달 (GitHub에 노출되지 않는 내부 메시지)
      ...(!shouldCreateIssue(config) && followupMessage
        ? { internalMessages: [followupMessage] }
        : {}),
    };

    // LangGraph SDK를 통해 Planner 그래프 실행 생성
    const run = await langGraphClient.runs.create(
      plannerThreadId,        // 스레드 ID (기존 또는 새로 생성)
      PLANNER_GRAPH_ID,       // Planner 그래프 식별자
      {
        input: runInput,      // 초기 입력 데이터

        // 그래프 실행 설정
        config: {
          // 재귀 호출 제한 - Planner가 무한 루프에 빠지는 것 방지
          // 400회 이상 재귀 시 자동 종료
          recursion_limit: 400,

          // 런타임 설정 가능 필드
          configurable: {
            // 커스텀 설정 필드 (LLM 모델, 토큰 등)
            ...getCustomConfigurableFields(config),

            // 로컬 모드인 경우 헤더 추가
            ...(isLocalMode(config) && {
              [LOCAL_MODE_HEADER]: "true",
            }),
          },
        },

        // 스레드가 없으면 자동 생성
        ifNotExists: "create",

        // 스트림 재개 가능 - 중단된 실행을 나중에 재개할 수 있음
        streamResumable: true,

        // 스트림 모드 - 실행 중 상태 업데이트를 실시간으로 받을 수 있음
        streamMode: OPEN_SWE_STREAM_MODE as StreamMode[],
      },
    );

    // === 6단계: Planner 세션 메타데이터 반환 ===
    return {
      plannerSession: {
        threadId: plannerThreadId,  // 스레드 ID (추적 및 재개용)
        runId: run.run_id,           // 실행 ID (현재 실행 식별용)
      },
    };
  } catch (error) {
    // === 에러 처리 ===
    // Planner 시작 실패 시 상세한 에러 정보 로깅
    logger.error("플래너 시작에 실패했습니다.", {
      // Error 객체인 경우 구조화된 정보 추출
      ...(error instanceof Error
        ? {
            name: error.name,         // 에러 타입
            message: error.message,   // 에러 메시지
            stack: error.stack,       // 스택 트레이스
          }
        : {
            error,  // 기타 에러 객체 그대로 로깅
          }),
    });

    // 에러를 상위로 전파하여 Manager 워크플로우 중단
    throw error;
  }
}
