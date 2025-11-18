/**
 * @file Daytona 샌드박스 관리 유틸리티
 * @description
 * 격리된 개발 환경(샌드박스)을 생성, 관리, 복구하는 핵심 유틸리티입니다.
 * Daytona SDK를 래핑하여 에러 처리, 재시도 로직, 로컬 모드 지원을 제공합니다.
 *
 * 주요 기능:
 * 1. 샌드박스 생성/시작/중지/삭제
 * 2. 상태 전환 관리 (stopped → started, archived → started)
 * 3. 자동 재시도 로직 (최대 3회)
 * 4. Git 저장소 자동 복제
 * 5. 코드베이스 트리 생성
 * 6. 로컬 모드 Mock 지원
 *
 * 샌드박스 상태:
 * - started: 실행 중 (사용 가능)
 * - stopped: 중지됨 (재시작 가능)
 * - archived: 보관됨 (재시작 가능)
 * - 기타: 복구 불가 (재생성 필요)
 *
 * 사용 위치:
 * - initialize-sandbox.ts: 그래프 시작 시 샌드박스 준비
 * - take-action.ts: 도구 실행 환경 확보
 *
 * @example
 * const { sandbox, codebaseTree } = await getSandboxWithErrorHandling(
 *   "sandbox-123",
 *   targetRepo,
 *   "main",
 *   config
 * );
 */

// === Daytona SDK ===
import { Daytona, Sandbox, SandboxState } from "@daytonaio/sdk";

// === 로깅 유틸리티 ===
import { createLogger, LogLevel } from "./logger.js";

// === 타입 정의 ===
import { GraphConfig, TargetRepository } from "@openswe/shared/open-swe/types";

// === 샌드박스 설정 ===
import { DEFAULT_SANDBOX_CREATE_PARAMS } from "../constants.js";

// === GitHub 통합 ===
import { getGitHubTokensFromConfig } from "./github-tokens.js";
import { cloneRepo } from "./github/git.js";

// === 코드베이스 트리 ===
import { FAILED_TO_GENERATE_TREE_MESSAGE, getCodebaseTree } from "./tree.js";

// === 로컬 모드 ===
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

const logger = createLogger(LogLevel.INFO, "Sandbox");

/**
 * Daytona 클라이언트의 싱글톤 인스턴스
 * 여러 호출 간 연결을 재사용하여 성능을 최적화합니다.
 */
let daytonaInstance: Daytona | null = null;

/**
 * 공유 Daytona 클라이언트 인스턴스를 반환합니다 (싱글톤 패턴).
 *
 * @description
 * Daytona SDK 클라이언트를 싱글톤으로 관리하여 불필요한 연결 생성을 방지합니다.
 * 첫 호출 시 인스턴스를 생성하고, 이후 호출에서는 동일한 인스턴스를 재사용합니다.
 *
 * 싱글톤 패턴 이유:
 * - API 연결 재사용으로 성능 향상
 * - 메모리 효율성 (다중 인스턴스 방지)
 * - 일관된 상태 관리
 *
 * @returns {Daytona} Daytona SDK 클라이언트 인스턴스
 *
 * @example
 * const client = daytonaClient();
 * const sandbox = await client.get("sandbox-id");
 */
export function daytonaClient(): Daytona {
  if (!daytonaInstance) {
    daytonaInstance = new Daytona();
  }
  return daytonaInstance;
}

/**
 * 샌드박스를 안전하게 중지합니다.
 *
 * @description
 * 실행 중인 샌드박스를 중지 상태로 전환합니다.
 * 이미 중지/보관된 샌드박스는 그대로 두고, 실행 중인 경우만 중지 명령을 전송합니다.
 *
 * 상태별 처리:
 * 1. stopped/archived: 이미 중지됨 → 아무 작업 없이 ID 반환
 * 2. started: 실행 중 → stop() 호출하여 중지
 * 3. 기타: 예상치 못한 상태 → ID 반환 (에러 없이)
 *
 * 사용 시나리오:
 * - 장기 유휴 샌드박스 리소스 절약
 * - 그래프 종료 시 정리 작업
 * - 비용 최적화 (stopped 상태는 과금 안 됨)
 *
 * @param {string} sandboxSessionId - 중지할 샌드박스의 고유 ID
 * @returns {Promise<string>} 샌드박스 세션 ID
 *
 * @example
 * await stopSandbox("sandbox-abc-123");
 */
