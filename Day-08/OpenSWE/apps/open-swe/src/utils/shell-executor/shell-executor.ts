/**
 * @file 통합 셸 명령 실행기 (로컬/샌드박스 듀얼 모드)
 * @description
 * 로컬과 샌드박스 환경 모두에서 셸 명령을 실행하는 통합 인터페이스를 제공합니다.
 * GraphConfig를 기반으로 실행 환경을 자동으로 선택하여 도구 코드의 분기를 최소화합니다.
 *
 * 주요 기능:
 * 1. 로컬/샌드박스 자동 라우팅 (config 기반)
 * 2. 명령어 배열 → 문자열 자동 변환
 * 3. 기본 환경 변수 주입 (COREPACK)
 * 4. 타임아웃 관리
 * 5. 통합 응답 형식 (LocalExecuteResponse)
 *
 * 실행 모드:
 * - 로컬: LocalShellExecutor 사용 (child_process)
 * - 샌드박스: Daytona SDK 사용 (sandbox.process.executeCommand)
 *
 * 사용 위치:
 * - builtin-tools/shell.ts: 셸 도구
 * - builtin-tools/text-editor.ts: 파일 조작 명령
 * - builtin-tools/apply-patch.ts: 패치 적용
 *
 * @example
 * const executor = new ShellExecutor(config);
 * const result = await executor.executeCommand({
 *   command: "npm test",
 *   workdir: "/path/to/project",
 *   timeout: 60
 * });
 */

// === Daytona SDK ===
import { Sandbox } from "@daytonaio/sdk";

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types";

// === 상수 ===
import { TIMEOUT_SEC } from "@openswe/shared/constants";

// === 로컬 모드 유틸리티 ===
import {
  isLocalMode,
  getLocalWorkingDirectory,
} from "@openswe/shared/open-swe/local-mode";

// === 로컬 실행기 ===
import { getLocalShellExecutor } from "./local-shell-executor.js";

// === 로깅 ===
import { createLogger, LogLevel } from "../logger.js";

// === 타입 ===
import { ExecuteCommandOptions, LocalExecuteResponse } from "./types.js";

// === 샌드박스 유틸리티 ===
import { getSandboxSessionOrThrow } from "../../tools/utils/get-sandbox-id.js";

const logger = createLogger(LogLevel.INFO, "ShellExecutor");

/**
 * 기본 환경 변수
 *
 * @description
 * 모든 명령 실행 시 자동으로 주입되는 환경 변수입니다.
 * corepack의 대화형 프롬프트를 비활성화하여 명령 중단을 방지합니다.
 *
 * @constant {Record<string, string>}
 */
const DEFAULT_ENV = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
};

/**
 * 로컬 및 샌드박스 환경을 통합 지원하는 셸 명령 실행기입니다.
 *
 * @description
 * GraphConfig를 기반으로 실행 환경을 자동 판단하고 적절한 실행기로 위임합니다.
 * 도구 개발자는 환경을 신경 쓰지 않고 동일한 인터페이스로 명령을 실행할 수 있습니다.
 *
 * 모드별 동작:
 * - 로컬 모드: LocalShellExecutor → child_process.spawn
 * - 샌드박스 모드: Daytona SDK → sandbox.process.executeCommand
 *
 * @class
 */
export class ShellExecutor {
  private config?: GraphConfig;

  constructor(config?: GraphConfig) {
    this.config = config;
  }

