/**
 * @file 로컬 셸 명령 실행기
 * @description
 * 로컬 환경에서 셸 명령을 안전하게 실행하는 클래스와 유틸리티를 제공합니다.
 * 여러 셸 경로 fallback, 환경 변수 관리, 타임아웃 처리를 지원합니다.
 *
 * 주요 기능:
 * 1. Node.js child_process spawn을 사용한 명령 실행
 * 2. 여러 셸 경로 자동 재시도 (/bin/bash → /bin/sh)
 * 3. 작업 디렉토리 및 환경 변수 설정
 * 4. stdout/stderr 분리 수집
 * 5. 타임아웃 처리
 * 6. 싱글톤 패턴 지원
 *
 * 사용 위치:
 * - ShellExecutor: 로컬 모드 명령 실행 위임
 * - builtin-tools/shell.ts: 로컬 모드 셸 도구
 * - text-editor.ts: 로컬 파일 조작
 *
 * @example
 * const executor = new LocalShellExecutor("/path/to/project");
 * const result = await executor.executeCommand("npm test", {
 *   env: { NODE_ENV: "test" },
 *   timeout: 60
 * });
 */

// === Node.js 내장 모듈 ===
import { spawn } from "child_process";

// === 타입 정의 ===
import { LocalExecuteResponse } from "./types.js";

// === 로깅 유틸리티 ===
import { createLogger, LogLevel } from "../logger.js";

const logger = createLogger(LogLevel.INFO, "LocalShellExecutor");

/**
 * 로컬 머신에서 셸 명령을 실행하는 클래스입니다.
 *
 * @description
 * Node.js child_process를 사용하여 로컬 환경에서 셸 명령을 실행합니다.
 * 여러 셸 경로를 순차적으로 시도하여 호환성을 높입니다.
 *
 * 주요 특징:
 * - 작업 디렉토리 관리 (getter/setter)
 * - 환경 변수 병합 (process.env + 커스텀)
 * - Shell fallback (bash → sh)
 * - Timeout 지원
 * - stdout/stderr 분리
 *
 * @class
 */
