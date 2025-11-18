/**
 * @file 샌드박스 초기화 노드
 * @description
 * Planner와 Programmer 그래프에서 공유하는 샌드박스 환경 초기화 노드입니다.
 *
 * 주요 기능:
 * 1. 클라우드 샌드박스 또는 로컬 환경 초기화
 * 2. 기존 샌드박스 세션 재사용 (있을 경우)
 * 3. GitHub 리포지토리 클론 및 브랜치 체크아웃
 * 4. 코드베이스 트리 생성
 * 5. 커스텀 룰 로드
 *
 * 워크플로우 (클라우드 모드):
 * 1. 기존 sandboxSessionId가 있으면 재사용 시도
 *    - 성공: 최신 변경사항 pull → 코드베이스 트리 생성
 *    - 실패: 새 샌드박스 생성으로 진행
 * 2. 새 샌드박스 생성
 *    - Daytona SDK로 샌드박스 생성
 *    - 리포지토리 클론
 *    - 브랜치 체크아웃
 *    - 코드베이스 트리 생성
 *
 * 워크플로우 (로컬 모드):
 * - 샌드박스 생성/클론 단계 스킵
 * - 로컬 파일시스템에서 직접 작업
 * - 코드베이스 트리만 생성
 *
 * 이벤트 발행:
 * - 각 단계마다 CustomNodeEvent 발행 (pending → success/error/skipped)
 * - 프론트엔드에서 실시간 진행 상황 표시
 */

// === UUID 및 암호화 ===
import { v4 as uuidv4 } from "uuid"; // UUID v4 생성
import * as crypto from "crypto"; // 암호화 라이브러리 (로컬 모드 mock ID 생성용)

// === Git 관련 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 리포지토리 절대 경로 조회
import { cloneRepo, pullLatestChanges } from "../../utils/github/git.js"; // Git 클론/풀 유틸리티

// === GitHub 인증 ===
import { getGitHubTokensFromConfig } from "../../utils/github-tokens.js"; // GraphConfig에서 GitHub 토큰 추출

// === 타입 정의 ===
import {
  CustomRules, // 커스텀 코딩 룰 (CLAUDE.md 등)
  GraphConfig, // LangGraph 설정 객체
  TargetRepository, // 대상 리포지토리 정보
} from "@openswe/shared/open-swe/types";

// === 로깅 ===
import { createLogger, LogLevel } from "../../utils/logger.js"; // 구조화된 로거

// === 샌드박스 관련 ===
import { daytonaClient } from "../../utils/sandbox.js"; // Daytona 클라이언트 (클라우드 샌드박스)
import { Sandbox } from "@daytonaio/sdk"; // Daytona Sandbox 타입

// === 코드베이스 트리 ===
import {
  FAILED_TO_GENERATE_TREE_MESSAGE, // 트리 생성 실패 메시지
  getCodebaseTree, // 코드베이스 디렉토리 트리 생성
} from "../../utils/tree.js";

// === 상수 및 이벤트 ===
import { DO_NOT_RENDER_ID_PREFIX } from "@openswe/shared/constants"; // 렌더링 제외 메시지 ID 접두사
import {
  CustomNodeEvent, // 커스텀 노드 이벤트 타입
  INITIALIZE_NODE_ID, // 초기화 노드 ID
} from "@openswe/shared/open-swe/custom-node-events";
import { DEFAULT_SANDBOX_CREATE_PARAMS } from "../../constants.js"; // 샌드박스 기본 생성 파라미터

// === LangChain 메시지 ===
import { AIMessage, BaseMessage } from "@langchain/core/messages"; // 메시지 타입

// === 유틸리티 ===
import { getCustomRules } from "../../utils/custom-rules.js"; // 커스텀 룰 로드
import { withRetry } from "../../utils/retry.js"; // 재시도 래퍼

// === 로컬 모드 ===
import {
  isLocalMode, // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리 경로
} from "@openswe/shared/open-swe/local-mode";

// === 로거 인스턴스 ===
const logger = createLogger(LogLevel.INFO, "InitializeSandbox");