  /**
   * 현재 모드에 따라 로컬 또는 샌드박스에서 셸 명령을 실행합니다.
   *
   * @description
   * GraphConfig를 기반으로 로컬 또는 샌드박스 모드를 자동 판단하고
   * 적절한 실행 메서드로 위임합니다. 명령어 배열은 자동으로 문자열로 변환됩니다.
   *
   * 실행 흐름:
   * 1. 명령어 배열 → 문자열 변환 (필요 시)
   * 2. 환경 변수 병합 (DEFAULT_ENV + 커스텀 env)
   * 3. 로컬 모드 확인
   * 4. 모드에 따라 executeLocal 또는 executeSandbox 호출
   *
   * @param {ExecuteCommandOptions} options - 명령 실행 옵션
   * @returns {Promise<LocalExecuteResponse>} 명령 실행 결과
   *
   * @example
   * const result = await executor.executeCommand({
   *   command: ["npm", "run", "build"],
   *   workdir: "/path/to/project",
   *   env: { NODE_ENV: "production" },
   *   timeout: 120
   * });
   */
  async executeCommand(
    options: ExecuteCommandOptions,
  ): Promise<LocalExecuteResponse> {
    const {
      command,
      workdir,
      env = {},
      timeout = TIMEOUT_SEC,
      sandbox,
      sandboxSessionId,
    } = options;

    const commandString = Array.isArray(command) ? command.join(" ") : command;
    const environment = { ...DEFAULT_ENV, ...env };

    logger.info("명령어 실행 중", {
      command: commandString,
      workdir,
      localMode: isLocalMode(this.config),
    });

    if (isLocalMode(this.config)) {
      return this.executeLocal(commandString, workdir, environment, timeout);
    } else {
      return this.executeSandbox(
        commandString,
        workdir,
        environment,
        timeout,
        sandbox,
        sandboxSessionId,
      );
    }
  }

