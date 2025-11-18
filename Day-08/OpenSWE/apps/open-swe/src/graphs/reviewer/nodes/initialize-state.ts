/**
 * @file Reviewer 그래프의 상태 초기화 노드 (initialize-state.ts)
 * @description
 * Reviewer 그래프 실행 시작 시 필요한 초기 상태를 설정하는 노드입니다.
 *
 * 주요 기능:
 * 1. **샌드박스 연결**: Programmer와 동일한 샌드박스 세션 재사용
 * 2. **기본 브랜치 확인**: Git 기본 브랜치 이름 가져오기 (main, master 등)
 * 3. **변경 파일 목록**: git diff로 변경된 파일 목록 추출
 * 4. **리뷰 시작 메시지**: 숨겨진 시스템 메시지로 리뷰 시작 표시
 * 5. **코드베이스 트리 동기화**: Programmer에서 생성한 트리 정보 가져오기
 *
 * 워크플로우:
 * 1. Programmer가 작업 완료 후 Reviewer 그래프 호출
 * 2. 이 노드가 첫 번째로 실행되어 상태 초기화
 * 3. 샌드박스 연결 (Programmer와 동일한 세션)
 * 4. Git 기본 브랜치 이름 가져오기
 * 5. 변경된 파일 목록 추출 (git diff)
 * 6. 리뷰 시작 메시지 생성
 * 7. 초기화된 상태를 다음 노드로 전달
 *
 * 리뷰 시작 메시지:
 * - AIMessage + ToolMessage 쌍으로 생성
 * - hidden: true 플래그로 사용자에게 숨김
 * - review_started 도구 호출로 표시
 *
 * 다음 노드:
 * generate-review-actions (리뷰 액션 생성)
 */

// === Reviewer 타입 ===
import {
  ReviewerGraphState,  // Reviewer 그래프 상태 타입
  ReviewerGraphUpdate, // Reviewer 상태 업데이트 타입
} from "@openswe/shared/open-swe/reviewer/types";

// === 샌드박스 유틸리티 ===
import { getSandboxWithErrorHandling } from "../../../utils/sandbox.js"; // 샌드박스 연결 (에러 처리 포함)

// === Git 유틸리티 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로

// === 로깅 유틸리티 ===
import { createLogger, LogLevel } from "../../../utils/logger.js";

// === 공유 타입 ===
import { GraphConfig } from "@openswe/shared/open-swe/types"; // 그래프 설정

// === LangChain 메시지 타입 ===
import { AIMessage, ToolMessage } from "@langchain/core/messages";

// === 외부 라이브러리 ===
import { v4 as uuidv4 } from "uuid"; // 고유 ID 생성

// === 도구 정의 ===
import { createReviewStartedToolFields } from "@openswe/shared/open-swe/tools"; // 리뷰 시작 도구

// === 에러 처리 ===
import { getSandboxErrorFields } from "../../../utils/sandbox-error-fields.js"; // 샌드박스 에러 필드 추출

// === Daytona SDK ===
import { Sandbox } from "@daytonaio/sdk"; // 샌드박스 타입

// === Shell 실행기 ===
import { createShellExecutor } from "../../../utils/shell-executor/index.js"; // Shell 명령 실행기

/**
 * 로거 인스턴스 생성
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "InitializeStateNode");

/**
 * 리뷰 시작을 알리는 숨겨진 메시지 쌍을 생성합니다.
 *
 * @description
 * Reviewer 그래프 시작을 표시하기 위한 시스템 메시지를 생성합니다.
 * 사용자에게는 보이지 않지만 내부적으로 리뷰 워크플로우 추적에 사용됩니다.
 *
 * 생성되는 메시지:
 * 1. **AIMessage**: review_started 도구 호출 포함
 *    - content: 빈 문자열
 *    - hidden: true (사용자에게 숨김)
 *    - tool_calls: [review_started]
 *
 * 2. **ToolMessage**: review_started 도구 실행 결과
 *    - content: "리뷰가 시작되었습니다."
 *    - hidden: true (사용자에게 숨김)
 *    - tool_call_id: AIMessage의 도구 호출 ID와 매칭
 *
 * 용도:
 * - 리뷰 세션 시작 추적
 * - 내부 상태 관리
 * - 디버깅 및 로깅
 *
 * @returns {[AIMessage, ToolMessage]} 생성된 메시지 배열 (AI 메시지 + 도구 메시지)
 *
 * @example
 * const messages = createReviewStartedMessage();
 * // [AIMessage(hidden=true, tool_calls=[review_started]), ToolMessage(hidden=true, content="리뷰가 시작되었습니다.")]
 */
function createReviewStartedMessage() {
  const reviewStartedTool = createReviewStartedToolFields();
  const toolCallId = uuidv4();
  const reviewStartedToolCall = {
    id: toolCallId,
    name: reviewStartedTool.name,
    args: {
      review_started: true,
    },
  };

  return [
    // AIMessage: 도구 호출 메시지
    new AIMessage({
      id: uuidv4(),
      content: "",
      additional_kwargs: {
        hidden: true, // 사용자에게 숨김
      },
      tool_calls: [reviewStartedToolCall],
    }),
    // ToolMessage: 도구 실행 결과 메시지
    new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCallId,
      content: "리뷰가 시작되었습니다.",
      additional_kwargs: {
        hidden: true, // 사용자에게 숨김
      },
    }),
  ];
}