/**
 * 샌드박스 초기화 노드의 상태 타입
 *
 * @description
 * initializeSandbox 노드가 사용하는 그래프 상태의 일부분입니다.
 *
 * @property {TargetRepository} targetRepository - 대상 GitHub 리포지토리 정보
 * @property {string} branchName - 작업할 브랜치 이름
 * @property {string} [sandboxSessionId] - 기존 샌드박스 세션 ID (재사용용)
 * @property {string} [codebaseTree] - 생성된 코드베이스 디렉토리 트리
 * @property {BaseMessage[]} [messages] - 그래프 메시지 히스토리
 * @property {boolean} [dependenciesInstalled] - 의존성 설치 완료 여부
 * @property {CustomRules} [customRules] - 커스텀 코딩 룰 (CLAUDE.md 등)
 */
type InitializeSandboxState = {
  targetRepository: TargetRepository;
  branchName: string;
  sandboxSessionId?: string;
  codebaseTree?: string;
  messages?: BaseMessage[];
  dependenciesInstalled?: boolean;
  customRules?: CustomRules;
};

/**
 * 샌드박스 환경 초기화 노드
 *
 * @description
 * Planner와 Programmer 그래프에서 공유하는 샌드박스 초기화 노드입니다.
 * 클라우드 샌드박스 또는 로컬 환경을 설정하고, 코드베이스 트리를 생성합니다.
 *
 * 처리 흐름:
 * 1. 로컬 모드 확인 → 로컬이면 initializeSandboxLocal로 위임
 * 2. GitHub 토큰 가져오기
 * 3. 기존 샌드박스가 있으면 재사용 시도
 *    - 성공: 최신 변경사항 pull → 코드베이스 트리 생성
 *    - 실패: 새 샌드박스 생성으로 진행
 * 4. 새 샌드박스 생성
 *    - Daytona SDK로 생성
 *    - 리포지토리 클론
 *    - 브랜치 체크아웃
 *    - 코드베이스 트리 생성
 * 5. 커스텀 룰 로드
 *
 * 이벤트 발행:
 * - 각 단계마다 CustomNodeEvent를 발행하여 프론트엔드에 진행 상황 전달
 * - 상태: pending → success/error/skipped
 *
 * @param {InitializeSandboxState} state - 그래프 상태 (targetRepository, branchName 등)
 * @param {GraphConfig} config - LangGraph 설정 (인증, writer 등)
 * @returns {Promise<Partial<InitializeSandboxState>>} 업데이트된 상태
 *   - sandboxSessionId: 생성/재사용된 샌드박스 ID
 *   - codebaseTree: 코드베이스 디렉토리 트리
 *   - messages: CustomNodeEvent를 포함한 메시지
 *   - customRules: 로드된 커스텀 룰
 *   - branchName: 체크아웃된 브랜치 이름
 * @throws {Error} 샌드박스 생성 실패 또는 리포지토리 클론 실패 시
 *
 * @example
 * // Planner 그래프에서 사용
 * const result = await initializeSandbox(state, config);
 * // result.sandboxSessionId: "abc-123-def"
 * // result.codebaseTree: "root/\n  src/\n    ..."
 */
