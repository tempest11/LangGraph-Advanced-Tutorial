/**
 * @file GitHub 이슈 초기화 노드
 * @description
 * Manager 그래프의 첫 번째 실행 노드로, GitHub 이슈에서 작업 정보를 로드합니다.
 *
 * 주요 기능:
 * 1. GitHub API를 통해 이슈 정보 조회
 * 2. 이슈 본문에서 작업 계획(task plan) 추출
 * 3. 이슈 내용을 HumanMessage로 변환하여 상태에 저장
 * 4. 로컬 모드 지원 (CLI에서 직접 입력된 경우)
 *
 * 실행 시나리오:
 * - 시나리오 1: 최초 이슈 로드 → 이슈에서 메시지 추출
 * - 시나리오 2: 기존 세션 재개 → 업데이트된 작업 계획만 로드
 * - 시나리오 3: 로컬 모드 → GitHub 없이 즉시 반환
 */

// UUID v4 생성 함수 - 메시지에 고유 ID 할당용
import { v4 as uuidv4 } from "uuid";

// 그래프 설정 타입 (런타임 환경 정보 포함)
import { GraphConfig } from "@openswe/shared/open-swe/types";

// Manager 그래프의 상태 타입 및 업데이트 타입
import {
  ManagerGraphState,      // 현재 그래프 상태 (읽기 전용)
  ManagerGraphUpdate,     // 상태 업데이트 객체 (반환 타입)
} from "@openswe/shared/open-swe/manager/types";

// GitHub 인증 토큰 추출 유틸리티
import { getGitHubTokensFromConfig } from "../../../utils/github-tokens.js";

// LangChain 메시지 타입 (사용자 입력을 나타냄)
import { HumanMessage, isHumanMessage } from "@langchain/core/messages";

// GitHub REST API 호출 함수 (이슈 조회용)
import { getIssue } from "../../../utils/github/api.js";

// 이슈 본문에서 작업 목록(task plan) 파싱 함수
import { extractTasksFromIssueContent } from "../../../utils/github/issue-task.js";

// 이슈 객체를 LangChain 메시지 형식으로 변환하는 함수
import { getMessageContentFromIssue } from "../../../utils/github/issue-messages.js";

// 로컬 모드 감지 함수 (CLI에서 실행 중인지 확인)
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

/**
 * GitHub 이슈를 초기화하고 작업 정보를 로드하는 노드 함수
 *
 * @description
 * Manager 워크플로우의 첫 번째 단계로, GitHub 이슈에서 작업 요청 정보를 가져옵니다.
 * 이 함수는 다음 세 가지 시나리오를 처리합니다:
 *
 * 1. **로컬 모드**: GitHub 없이 CLI에서 직접 입력된 경우, 즉시 반환
 * 2. **기존 메시지 존재**: 이미 HumanMessage가 상태에 있으면 업데이트된 작업 계획만 로드
 * 3. **최초 실행**: GitHub 이슈에서 전체 정보를 가져와 HumanMessage 생성
 *
 * @param {ManagerGraphState} state - 현재 Manager 그래프의 상태
 *   - messages: 이전에 처리된 메시지 목록
 *   - githubIssueId: GitHub 이슈 번호
 *   - targetRepository: 대상 저장소 정보 (owner, repo)
 *   - taskPlan: 기존 작업 계획 (있을 경우)
 *
 * @param {GraphConfig} config - 그래프 실행 설정
 *   - 환경 변수 (GitHub 토큰 등)
 *   - 로컬 모드 플래그
 *   - 기타 런타임 설정
 *
 * @returns {Promise<ManagerGraphUpdate>} 상태 업데이트 객체
 *   - messages: 새로 생성된 HumanMessage 배열 (최초 실행 시)
 *   - taskPlan: 이슈에서 추출한 작업 계획 (존재할 경우)
 *
 * @throws {Error} GitHub 이슈 ID 또는 대상 저장소가 없을 때
 * @throws {Error} GitHub 이슈를 찾을 수 없을 때
 */