/**
 * 기본 브랜치와 비교하여 변경된 파일 목록을 가져옵니다.
 *
 * @description
 * git diff 명령을 사용하여 기본 브랜치 대비 현재 브랜치의 변경된 파일을 조회합니다.
 * Reviewer는 이 목록을 기반으로 어떤 파일을 검토할지 결정합니다.
 *
 * 실행 명령:
 * ```bash
 * git diff {baseBranchName} --name-only
 * ```
 *
 * 출력 예시:
 * ```
 * src/components/Button.tsx
 * src/utils/helpers.ts
 * README.md
 * ```
 *
 * 에러 처리:
 * - Git 명령 실패 시 에러 로깅 후 실패 메시지 반환
 * - 샌드박스 연결 에러 시 에러 필드 추출하여 로깅
 *
 * @param {Sandbox} sandbox - 샌드박스 인스턴스 (클라우드 모드) 또는 undefined (로컬 모드)
 * @param {string} baseBranchName - 기본 브랜치 이름 (예: "main", "master")
 * @param {string} repoRoot - 저장소 루트 경로
 * @param {GraphConfig} config - 그래프 설정
 * @returns {Promise<string>} 변경된 파일 목록 문자열 (줄바꿈으로 구분) 또는 에러 메시지
 *
 * @example
 * const changedFiles = await getChangedFiles(sandbox, "main", "/repo", config);
 * // "src/components/Button.tsx\nsrc/utils/helpers.ts\nREADME.md"
 */
async function getChangedFiles(
  sandbox: Sandbox,
  baseBranchName: string,
  repoRoot: string,
  config: GraphConfig,
): Promise<string> {
  try {
    const executor = createShellExecutor(config);
    const changedFilesRes = await executor.executeCommand({
      command: `git diff ${baseBranchName} --name-only`,
      workdir: repoRoot,
      timeout: 30,
      sandbox,
    });

    if (changedFilesRes.exitCode !== 0) {
      logger.error(`변경된 파일 목록을 가져오는 데 실패했습니다: ${changedFilesRes.result}`);
      return "변경된 파일 목록을 가져오는 데 실패했습니다.";
    }
    return changedFilesRes.result.trim();
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    logger.error("변경된 파일 목록을 가져오는 데 실패했습니다.", {
      ...(errorFields ? { errorFields } : { e }),
    });
    return "변경된 파일 목록을 가져오는 데 실패했습니다.";
  }
}

/**
 * Git 저장소의 기본 브랜치 이름을 가져옵니다.
 *
 * @description
 * git config init.defaultBranch 명령을 사용하여 저장소의 기본 브랜치 이름을 조회합니다.
 * 이 값은 변경된 파일을 비교할 기준 브랜치로 사용됩니다.
 *
 * 실행 명령:
 * ```bash
 * git config init.defaultBranch
 * ```
 *
 * 출력 예시:
 * ```
 * main
 * ```
 * 또는
 * ```
 * master
 * ```
 *
 * 폴백 전략:
 * 1. git config init.defaultBranch 실행
 * 2. 실패 시 빈 문자열 반환
 * 3. 호출자는 targetRepository.branch 사용
 *
 * 에러 처리:
 * - Git 명령 실패 시 에러 로깅 후 빈 문자열 반환
 * - 샌드박스 연결 에러 시 에러 필드 추출하여 로깅
 *
 * @param {Sandbox} sandbox - 샌드박스 인스턴스 (클라우드 모드) 또는 undefined (로컬 모드)
 * @param {string} repoRoot - 저장소 루트 경로
 * @param {GraphConfig} config - 그래프 설정
 * @returns {Promise<string>} 기본 브랜치 이름 또는 빈 문자열 (실패 시)
 *
 * @example
 * const baseBranch = await getBaseBranchName(sandbox, "/repo", config);
 * // "main" 또는 "master" 또는 "" (실패 시)
 */
async function getBaseBranchName(
  sandbox: Sandbox,
  repoRoot: string,
  config: GraphConfig,
): Promise<string> {
  try {
    const executor = createShellExecutor(config);
    const baseBranchNameRes = await executor.executeCommand({
      command: "git config init.defaultBranch",
      workdir: repoRoot,
      timeout: 30,
      sandbox,
    });

    if (baseBranchNameRes.exitCode !== 0) {
      logger.error("기본 브랜치 이름을 가져오는 데 실패했습니다.", {
        result: baseBranchNameRes.result,
      });
      return "";
    }
    return baseBranchNameRes.result.trim();
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    logger.error("기본 브랜치 이름을 가져오는 데 실패했습니다.", {
      ...(errorFields ? { errorFields } : { e }),
    });
    return "";
  }
}