export async function initializeSandbox(
  state: InitializeSandboxState,
  config: GraphConfig,
): Promise<Partial<InitializeSandboxState>> {
  // === 상태에서 필요한 값 추출 ===
  const { sandboxSessionId, targetRepository, branchName } = state;
  const absoluteRepoDir = getRepoAbsolutePath(targetRepository);
  const repoName = `${targetRepository.owner}/${targetRepository.repo}`;

  // === 이벤트 수집 배열 ===
  const events: CustomNodeEvent[] = [];

  /**
   * 단계별 이벤트 발행 헬퍼 함수
   *
   * @description
   * CustomNodeEvent를 생성하고 config.writer를 통해 프론트엔드로 전송합니다.
   * 이벤트는 events 배열에도 저장되어 최종 메시지에 포함됩니다.
   *
   * @param {CustomNodeEvent} base - 기본 이벤트 정보 (nodeId, actionId, action 등)
   * @param {"pending" | "success" | "error" | "skipped"} status - 이벤트 상태
   * @param {string} [error] - 에러 메시지 (status가 "error"일 때)
   */
  const emitStepEvent = (
    base: CustomNodeEvent,
    status: "pending" | "success" | "error" | "skipped",
    error?: string,
  ) => {
    const event = {
      ...base,
      createdAt: new Date().toISOString(),
      data: {
        ...base.data,
        status,
        ...(error ? { error } : {}),
        runId: config.configurable?.run_id ?? "",
      },
    };
    events.push(event);
    try {
      config.writer?.(event);
    } catch (err) {
      logger.error("Failed to emit custom event", { event, err });
    }
  };

  /**
   * 수집된 이벤트들을 메시지로 변환하는 헬퍼 함수
   *
   * @description
   * events 배열의 모든 이벤트를 additional_kwargs.customNodeEvents에 담은
   * AIMessage를 생성합니다. 이 메시지는 hidden=true로 설정되어 UI에 직접
   * 표시되지 않고, 프론트엔드의 이벤트 핸들러가 처리합니다.
   *
   * @returns {BaseMessage[]} CustomNodeEvent를 포함한 메시지 배열
   */
  const createEventsMessage = () => [
    new AIMessage({
      id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
      content: "Initialize sandbox",
      additional_kwargs: {
        hidden: true,
        customNodeEvents: events,
      },
    }),
  ];

  // === 1단계: 로컬 모드 확인 ===
  // 로컬 모드인 경우 샌드박스 생성/클론을 스킵하고 로컬 파일시스템 사용
  if (isLocalMode(config)) {
    return initializeSandboxLocal(
      state,
      config,
      emitStepEvent,
      createEventsMessage,
    );
  }

  // === 2단계: GitHub 토큰 가져오기 ===
  const { githubInstallationToken } = getGitHubTokensFromConfig(config);

  // === 3단계: 기존 샌드박스가 없는 경우 이벤트 스킵 ===
  // sandboxSessionId가 없으면 새로 생성해야 하므로 재사용/풀 이벤트는 스킵
  if (!sandboxSessionId) {
    emitStepEvent(
      {
        nodeId: INITIALIZE_NODE_ID,
        createdAt: new Date().toISOString(),
        actionId: uuidv4(),
        action: "Resuming sandbox",
        data: {
          status: "skipped",
          branch: branchName,
          repo: repoName,
        },
      },
      "skipped",
    );
    emitStepEvent(
      {
        nodeId: INITIALIZE_NODE_ID,
        createdAt: new Date().toISOString(),
        actionId: uuidv4(),
        action: "Pulling latest changes",
        data: {
          status: "skipped",
          branch: branchName,
          repo: repoName,
        },
      },
      "skipped",
    );
  }

  // === 4단계: 기존 샌드박스 재사용 시도 ===
  if (sandboxSessionId) {
    // === 4-1. 샌드박스 재개 이벤트 발행 ===
    const resumeSandboxActionId = uuidv4();
    const baseResumeSandboxAction: CustomNodeEvent = {
      nodeId: INITIALIZE_NODE_ID,
      createdAt: new Date().toISOString(),
      actionId: resumeSandboxActionId,
      action: "Resuming sandbox",
      data: {
        status: "pending",
        sandboxSessionId,
        branch: branchName,
        repo: repoName,
      },
    };
    emitStepEvent(baseResumeSandboxAction, "pending");

    try {
      // === 4-2. Daytona에서 기존 샌드박스 조회 ===
      const existingSandbox = await daytonaClient().get(sandboxSessionId);
      emitStepEvent(baseResumeSandboxAction, "success");

      // === 4-3. 최신 변경사항 pull ===
      const pullLatestChangesActionId = uuidv4();
      const basePullLatestChangesAction: CustomNodeEvent = {
        nodeId: INITIALIZE_NODE_ID,
        createdAt: new Date().toISOString(),
        actionId: pullLatestChangesActionId,
        action: "Pulling latest changes",
        data: {
          status: "pending",
          sandboxSessionId,
          branch: branchName,
          repo: repoName,
        },
      };
      emitStepEvent(basePullLatestChangesAction, "pending");

      const pullChangesRes = await pullLatestChanges(
        absoluteRepoDir,
        existingSandbox,
        {
          githubInstallationToken,
        },
      );
      if (!pullChangesRes) {
        emitStepEvent(basePullLatestChangesAction, "skipped");
        throw new Error("Failed to pull latest changes.");
      }
      emitStepEvent(basePullLatestChangesAction, "success");

      // === 4-4. 코드베이스 트리 생성 ===
      const generateCodebaseTreeActionId = uuidv4();
      const baseGenerateCodebaseTreeAction: CustomNodeEvent = {
        nodeId: INITIALIZE_NODE_ID,
        createdAt: new Date().toISOString(),
        actionId: generateCodebaseTreeActionId,
        action: "Generating codebase tree",
        data: {
          status: "pending",
          sandboxSessionId,
          branch: branchName,
          repo: repoName,
        },
      };
      emitStepEvent(baseGenerateCodebaseTreeAction, "pending");
      try {
        const codebaseTree = await getCodebaseTree(config, existingSandbox.id);
        if (codebaseTree === FAILED_TO_GENERATE_TREE_MESSAGE) {
          emitStepEvent(
            baseGenerateCodebaseTreeAction,
            "error",
            FAILED_TO_GENERATE_TREE_MESSAGE,
          );
        } else {
          emitStepEvent(baseGenerateCodebaseTreeAction, "success");
        }

        // === 4-5. 기존 샌드박스 재사용 성공 - 상태 반환 ===
        return {
          sandboxSessionId: existingSandbox.id,
          codebaseTree,
          messages: createEventsMessage(),
          customRules: await getCustomRules(
            existingSandbox,
            absoluteRepoDir,
            config,
          ),
        };
      } catch {
        // 트리 생성 실패해도 계속 진행 (트리 없이 작업 가능)
        emitStepEvent(
          baseGenerateCodebaseTreeAction,
          "error",
          FAILED_TO_GENERATE_TREE_MESSAGE,
        );
        return {
          sandboxSessionId: existingSandbox.id,
          codebaseTree: FAILED_TO_GENERATE_TREE_MESSAGE,
          messages: createEventsMessage(),
          customRules: await getCustomRules(
            existingSandbox,
            absoluteRepoDir,
            config,
          ),
        };
      }
    } catch {
      // 기존 샌드박스 재사용 실패 - 새로 생성으로 진행
      emitStepEvent(
        baseResumeSandboxAction,
        "skipped",
        "Unable to resume sandbox. A new environment will be created.",
      );
    }
  }

  // === 5단계: 새 샌드박스 생성 ===
  // 기존 샌드박스가 없거나 재사용 실패 시 새로 생성
  const createSandboxActionId = uuidv4();
  const baseCreateSandboxAction: CustomNodeEvent = {
    nodeId: INITIALIZE_NODE_ID,
    createdAt: new Date().toISOString(),
    actionId: createSandboxActionId,
    action: "Creating sandbox",
    data: {
      status: "pending",
      sandboxSessionId: null,
      branch: branchName,
      repo: repoName,
    },
  };

  emitStepEvent(baseCreateSandboxAction, "pending");
  let sandbox: Sandbox;
  try {
    // Daytona SDK로 새 샌드박스 생성
    sandbox = await daytonaClient().create(DEFAULT_SANDBOX_CREATE_PARAMS);
    emitStepEvent(baseCreateSandboxAction, "success");
  } catch (e) {
    logger.error("Failed to create sandbox environment", { e });
    emitStepEvent(
      baseCreateSandboxAction,
      "error",
      "Failed to create sandbox environment. Please try again later.",
    );
    throw new Error("Failed to create sandbox environment.");
  }

  // === 6단계: 리포지토리 클론 ===
  const cloneRepoActionId = uuidv4();
  const baseCloneRepoAction: CustomNodeEvent = {
    nodeId: INITIALIZE_NODE_ID,
    createdAt: new Date().toISOString(),
    actionId: cloneRepoActionId,
    action: "Cloning repository",
    data: {
      status: "pending",
      sandboxSessionId: sandbox.id,
      branch: branchName,
      repo: repoName,
    },
  };
  emitStepEvent(baseCloneRepoAction, "pending");

  // 재시도 로직 (큰 리포지토리는 타임아웃 가능)
  // retries: 0이므로 현재는 재시도 안 함 (필요 시 설정 변경 가능)
  const cloneRepoRes = await withRetry(
    async () => {
      return await cloneRepo(sandbox, targetRepository, {
        githubInstallationToken,
        stateBranchName: branchName,
      });
    },
    { retries: 0, delay: 0 },
  );

  // 클론 실패 처리 (단, "repository already exists"는 무시)
  if (
    cloneRepoRes instanceof Error &&
    !cloneRepoRes.message.includes("repository already exists")
  ) {
    emitStepEvent(
      baseCloneRepoAction,
      "error",
      "Failed to clone repository. Please check your repo URL and permissions.",
    );
    const errorFields = {
      ...(cloneRepoRes instanceof Error
        ? {
            name: cloneRepoRes.name,
            message: cloneRepoRes.message,
            stack: cloneRepoRes.stack,
          }
        : cloneRepoRes),
    };
    logger.error("Cloning repository failed", errorFields);
    throw new Error("Failed to clone repository.");
  }

  // cloneRepo가 새 브랜치 이름을 반환하면 사용, 아니면 기존 branchName 사용
  const newBranchName =
    typeof cloneRepoRes === "string" ? cloneRepoRes : branchName;
  emitStepEvent(baseCloneRepoAction, "success");

  // === 7단계: 브랜치 체크아웃 ===
  // cloneRepo가 이미 체크아웃까지 수행하므로 success로 바로 처리
  const checkoutBranchActionId = uuidv4();
  const baseCheckoutBranchAction: CustomNodeEvent = {
    nodeId: INITIALIZE_NODE_ID,
    createdAt: new Date().toISOString(),
    actionId: checkoutBranchActionId,
    action: "Checking out branch",
    data: {
      status: "pending",
      sandboxSessionId: sandbox.id,
      branch: newBranchName,
      repo: repoName,
    },
  };
  emitStepEvent(baseCheckoutBranchAction, "success");

  // === 8단계: 코드베이스 트리 생성 ===
  const generateCodebaseTreeActionId = uuidv4();
  const baseGenerateCodebaseTreeAction: CustomNodeEvent = {
    nodeId: INITIALIZE_NODE_ID,
    createdAt: new Date().toISOString(),
    actionId: generateCodebaseTreeActionId,
    action: "Generating codebase tree",
    data: {
      status: "pending",
      sandboxSessionId: sandbox.id,
      branch: newBranchName,
      repo: repoName,
    },
  };
  emitStepEvent(baseGenerateCodebaseTreeAction, "pending");
  let codebaseTree: string | undefined;
  try {
    codebaseTree = await getCodebaseTree(config, sandbox.id);
    emitStepEvent(baseGenerateCodebaseTreeAction, "success");
  } catch (_) {
    // 트리 생성 실패해도 계속 진행 (트리 없이도 작업 가능)
    emitStepEvent(
      baseGenerateCodebaseTreeAction,
      "error",
      "Failed to generate codebase tree.",
    );
  }

  // === 9단계: 최종 상태 반환 ===
  return {
    sandboxSessionId: sandbox.id, // 생성된 샌드박스 ID
    targetRepository, // 대상 리포지토리 정보
    codebaseTree, // 생성된 코드베이스 트리
    messages: createEventsMessage(), // CustomNodeEvent를 포함한 메시지
    dependenciesInstalled: false, // 아직 의존성 미설치
    customRules: await getCustomRules(sandbox, absoluteRepoDir, config), // 커스텀 룰 로드
    branchName: newBranchName, // 체크아웃된 브랜치 이름
  };
}