export async function stopSandbox(sandboxSessionId: string): Promise<string> {
  const sandbox = await daytonaClient().get(sandboxSessionId);
  if (
    sandbox.state === SandboxState.STOPPED ||
    sandbox.state === SandboxState.ARCHIVED
  ) {
    return sandboxSessionId;
  } else if (sandbox.state === "started") {
    await daytonaClient().stop(sandbox);
  }

  return sandbox.id;
}

/**
 * 샌드박스를 완전히 삭제합니다 (복구 불가).
 *
 * @description
 * 지정된 샌드박스를 Daytona 시스템에서 영구적으로 제거합니다.
 * 삭제 실패 시 에러를 로깅하고 false를 반환하여 안전하게 처리합니다.
 *
 * 삭제 프로세스:
 * 1. 샌드박스 ID로 인스턴스 조회
 * 2. Daytona API로 delete 요청
 * 3. 성공 시 true 반환
 * 4. 실패 시 에러 로깅 후 false 반환
 *
 * 주의사항:
 * - 삭제된 샌드박스는 복구 불가능
 * - 모든 데이터 및 상태가 영구 손실
 * - 정리 작업에만 사용 (디버깅 시 주의)
 *
 * 사용 시나리오:
 * - 더 이상 필요없는 샌드박스 정리
 * - 테스트 후 임시 환경 제거
 * - 리소스 정리 및 비용 절감
 *
 * @param {string} sandboxSessionId - 삭제할 샌드박스의 고유 ID
 * @returns {Promise<boolean>} 삭제 성공 시 true, 실패 시 false
 *
 * @example
 * const deleted = await deleteSandbox("sandbox-abc-123");
 * if (deleted) console.log("Sandbox removed");
 */
export async function deleteSandbox(
  sandboxSessionId: string,
): Promise<boolean> {
  try {
    const sandbox = await daytonaClient().get(sandboxSessionId);
    await daytonaClient().delete(sandbox);
    return true;
  } catch (error) {
    logger.error("샌드박스 삭제 실패", {
      sandboxSessionId,
      error,
    });
    return false;
  }
}

/**
 * 새로운 샌드박스를 생성합니다 (내부 함수).
 *
 * @description
 * Daytona SDK를 사용하여 새로운 샌드박스 인스턴스를 생성합니다.
 * 생성 실패 시 에러를 상세히 로깅하고 null을 반환하여 재시도 로직을 지원합니다.
 *
 * 생성 프로세스:
 * 1. DEFAULT_SANDBOX_CREATE_PARAMS로 샌드박스 생성 요청
 * 2. 100초 타임아웃 설정 (장시간 소요 가능)
 * 3. 성공 시 Sandbox 인스턴스 반환
 * 4. 실패 시 에러 로깅 후 null 반환
 *
 * 에러 처리:
 * - Error 객체: name, message, stack 로깅
 * - 기타 에러: 원본 에러 객체 로깅
 * - 예외 던지지 않음 (호출자가 재시도 결정)
 *
 * @param {number} attempt - 현재 생성 시도 횟수 (로깅용)
 * @returns {Promise<Sandbox | null>} 생성된 샌드박스 또는 null (실패 시)
 *
 * @example
 * const sandbox = await createSandbox(1);
 * if (!sandbox) console.log("Creation failed");
 */
async function createSandbox(attempt: number): Promise<Sandbox | null> {
  try {
    return await daytonaClient().create(DEFAULT_SANDBOX_CREATE_PARAMS, {
      timeout: 100,
    });
  } catch (e) {
    logger.error("샌드박스 생성 실패", {
      attempt,
      ...(e instanceof Error
        ? {
            name: e.name,
            message: e.message,
            stack: e.stack,
          }
        : {
            error: e,
          }),
    });
    return null;
  }
}