/**
 * Reviewer 그래프의 상태를 초기화하는 노드입니다.
 *
 * @description
 * Reviewer 그래프가 시작될 때 첫 번째로 실행되어 필요한 모든 초기 정보를 수집합니다.
 *
 * 초기화 작업:
 * 1. **샌드박스 연결**: Programmer와 동일한 샌드박스 세션 재사용
 *    - Programmer가 작업한 코드 변경사항 접근
 *    - 코드베이스 트리 정보 가져오기
 *    - 의존성 설치 상태 확인
 *
 * 2. **기본 브랜치 확인**: 변경사항 비교 기준 브랜치 결정
 *    - 우선순위 1: state.targetRepository.branch (GitHub에서 제공)
 *    - 우선순위 2: git config init.defaultBranch (저장소 설정)
 *    - 실패 시: 빈 문자열 (변경 파일 목록 건너뛰기)
 *
 * 3. **변경 파일 목록 추출**: git diff로 검토 대상 파일 목록 생성
 *    - 기본 브랜치 대비 변경된 파일만 추출
 *    - Reviewer가 검토할 파일 범위 결정
 *
 * 4. **리뷰 시작 메시지 생성**: 내부 추적용 숨겨진 메시지
 *    - 리뷰 세션 시작 표시
 *    - 사용자에게는 보이지 않음 (hidden: true)
 *
 * 처리 흐름:
 * 1. 저장소 절대 경로 계산
 * 2. 샌드박스 연결 (Programmer 세션 재사용)
 * 3. 기본 브랜치 이름 결정 (targetRepository.branch 또는 git config)
 * 4. 변경 파일 목록 추출 (git diff)
 * 5. 리뷰 시작 메시지 생성
 * 6. 모든 정보를 ReviewerGraphUpdate로 반환
 *
 * 반환 상태:
 * - baseBranchName: 기본 브랜치 이름
 * - changedFiles: 변경된 파일 목록 (줄바꿈으로 구분)
 * - messages: 리뷰 시작 메시지 (AIMessage + ToolMessage)
 * - codebaseTree: 코드베이스 디렉토리 트리 (있는 경우)
 * - dependenciesInstalled: 의존성 설치 여부 (있는 경우)
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - targetRepository: 타겟 GitHub 저장소 정보
 *   - sandboxSessionId: Programmer와 공유하는 샌드박스 세션 ID
 *   - branchName: 작업 중인 브랜치 이름
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.localMode: 로컬 모드 여부
 *   - configurable.sandboxSettings: 샌드박스 설정
 *
 * @returns {Promise<ReviewerGraphUpdate>} 그래프 상태 업데이트
 *   - baseBranchName: 기본 브랜치 이름
 *   - changedFiles: 변경된 파일 목록
 *   - messages: [AIMessage, ToolMessage] (리뷰 시작)
 *   - codebaseTree: 코드베이스 트리 (선택적)
 *   - dependenciesInstalled: 의존성 설치 여부 (선택적)
 *
 * @example
 * // LangGraph에서 자동 호출
 * const update = await initializeState(state, config);
 * // update.baseBranchName === "main"
 * // update.changedFiles === "src/file1.ts\nsrc/file2.ts"
 * // update.messages.length === 2 (AIMessage + ToolMessage)
 */
export async function initializeState(
  state: ReviewerGraphState,
  config: GraphConfig,
): Promise<ReviewerGraphUpdate> {
  // === 1단계: 저장소 경로 계산 ===
  const repoRoot = getRepoAbsolutePath(state.targetRepository, config);
  logger.info("리뷰어 상태를 초기화합니다.");

  // === 2단계: 샌드박스 연결 및 코드베이스 정보 가져오기 ===
  // Programmer와 동일한 샌드박스 세션 재사용
  const { sandbox, codebaseTree, dependenciesInstalled } =
    await getSandboxWithErrorHandling(
      state.sandboxSessionId,
      state.targetRepository,
      state.branchName,
      config,
    );

  // === 3단계: 기본 브랜치 이름 결정 ===
  // 우선순위 1: GitHub에서 제공한 브랜치 (state.targetRepository.branch)
  // 우선순위 2: Git 저장소 설정 (git config init.defaultBranch)
  let baseBranchName = state.targetRepository.branch;
  if (!baseBranchName) {
    baseBranchName = await getBaseBranchName(sandbox, repoRoot, config);
  }

  // === 4단계: 변경 파일 목록 추출 ===
  // 기본 브랜치가 있는 경우에만 git diff 실행
  const changedFiles = baseBranchName
    ? await getChangedFiles(sandbox, baseBranchName, repoRoot, config)
    : "";

  logger.info("리뷰어 상태 가져오기를 완료했습니다.");

  // === 5단계: 상태 업데이트 반환 ===
  return {
    baseBranchName,
    changedFiles,
    messages: createReviewStartedMessage(), // 리뷰 시작 메시지 (hidden)
    ...(codebaseTree ? { codebaseTree } : {}), // 코드베이스 트리 (있는 경우)
    ...(dependenciesInstalled !== null ? { dependenciesInstalled } : {}), // 의존성 설치 여부 (있는 경우)
  };
}