/**
 * 로컬 모드 샌드박스 초기화 함수
 *
 * @description
 * 로컬 파일시스템에서 직접 작업하는 경우의 초기화 로직입니다.
 * 클라우드 샌드박스 생성/리포지토리 클론을 스킵하고, 코드베이스 트리만 생성합니다.
 *
 * 로컬 모드는 다음과 같은 경우 사용됩니다:
 * - 개발자가 자신의 로컬 머신에서 직접 테스트
 * - Daytona 샌드박스 없이 작업하고 싶을 때
 * - 네트워크 문제로 클라우드 샌드박스 사용 불가 시
 *
 * 처리 흐름:
 * 1. 샌드박스 생성 이벤트 스킵
 * 2. 리포지토리 클론 이벤트 스킵
 * 3. 브랜치 체크아웃 이벤트 스킵
 * 4. 로컬 파일시스템에서 코드베이스 트리 생성
 * 5. Mock 샌드박스 ID 생성 (일관성 유지용)
 *
 * @param {InitializeSandboxState} state - 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @param {Function} emitStepEvent - 이벤트 발행 헬퍼 함수
 * @param {Function} createEventsMessage - 이벤트 메시지 생성 헬퍼 함수
 * @returns {Promise<Partial<InitializeSandboxState>>} 업데이트된 상태
 *   - sandboxSessionId: Mock ID (로컬 모드임을 나타냄)
 *   - codebaseTree: 로컬 파일시스템에서 생성된 트리
 *   - messages: CustomNodeEvent를 포함한 메시지
 *   - customRules: 로컬에서 로드한 커스텀 룰
 *
 * @example
 * // 로컬 모드 활성화 시 자동으로 호출됨
 * if (isLocalMode(config)) {
 *   return initializeSandboxLocal(state, config, emitStepEvent, createEventsMessage);
 * }
 */