  /**
   * LocalShellExecutor를 사용하여 로컬 머신에서 명령을 실행합니다.
   *
   * @description
   * 로컬 모드 전용 실행 메서드입니다.
   * LocalShellExecutor 싱글톤을 가져와 명령을 실행합니다.
   *
   * 실행 프로세스:
   * 1. getLocalShellExecutor로 싱글톤 인스턴스 획득
   * 2. 작업 디렉토리 결정 (workdir || getLocalWorkingDirectory())
   * 3. LocalShellExecutor.executeCommand 호출
   * 4. 결과 반환
   *
   * @param {string} command - 실행할 셸 명령 (문자열)
   * @param {string} [workdir] - 작업 디렉토리 (선택사항)
   * @param {Record<string, string>} [env] - 환경 변수
   * @param {number} [timeout] - 타임아웃 (초)
   * @returns {Promise<LocalExecuteResponse>} 명령 실행 결과
   *
   * @private
   */
  private async executeLocal(
    command: string,
    workdir?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<LocalExecuteResponse> {
    const executor = getLocalShellExecutor(getLocalWorkingDirectory());
    const localWorkdir = workdir || getLocalWorkingDirectory();

    return await executor.executeCommand(command, {
      workdir: localWorkdir,
      env,
      timeout,
      localMode: true,
    });
  }

  /**
   * Daytona 샌드박스에서 명령을 실행합니다.
   *
   * @description
   * 샌드박스 모드 전용 실행 메서드입니다.
   * Sandbox 인스턴스를 사용하거나 sandboxSessionId로 조회하여 명령을 실행합니다.
   *
   * 실행 프로세스:
   * 1. sandbox 인스턴스 확인 (제공 또는 ID로 조회)
   * 2. sandbox.process.executeCommand 호출
   * 3. 결과 반환 (LocalExecuteResponse 형식)
   *
   * Sandbox 획득 방법:
   * - sandbox 파라미터 제공 시: 직접 사용
   * - sandboxSessionId 제공 시: getSandboxSessionOrThrow로 조회
   *
   * @param {string} command - 실행할 셸 명령
   * @param {string} [workdir] - 작업 디렉토리 (샌드박스 내 경로)
   * @param {Record<string, string>} [env] - 환경 변수
   * @param {number} [timeout] - 타임아웃 (초)
   * @param {Sandbox} [sandbox] - Daytona 샌드박스 인스턴스
   * @param {string} [sandboxSessionId] - 샌드박스 세션 ID (sandbox 미제공 시)
   * @returns {Promise<LocalExecuteResponse>} 명령 실행 결과
   *
   * @private
   */
  private async executeSandbox(
    command: string,
    workdir?: string,
    env?: Record<string, string>,
    timeout?: number,
    sandbox?: Sandbox,
    sandboxSessionId?: string,
  ): Promise<LocalExecuteResponse> {
    const sandbox_ =
      sandbox ??
      (await getSandboxSessionOrThrow({
        xSandboxSessionId: sandboxSessionId,
      }));

    return await sandbox_.process.executeCommand(
      command,
      workdir,
      env,
      timeout,
    );
  }

  /**
   * 현재 실행 모드가 로컬 모드인지 확인합니다.
   *
   * @description
   * GraphConfig를 기반으로 로컬 모드 여부를 판단합니다.
   * 도구에서 모드별 로직 분기가 필요할 때 사용할 수 있습니다.
   *
   * @returns {boolean} 로컬 모드이면 true, 샌드박스 모드이면 false
   *
   * @example
   * if (executor.checkLocalMode()) {
   *   console.log("Running in local mode");
   * }
   */
  checkLocalMode(): boolean {
    return isLocalMode(this.config);
  }

  /**
   * 현재 모드에 적합한 작업 디렉토리를 반환합니다.
   *
   * @description
   * 로컬 모드에서는 getLocalWorkingDirectory()를 반환합니다.
   * 샌드박스 모드에서는 에러를 발생시킵니다 (샌드박스별로 다르므로 명시 필요).
   *
   * 모드별 동작:
   * - 로컬: getLocalWorkingDirectory() 반환
   * - 샌드박스: 예외 발생 (workdir를 executeCommand에 명시 필요)
   *
   * @returns {string} 작업 디렉토리 절대 경로 (로컬 모드만)
   * @throws {Error} 샌드박스 모드에서 호출 시
   *
   * @example
   * // 로컬 모드
   * const cwd = executor.getWorkingDirectory();
   * // "/path/to/local/workspace"
   */
  getWorkingDirectory(): string {
    if (isLocalMode(this.config)) {
      return getLocalWorkingDirectory();
    }
    // 샌드박스 모드의 경우 특정 샌드박스 컨텍스트에 따라 호출자가 제공해야 합니다.
    throw new Error(
      "샌드박스 모드의 작업 디렉토리는 명시적으로 제공해야 합니다.",
    );
  }
}

/**
 * ShellExecutor 인스턴스를 생성하는 팩토리 함수입니다.
 *
 * @description
 * ShellExecutor 생성자를 래핑한 편의 함수입니다.
 * new ShellExecutor(config)와 동일하지만 함수형 스타일을 선호할 때 사용합니다.
 *
 * @param {GraphConfig} [config] - 그래프 실행 설정 (로컬 모드 여부 결정)
 * @returns {ShellExecutor} ShellExecutor 인스턴스
 *
 * @example
 * const executor = createShellExecutor(config);
 * await executor.executeCommand({ command: "ls" });
 */
export function createShellExecutor(config?: GraphConfig): ShellExecutor {
  return new ShellExecutor(config);
}

/**
 * 일회성 명령어 실행을 위한 편의 함수입니다.
 *
 * @description
 * ShellExecutor 인스턴스를 생성하고 즉시 명령을 실행하는 헬퍼 함수입니다.
 * 단일 명령 실행 시 인스턴스 관리 없이 간편하게 사용할 수 있습니다.
 *
 * 내부 동작:
 * 1. createShellExecutor로 인스턴스 생성
 * 2. executeCommand 즉시 호출
 * 3. 결과 반환
 *
 * 사용 시나리오:
 * - 일회성 명령 실행 (인스턴스 재사용 불필요)
 * - 간단한 스크립트나 유틸리티
 *
 * @param {GraphConfig} config - 그래프 실행 설정
 * @param {ExecuteCommandOptions} options - 명령 실행 옵션
 * @returns {Promise<LocalExecuteResponse>} 명령 실행 결과
 *
 * @example
 * const result = await executeCommand(config, {
 *   command: "git status",
 *   timeout: 10
 * });
 * console.log(result.result);
 */
export async function executeCommand(
  config: GraphConfig,
  options: ExecuteCommandOptions,
): Promise<LocalExecuteResponse> {
  const executor = createShellExecutor(config);
  return await executor.executeCommand(options);
}
