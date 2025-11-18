/**
 * @file 셸 명령 실행 타입 정의
 * @description
 * ShellExecutor와 LocalShellExecutor에서 사용하는 공통 타입 인터페이스를 정의합니다.
 * 로컬 및 샌드박스 환경 모두를 지원하는 통합 타입 시스템을 제공합니다.
 *
 * 주요 타입:
 * 1. LocalExecuteResponse: 명령 실행 결과 (종료 코드, 출력, 에러)
 * 2. ExecuteCommandOptions: 명령 실행 옵션 (명령어, 작업 디렉토리, 환경 변수, 타임아웃 등)
 *
 * 사용 위치:
 * - shell-executor.ts: 통합 셸 실행기
 * - local-shell-executor.ts: 로컬 명령 실행기
 * - builtin-tools/shell.ts: 셸 도구
 */

// === Daytona SDK ===
import { Sandbox } from "@daytonaio/sdk";

/**
 * 로컬 명령어 실행 결과를 나타내는 인터페이스입니다.
 *
 * @description
 * 셸 명령 실행 후 반환되는 표준화된 응답 형식입니다.
 * Node.js child_process와 Daytona SDK 모두와 호환되는 구조입니다.
 *
 * 필드 설명:
 * - exitCode: 프로세스 종료 코드 (0 = 성공, 그 외 = 에러)
 * - result: 결합된 출력 (stdout + stderr) 또는 주요 출력
 * - artifacts: 구조화된 출력 (stdout, stderr 분리)
 *
 * @interface
 * @property {number} exitCode - 명령 종료 코드 (0 = 성공)
 * @property {string} result - 명령 실행 결과 메시지
 * @property {{ stdout: string; stderr?: string }} [artifacts] - 표준 출력/에러 분리 (선택사항)
 *
 * @example
 * const response: LocalExecuteResponse = {
 *   exitCode: 0,
 *   result: "Build successful",
 *   artifacts: {
 *     stdout: "Compilation complete\n",
 *     stderr: ""
 *   }
 * };
 */
export interface LocalExecuteResponse {
  exitCode: number;
  result: string;
  artifacts?: {
    stdout: string;
    stderr?: string;
  };
}

/**
 * 명령어 실행 시 사용되는 옵션 인터페이스입니다.
 *
 * @description
 * ShellExecutor.executeCommand() 호출 시 전달되는 설정 객체입니다.
 * 로컬 및 샌드박스 환경을 모두 지원하며, 실행 환경에 따라 필요한 옵션이 다릅니다.
 *
 * 환경별 필수 옵션:
 * - 로컬: command, workdir (선택)
 * - 샌드박스: command, sandbox 또는 sandboxSessionId
 *
 * @interface
 * @property {string | string[]} command - 실행할 셸 명령 (문자열 또는 배열)
 * @property {string} [workdir] - 작업 디렉토리 (절대 경로 또는 상대 경로)
 * @property {Record<string, string>} [env] - 환경 변수 (KEY=VALUE 형식)
 * @property {number} [timeout] - 실행 타임아웃 (초 단위, 기본값: 상수 참조)
 * @property {Sandbox} [sandbox] - Daytona 샌드박스 인스턴스 (샌드박스 모드)
 * @property {string} [sandboxSessionId] - 샌드박스 세션 ID (샌드박스 모드)
 *
 * @example
 * // 로컬 실행
 * const localOptions: ExecuteCommandOptions = {
 *   command: "npm test",
 *   workdir: "/path/to/project",
 *   env: { NODE_ENV: "test" },
 *   timeout: 60
 * };
 *
 * @example
 * // 샌드박스 실행
 * const sandboxOptions: ExecuteCommandOptions = {
 *   command: ["git", "status"],
 *   sandbox: sandboxInstance,
 *   timeout: 30
 * };
 */
export interface ExecuteCommandOptions {
  command: string | string[];
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  sandbox?: Sandbox;
  sandboxSessionId?: string;
}