/**
 * 샌드박스를 가져오거나 재생성하는 통합 핸들러 (에러 복구 포함).
 *
 * @description
 * 기존 샌드박스를 조회하고, 문제 발생 시 자동으로 재생성하는 핵심 함수입니다.
 * 로컬 모드, 상태 전환, 재시도, Git 복제, 트리 생성을 모두 처리합니다.
 *
 * 주요 워크플로우:
 * 1. **로컬 모드 확인**: Mock 샌드박스 반환 (실제 생성 안 함)
 * 2. **기존 샌드박스 조회**: ID로 샌드박스 가져오기
 * 3. **상태 확인 및 전환**:
 *    - started: 그대로 사용
 *    - stopped/archived: 재시작 후 사용
 *    - 기타: 재생성 필요
 * 4. **재생성 로직** (실패 시):
 *    - 최대 3회 재시도
 *    - Git 저장소 복제
 *    - 코드베이스 트리 생성
 *    - 의존성 미설치 상태로 반환
 *
 * 에러 복구 전략:
 * - 샌드박스 조회 실패 → 재생성
 * - 복구 불가 상태 → 재생성
 * - 생성 3회 실패 → 예외 발생
 *
 * 로컬 모드:
 * - 실제 샌드박스 생성 안 함
 * - Mock 객체 반환 (id: "local-mock-sandbox")
 * - codebaseTree, dependenciesInstalled: null
 *
 * @param {string | undefined} sandboxSessionId - 기존 샌드박스 ID (없으면 새로 생성)
 * @param {TargetRepository} targetRepository - Git 저장소 정보 (owner/repo)
 * @param {string} branchName - 작업할 Git 브랜치명
 * @param {GraphConfig} config - 그래프 실행 설정 (로컬 모드, 토큰 등)
 * @returns {Promise<{ sandbox: Sandbox; codebaseTree: string | null; dependenciesInstalled: boolean | null }>}
 *   - sandbox: 사용 가능한 샌드박스 인스턴스
 *   - codebaseTree: 코드베이스 디렉토리 구조 (재생성 시만)
 *   - dependenciesInstalled: 의존성 설치 여부 (재생성 시 false)
 *
 * @throws {Error} 3회 재시도 후에도 샌드박스 생성 실패 시
 *
 * @example
 * // 기존 샌드박스 재사용
 * const { sandbox } = await getSandboxWithErrorHandling(
 *   "sandbox-abc-123",
 *   { owner: "user", repo: "project" },
 *   "main",
 *   config
 * );
 *
 * @example
 * // 새 샌드박스 생성
 * const { sandbox, codebaseTree } = await getSandboxWithErrorHandling(
 *   undefined,
 *   targetRepo,
 *   "feature-branch",
 *   config
 * );
 */
export async function getSandboxWithErrorHandling(
  sandboxSessionId: string | undefined,
  targetRepository: TargetRepository,
  branchName: string,
  config: GraphConfig,
): Promise<{
  sandbox: Sandbox;
  codebaseTree: string | null;
  dependenciesInstalled: boolean | null;
}> {
  if (isLocalMode(config)) {
    const mockSandbox = {
      id: sandboxSessionId || "local-mock-sandbox",
      state: "started",
    } as Sandbox;

    return {
      sandbox: mockSandbox,
      codebaseTree: null,
      dependenciesInstalled: null,
    };
  }
  try {
    if (!sandboxSessionId) {
      throw new Error("샌드박스 ID가 제공되지 않았습니다.");
    }

    logger.info("샌드박스 가져오는 중.");
    // 기존 샌드박스 가져오기 시도
    const sandbox = await daytonaClient().get(sandboxSessionId);

    // 샌드박스 상태 확인
    const state = sandbox.state;

    if (state === "started") {
      return {
        sandbox,
        codebaseTree: null,
        dependenciesInstalled: null,
      };
    }

    if (state === "stopped" || state === "archived") {
      await sandbox.start();
      return {
        sandbox,
        codebaseTree: null,
        dependenciesInstalled: null,
      };
    }

    // 다른 모든 상태에 대해 샌드박스 재생성
    throw new Error(`복구할 수 없는 상태의 샌드박스: ${state}`);
  } catch (error) {
    // 단계가 실패하면 샌드박스 재생성
    logger.info("오류 또는 복구할 수 없는 상태로 인해 샌드박스 재생성 중", {
      error,
    });

    let sandbox: Sandbox | null = null;
    let numSandboxCreateAttempts = 0;
    while (!sandbox && numSandboxCreateAttempts < 3) {
      sandbox = await createSandbox(numSandboxCreateAttempts);
      if (!sandbox) {
        numSandboxCreateAttempts++;
      }
    }

    if (!sandbox) {
      throw new Error("3번의 시도 후 샌드박스 생성 실패");
    }

    const { githubInstallationToken } = getGitHubTokensFromConfig(config);

    // 저장소 복제
    await cloneRepo(sandbox, targetRepository, {
      githubInstallationToken,
      stateBranchName: branchName,
    });

    // 코드베이스 트리 가져오기
    const codebaseTree = await getCodebaseTree(
      config,
      sandbox.id,
      targetRepository,
    );
    const codebaseTreeToReturn =
      codebaseTree === FAILED_TO_GENERATE_TREE_MESSAGE ? null : codebaseTree;

    logger.info("샌드박스가 성공적으로 생성되었습니다.", {
      sandboxId: sandbox.id,
    });
    return {
      sandbox,
      codebaseTree: codebaseTreeToReturn,
      dependenciesInstalled: false,
    };
  }
}