async function initializeSandboxLocal(
  state: InitializeSandboxState,
  config: GraphConfig,
  emitStepEvent: (
    base: CustomNodeEvent,
    status: "pending" | "success" | "error" | "skipped",
    error?: string,
  ) => void,
  createEventsMessage: () => BaseMessage[],
): Promise<Partial<InitializeSandboxState>> {
  const { targetRepository, branchName } = state;
  const absoluteRepoDir = getLocalWorkingDirectory(); // 로컬 작업 디렉토리 경로
  const repoName = `${targetRepository.owner}/${targetRepository.repo}`;

  // === 1단계: 샌드박스 생성 스킵 ===
  // 로컬 모드에서는 샌드박스가 필요 없음
  emitStepEvent(
    {
      nodeId: INITIALIZE_NODE_ID,
      createdAt: new Date().toISOString(),
      actionId: uuidv4(),
      action: "Creating sandbox",
      data: {
        status: "skipped",
        sandboxSessionId: null,
        branch: branchName,
        repo: repoName,
      },
    },
    "skipped",
  );

  // === 2단계: 리포지토리 클론 스킵 ===
  // 로컬에 이미 리포지토리가 있다고 가정
  emitStepEvent(
    {
      nodeId: INITIALIZE_NODE_ID,
      createdAt: new Date().toISOString(),
      actionId: uuidv4(),
      action: "Cloning repository",
      data: {
        status: "skipped",
        sandboxSessionId: null,
        branch: branchName,
        repo: repoName,
      },
    },
    "skipped",
  );

  // === 3단계: 브랜치 체크아웃 스킵 ===
  // 로컬에서 수동으로 브랜치를 체크아웃했다고 가정
  emitStepEvent(
    {
      nodeId: INITIALIZE_NODE_ID,
      createdAt: new Date().toISOString(),
      actionId: uuidv4(),
      action: "Checking out branch",
      data: {
        status: "skipped",
        sandboxSessionId: null,
        branch: branchName,
        repo: repoName,
      },
    },
    "skipped",
  );

  // === 4단계: 코드베이스 트리 생성 ===
  // 로컬 파일시스템을 읽어서 디렉토리 트리 생성
  const generateCodebaseTreeActionId = uuidv4();
  const baseGenerateCodebaseTreeAction: CustomNodeEvent = {
    nodeId: INITIALIZE_NODE_ID,
    createdAt: new Date().toISOString(),
    actionId: generateCodebaseTreeActionId,
    action: "Generating codebase tree",
    data: {
      status: "pending",
      sandboxSessionId: null,
      branch: branchName,
      repo: repoName,
    },
  };
  emitStepEvent(baseGenerateCodebaseTreeAction, "pending");

  let codebaseTree = undefined;
  try {
    // sandboxId를 undefined로 전달하면 로컬 모드로 동작
    codebaseTree = await getCodebaseTree(config, undefined, targetRepository);
    emitStepEvent(baseGenerateCodebaseTreeAction, "success");
  } catch (_) {
    // 트리 생성 실패해도 계속 진행
    emitStepEvent(
      baseGenerateCodebaseTreeAction,
      "error",
      "Failed to generate codebase tree.",
    );
  }

  // === 5단계: Mock 샌드박스 ID 생성 ===
  // 일관성을 위해 "local-" 접두사가 붙은 고유 ID 생성
  const mockSandboxId = `local-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;

  // === 6단계: 최종 상태 반환 ===
  return {
    sandboxSessionId: mockSandboxId, // Mock ID (로컬 모드)
    targetRepository, // 대상 리포지토리 정보
    codebaseTree, // 로컬 파일시스템에서 생성된 트리
    messages: [...(state.messages || []), ...createEventsMessage()], // 기존 메시지 유지 + 새 이벤트
    dependenciesInstalled: false, // 아직 의존성 미설치
    customRules: await getCustomRules(null as any, absoluteRepoDir, config), // 로컬 커스텀 룰 로드
    branchName: branchName, // 브랜치 이름
  };
}
