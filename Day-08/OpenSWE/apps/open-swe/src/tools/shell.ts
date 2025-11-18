/**
 * @file Shell 도구
 * @description
 * 샌드박스 또는 로컬 환경에서 Shell 명령을 실행하는 도구입니다.
 *
 * 주요 기능:
 * - 임의의 Shell 명령 실행 (ls, cat, grep, npm, yarn 등)
 * - 작업 디렉토리 지정 가능
 * - 타임아웃 설정 가능
 * - 환경 변수 설정 가능
 * - 종료 코드 기반 성공/실패 판단
 *
 * 사용 예시:
 * - 파일 리스트: `ls -la`
 * - 파일 내용 확인: `cat package.json`
 * - 테스트 실행: `yarn test`
 * - 빌드 실행: `yarn build`
 * - Git 작업: `git status`
 *
 * 중요 사항:
 * - corepack 다운로드 프롬프트 비활성화 (DEFAULT_ENV)
 * - 종료 코드 0이 아닌 경우 오류로 처리
 * - 샌드박스 모드와 로컬 모드 모두 지원
 */

// === LangChain Core ===
import { tool } from "@langchain/core/tools"; // 도구 생성 헬퍼

// === 타입 정의 ===
import { GraphState, GraphConfig } from "@openswe/shared/open-swe/types"; // 그래프 상태/설정

// === 유틸리티 ===
import { getSandboxErrorFields } from "../utils/sandbox-error-fields.js"; // 샌드박스 에러 필드 추출
import { createShellExecutor } from "../utils/shell-executor/index.js"; // Shell 실행기 생성

// === 상수 ===
import { TIMEOUT_SEC } from "@openswe/shared/constants"; // 기본 타임아웃

// === 도구 필드 ===
import { createShellToolFields } from "@openswe/shared/open-swe/tools"; // Shell 도구 스키마

/**
 * 기본 환경 변수
 *
 * @description
 * Shell 명령 실행 시 기본으로 설정되는 환경 변수들입니다.
 *
 * COREPACK_ENABLE_DOWNLOAD_PROMPT="0":
 * - corepack이 패키지 매니저를 다운로드할 때 프롬프트를 표시하지 않도록 설정
 * - 프롬프트가 표시되면 명령이 중단되고 타임아웃이 발생할 수 있음
 * - CI/CD 환경이나 비대화형 실행에서 필수적
 *
 * @constant {Object}
 */
const DEFAULT_ENV = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
};

/**
 * Shell 명령 실행 도구를 생성합니다.
 *
 * @description
 * 샌드박스 또는 로컬 환경에서 임의의 Shell 명령을 실행하는 도구를 생성합니다.
 *
 * 처리 흐름:
 * 1. Shell 실행기 생성 (ShellExecutor)
 * 2. 명령 실행 (command, workdir, timeout 설정)
 * 3. 종료 코드 확인:
 *    - 0: 성공
 *    - 0이 아닌 값: 실패 (오류 throw)
 * 4. 결과 반환 (stdout + stderr)
 *
 * 입력 파라미터:
 * - command (string): 실행할 Shell 명령
 * - workdir (string, optional): 작업 디렉토리
 * - timeout (number, optional): 타임아웃 (초), 기본값: TIMEOUT_SEC
 *
 * 출력 형식:
 * - result (string): 명령 출력 (stdout + stderr)
 * - status ("success" | "error"): 실행 결과
 *
 * 오류 처리:
 * - 종료 코드 오류: 종료 코드 + 출력 포함
 * - 샌드박스 오류: 샌드박스 에러 필드 추출
 * - 기타 오류: 오류 메시지 반환
 *
 * @param {Pick<GraphState, "sandboxSessionId" | "targetRepository">} state - 그래프 상태
 *   - sandboxSessionId: 샌드박스 세션 ID
 *   - targetRepository: 타겟 저장소
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.localMode: 로컬 모드 여부
 *
 * @returns {Tool} 생성된 shell 도구
 *
 * @example
 * // 파일 리스트
 * const tool = createShellTool(state, config);
 * await tool.invoke({ command: "ls -la", workdir: "/path/to/dir" });
 *
 * @example
 * // 테스트 실행
 * const tool = createShellTool(state, config);
 * await tool.invoke({ command: "yarn test", timeout: 120 });
 *
 * @example
 * // Git 상태 확인
 * const tool = createShellTool(state, config);
 * await tool.invoke({ command: "git status" });
 */
export function createShellTool(
  state: Pick<GraphState, "sandboxSessionId" | "targetRepository">,
  config: GraphConfig,
) {
  const shellTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      try {
        const { command, workdir, timeout } = input;

        const executor = createShellExecutor(config);
        const response = await executor.executeCommand({
          command,
          workdir,
          timeout: timeout ?? TIMEOUT_SEC,
          env: DEFAULT_ENV,
        });

        if (response.exitCode !== 0) {
          const errorResult = response.result ?? response.artifacts?.stdout;
          throw new Error(
            `명령이 실패했습니다. 종료 코드: ${response.exitCode}\n결과: ${errorResult}`,
          );
        }
        return {
          result: response.result ?? `종료 코드: ${response.exitCode}`,
          status: "success",
        };
      } catch (error: any) {
        const errorFields = getSandboxErrorFields(error);
        if (errorFields) {
          return {
            result: `오류: ${errorFields.result ?? errorFields.artifacts?.stdout}`,
            status: "error",
          };
        }

        return {
          result: `오류: ${error.message || String(error)}`,
          status: "error",
        };
      }
    },
    createShellToolFields(state.targetRepository),
  );

  return shellTool;
}