export class LocalShellExecutor {
  private workingDirectory: string;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
    logger.info("LocalShellExecutor 생성됨", { workingDirectory });
  }

  /**
   * 로컬 환경에서 셸 명령을 실행합니다.
   *
   * @description
   * Node.js child_process spawn을 사용하여 셸 명령을 실행합니다.
   * localMode가 true일 때만 실행되며, false일 경우 에러를 발생시킵니다.
   *
   * 실행 프로세스:
   * 1. 환경 변수 병합 (process.env + 커스텀 env)
   * 2. localMode 확인
   * 3. undefined 환경 변수 필터링
   * 4. executeWithSpawn 호출 (shell fallback 포함)
   * 5. 성공 시 결과 반환, 실패 시 에러 응답 생성
   *
   * 에러 처리:
   * - localMode=false: 예외 발생
   * - spawn 실패: exitCode 1 + 에러 메시지 반환
   *
   * @param {string} command - 실행할 셸 명령 (예: "npm test", "git status")
   * @param {Object} [args] - 실행 옵션
   * @param {string} [args.workdir] - 작업 디렉토리 (기본값: this.workingDirectory)
   * @param {Record<string, string>} [args.env] - 환경 변수 (process.env와 병합)
   * @param {number} [args.timeout=30] - 타임아웃 (초 단위)
   * @param {boolean} [args.localMode=false] - 로컬 모드 플래그 (필수: true)
   * @returns {Promise<LocalExecuteResponse>} 명령 실행 결과 (exitCode, stdout, stderr)
   *
   * @throws {Error} localMode가 false인 경우
   *
   * @example
   * const result = await executor.executeCommand("ls -la", {
   *   workdir: "/tmp",
   *   timeout: 10,
   *   localMode: true
   * });
   */
  async executeCommand(
    command: string,
    args?: {
      workdir?: string;
      env?: Record<string, string>;
      timeout?: number;
      localMode?: boolean;
    },
  ): Promise<LocalExecuteResponse> {
    const { workdir, env, timeout = 30, localMode = false } = args || {};
    const cwd = workdir || this.workingDirectory;
    const environment = { ...process.env, ...(env || {}) };

    logger.info("로컬에서 명령어 실행 중", { command, cwd, localMode });

    // 로컬 모드에서는 안정성을 높이기 위해 spawn을 직접 사용합니다.
    if (localMode) {
      try {
        const cleanEnv = Object.fromEntries(
          Object.entries(environment).filter(([_, v]) => v !== undefined),
        ) as Record<string, string>;
        const result = await this.executeWithSpawn(
          command,
          cwd,
          cleanEnv,
          timeout,
        );
        return result;
      } catch (spawnError: any) {
        logger.error("로컬 모드에서 spawn 실행 실패", {
          command,
          error: spawnError.message,
        });

        return {
          exitCode: 1,
          result: spawnError.message,
          artifacts: {
            stdout: "",
            stderr: spawnError.message,
          },
        };
      }
    }

    // 비-로컬 모드: 이 실행기는 로컬 모드 전용이므로 오류를 발생시킵니다.
    throw new Error("LocalShellExecutor는 로컬 모드 작업 전용입니다.");
  }

  /**
   * spawn을 사용하여 명령어를 실행하고 여러 셸 경로를 순차적으로 시도합니다 (fallback 지원).
   *
   * @description
   * child_process.spawn을 사용하여 셸 명령을 실행합니다.
   * 여러 셸 경로를 순차적으로 시도하여 환경 호환성을 높입니다.
   *
   * 셸 Fallback 순서:
   * 1. /bin/bash (대부분의 Unix 시스템)
   * 2. /usr/bin/bash (일부 시스템)
   * 3. /bin/sh (POSIX 호환 셸)
   * 4. /usr/bin/sh (대체 경로)
   *
   * 실행 워크플로우:
   * 1. 첫 번째 셸 경로로 spawn 시도
   * 2. stdout/stderr 스트림 수집
   * 3. close 이벤트에서 결과 반환
   * 4. error 이벤트 발생 시 다음 셸 경로 시도
   * 5. 모든 경로 실패 시 reject
   *
   * @param {string} command - 실행할 셸 명령
   * @param {string} cwd - 작업 디렉토리 절대 경로
   * @param {Record<string, string>} env - 환경 변수 (process.env와 병합됨)
   * @param {number} timeout - 타임아웃 (초 → ms 변환)
   * @returns {Promise<LocalExecuteResponse>} 명령 실행 결과
   *
   * @private
   *
   * @example
   * const result = await this.executeWithSpawn(
   *   "npm install",
   *   "/path/to/project",
   *   { NODE_ENV: "production" },
   *   60
   * );
   */
  private async executeWithSpawn(
    command: string,
    cwd: string,
    env: Record<string, string>,
    timeout: number,
  ): Promise<LocalExecuteResponse> {
    return new Promise((resolve, reject) => {
      // 다른 셸 경로 시도
      const shellPaths = [
        "/bin/bash",
        "/usr/bin/bash",
        "/bin/sh",
        "/usr/bin/sh",
      ];
      let lastError: Error | null = null;

      const tryShell = (shellPath: string) => {
        const child = spawn(shellPath, ["-c", command], {
          cwd,
          env: { ...process.env, ...env },
          timeout: timeout * 1000,
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        child.on("close", (code) => {
          resolve({
            exitCode: code || 0,
            result: stdout,
            artifacts: {
              stdout,
              stderr,
            },
          });
        });

        child.on("error", (error) => {
          lastError = error;
          // 다음 셸 경로 시도
          const nextIndex = shellPaths.indexOf(shellPath) + 1;
          if (nextIndex < shellPaths.length) {
            tryShell(shellPaths[nextIndex]);
          } else {
            reject(lastError);
          }
        });
      };

      // 첫 번째 셸 경로로 시작
      tryShell(shellPaths[0]);
    });
  }

  /**
   * 현재 작업 디렉토리를 반환합니다.
   *
   * @returns {string} 작업 디렉토리 절대 경로
   */
  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  /**
   * 작업 디렉토리를 변경합니다.
   *
   * @description
   * 향후 명령 실행 시 사용될 기본 작업 디렉토리를 설정합니다.
   * 변경 사항은 로그에 기록됩니다.
   *
   * @param {string} directory - 새 작업 디렉토리 경로
   */
  setWorkingDirectory(directory: string): void {
    this.workingDirectory = directory;
    logger.info("작업 디렉토리 변경됨", { workingDirectory: directory });
  }
}

/**
 * 공유 LocalShellExecutor 인스턴스 (싱글톤)
 * 작업 디렉토리가 변경되지 않는 한 재사용됩니다.
 */
let sharedExecutor: LocalShellExecutor | null = null;

/**
 * 공유 LocalShellExecutor 인스턴스를 반환합니다 (싱글톤 패턴).
 *
 * @description
 * LocalShellExecutor를 싱글톤으로 관리하여 인스턴스 재사용을 촉진합니다.
 * 작업 디렉토리가 변경되면 새 인스턴스를 생성합니다.
 *
 * 인스턴스 재사용 조건:
 * 1. sharedExecutor가 존재함
 * 2. workingDirectory가 지정되지 않음 OR
 * 3. 현재 작업 디렉토리와 동일함
 *
 * 새 인스턴스 생성 조건:
 * 1. sharedExecutor가 없음 OR
 * 2. 다른 workingDirectory가 지정됨
 *
 * @param {string} [workingDirectory] - 작업 디렉토리 (선택사항, 기본값: process.cwd())
 * @returns {LocalShellExecutor} LocalShellExecutor 싱글톤 인스턴스
 *
 * @example
 * const executor = getLocalShellExecutor("/path/to/project");
 * const result = await executor.executeCommand("ls -la", { localMode: true });
 */
export function getLocalShellExecutor(
  workingDirectory?: string,
): LocalShellExecutor {
  if (
    !sharedExecutor ||
    (workingDirectory &&
      sharedExecutor.getWorkingDirectory() !== workingDirectory)
  ) {
    sharedExecutor = new LocalShellExecutor(workingDirectory);
  }
  return sharedExecutor;
}