export async function initializeGithubIssue(
  state: ManagerGraphState,
  config: GraphConfig,
): Promise<ManagerGraphUpdate> {
  // === 시나리오 1: 로컬 모드 처리 ===
  // CLI에서 실행 중이면 GitHub 이슈가 필요 없음
  if (isLocalMode(config)) {
    // 로컬 모드에서는 사용자가 직접 입력한 메시지가 이미 상태에 있음
    // GitHub API 호출을 건너뛰고 빈 업데이트 반환
    return {};
  }

  // GitHub 설정에서 설치 토큰 추출
  // 이 토큰은 GitHub App 인증에 사용되며, 저장소 접근 권한을 제공함
  const { githubInstallationToken } = getGitHubTokensFromConfig(config);

  // 작업 계획 변수 초기화 (기존 계획이 있으면 사용, 없으면 undefined)
  let taskPlan = state.taskPlan;

  // === 시나리오 2: 기존 메시지가 있는 경우 (세션 재개) ===
  // 상태에 이미 메시지가 있고, 그 중 하나라도 HumanMessage면 재개 시나리오
  if (state.messages.length && state.messages.some(isHumanMessage)) {
    // 이미 작업이 진행 중인 경우, 이슈에서 업데이트된 작업 계획만 가져옴
    // (사용자가 이슈 본문을 수정했을 수 있음)

    // GitHub 이슈 ID가 있는지 확인
    if (state.githubIssueId) {
      // GitHub API를 통해 최신 이슈 정보 조회
      const issue = await getIssue({
        owner: state.targetRepository.owner,      // 저장소 소유자
        repo: state.targetRepository.repo,        // 저장소 이름
        issueNumber: state.githubIssueId,         // 이슈 번호
        githubInstallationToken,                  // 인증 토큰
      });

      // 이슈가 삭제되었거나 접근 권한이 없는 경우 에러
      if (!issue) {
        throw new Error("이슈를 찾을 수 없습니다.");
      }

      // 이슈 본문(body)에서 작업 계획 추출 시도
      if (issue.body) {
        // 이슈 본문을 파싱하여 체크박스 형태의 작업 목록 추출
        const extractedTaskPlan = extractTasksFromIssueContent(issue.body);

        // 추출된 작업 계획이 있으면 업데이트
        if (extractedTaskPlan) {
          taskPlan = extractedTaskPlan;
        }
      }
    }

    // 업데이트된 작업 계획만 반환 (메시지는 이미 있으므로 추가하지 않음)
    return {
      taskPlan,
    };
  }

  // === 시나리오 3: 최초 실행 (이슈에서 메시지 로드) ===

  // 필수 정보 검증: GitHub 이슈 ID 확인
  if (!state.githubIssueId) {
    throw new Error("GitHub 이슈 ID가 제공되지 않았습니다.");
  }

  // 필수 정보 검증: 대상 저장소 확인
  if (!state.targetRepository) {
    throw new Error("대상 저장소가 제공되지 않았습니다.");
  }

  // GitHub API를 통해 이슈 전체 정보 조회
  const issue = await getIssue({
    owner: state.targetRepository.owner,
    repo: state.targetRepository.repo,
    issueNumber: state.githubIssueId,
    githubInstallationToken,
  });

  // 이슈가 존재하지 않으면 에러
  if (!issue) {
    throw new Error("이슈를 찾을 수 없습니다.");
  }

  // 이슈 본문에서 작업 계획 추출
  if (issue.body) {
    // 마크다운 체크박스 형태의 작업 목록을 파싱
    // 예: - [ ] Task 1, - [x] Task 2 (완료됨)
    const extractedTaskPlan = extractTasksFromIssueContent(issue.body);

    // 추출된 작업 계획이 있으면 저장
    if (extractedTaskPlan) {
      taskPlan = extractedTaskPlan;
    }
  }

  // 이슈 내용을 LangChain HumanMessage 형식으로 변환
  // 이 메시지는 LLM에게 전달되어 작업 요청으로 해석됨
  const newMessage = new HumanMessage({
    // 메시지에 고유 UUID 할당 (추적 및 디버깅용)
    id: uuidv4(),

    // 이슈 제목과 본문을 결합한 텍스트 콘텐츠
    content: getMessageContentFromIssue(issue),

    // 추가 메타데이터 저장
    additional_kwargs: {
      githubIssueId: state.githubIssueId,  // 원본 이슈 ID (추적용)
      isOriginalIssue: true,               // 최초 이슈임을 표시
    },
  });

  // 새 메시지와 작업 계획을 상태에 추가하여 반환
  return {
    messages: [newMessage],  // 새로 생성된 HumanMessage
    taskPlan,                // 추출된 작업 계획 (있을 경우)
  };
}
