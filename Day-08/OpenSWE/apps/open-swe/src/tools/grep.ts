/**
 * @file Grep 검색 도구
 * @description
 * ripgrep(rg) 기반 파일 검색 도구입니다. 코드베이스에서 텍스트 패턴을 빠르게 검색합니다.
 *
 * 주요 기능:
 * - 정규 표현식 지원
 * - .gitignore 패턴 자동 존중
 * - 파일 타입 필터링 (glob 패턴)
 * - 대소문자 구분/무시 옵션
 * - 여러 줄 검색 지원
 *
 * ripgrep 장점:
 * - grep, ag보다 훨씬 빠른 검색 속도
 * - .gitignore 자동 존중으로 불필요한 파일 제외
 * - UTF-8 인코딩 자동 처리
 * - 바이너리 파일 자동 스킵
 *
 * 사용 예시:
 * - 함수 찾기: `createLogger`
 * - 정규식 검색: `function\s+\w+`
 * - 파일 타입 필터: `*.ts` (TypeScript만)
 * - 특정 디렉토리: `src/` 내부만 검색
 *
 * 종료 코드 처리:
 * - 0: 검색 성공, 결과 있음
 * - 1: 검색 성공, 결과 없음 (정상)
 * - >1: 검색 실패 (오류)
 */

// === LangChain Core ===
import { tool } from "@langchain/core/tools"; // 도구 생성 헬퍼

// === 타입 정의 ===
import { GraphState, GraphConfig } from "@openswe/shared/open-swe/types"; // 그래프 상태/설정

// === 유틸리티 ===
import { getSandboxErrorFields } from "../utils/sandbox-error-fields.js"; // 샌드박스 에러 필드 추출
import { createShellExecutor } from "../utils/shell-executor/index.js"; // Shell 실행기
import { wrapScript } from "../utils/wrap-script.js"; // 스크립트 래핑

// === 로깅 ===
import { createLogger, LogLevel } from "../utils/logger.js"; // 구조화된 로거

// === 상수 ===
import { TIMEOUT_SEC } from "@openswe/shared/constants"; // 기본 타임아웃

// === Git 유틸리티 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로

// === 로컬 모드 ===
import {
  isLocalMode,              // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리
} from "@openswe/shared/open-swe/local-mode";

// === 도구 필드 ===
import {
  createGrepToolFields, // Grep 도구 스키마
  formatGrepCommand,    // Grep 명령 포맷팅
} from "@openswe/shared/open-swe/tools";

/**
 * 로거 인스턴스
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "GrepTool");

/**
 * Grep 검색 도구를 생성합니다.
 *
 * @description
 * ripgrep(rg) 기반으로 코드베이스에서 텍스트 패턴을 빠르게 검색하는 도구를 생성합니다.
 * .gitignore 패턴을 자동으로 존중하며, 정규 표현식과 glob 패턴을 지원합니다.
 *
 * 처리 흐름:
 * 1. 입력으로부터 grep 명령 생성 (formatGrepCommand)
 * 2. 작업 디렉토리 결정 (로컬 vs 샌드박스)
 * 3. Shell 실행기로 명령 실행
 * 4. 종료 코드에 따라 결과 처리:
 *    - 0: 검색 성공, 결과 있음
 *    - 1: 검색 성공, 결과 없음 ("결과를 찾을 수 없습니다" 메시지)
 *    - >1: 검색 실패 (오류 throw)
 *
 * 입력 파라미터 (formatGrepCommand가 처리):
 * - query (string): 검색할 텍스트 또는 정규 표현식
 * - isRegex (boolean, optional): 정규 표현식 사용 여부
 * - caseInsensitive (boolean, optional): 대소문자 무시 여부
 * - includes (string[], optional): 검색할 파일 glob 패턴 (예: ["*.ts", "*.tsx"])
 * - searchPath (string, optional): 검색 경로 (기본값: 리포지토리 루트)
 *
 * 출력 형식:
 * - result (string): 검색 결과 (파일 경로, 줄 번호, 매칭된 텍스트)
 * - status ("success" | "error"): 실행 결과
 *
 * 종료 코드 처리:
 * - exitCode === 0: 정상, 결과 있음
 * - exitCode === 1: 정상, 결과 없음 ("결과를 찾을 수 없습니다" 추가)
 * - exitCode === 127 && "sh: 1: ": 명령 없음, 결과 없음으로 처리
 * - exitCode > 1: 오류, Error throw
 *
 * ripgrep 특징:
 * - .gitignore 자동 존중: node_modules, .git 등 자동 제외
 * - 빠른 속도: grep, ag보다 훨씬 빠름
 * - UTF-8 지원: 한글 등 유니코드 검색 가능
 * - 바이너리 파일 스킵: 이미지 등 자동 제외
 *
 * @param {Pick<GraphState, "sandboxSessionId" | "targetRepository">} state - 그래프 상태
 *   - sandboxSessionId: 샌드박스 세션 ID
 *   - targetRepository: 타겟 저장소
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.localMode: 로컬 모드 여부
 *
 * @returns {Tool} 생성된 grep 도구
 *
 * @example
 * // 함수 이름 검색
 * const tool = createGrepTool(state, config);
 * await tool.invoke({ query: "createLogger", searchPath: "src/" });
 *
 * @example
 * // 정규 표현식으로 함수 선언 찾기
 * const tool = createGrepTool(state, config);
 * await tool.invoke({
 *   query: "function\\s+\\w+",
 *   isRegex: true,
 *   includes: ["*.ts"]
 * });
 *
 * @example
 * // 대소문자 무시 검색
 * const tool = createGrepTool(state, config);
 * await tool.invoke({
 *   query: "TODO",
 *   caseInsensitive: true
 * });
 */
export function createGrepTool(
  state: Pick<GraphState, "sandboxSessionId" | "targetRepository">,
  config: GraphConfig,
) {
  const grepTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      try {
        const command = formatGrepCommand(input);
        const localMode = isLocalMode(config);
        const localAbsolutePath = getLocalWorkingDirectory();
        const sandboxAbsolutePath = getRepoAbsolutePath(state.targetRepository);
        const workDir = localMode ? localAbsolutePath : sandboxAbsolutePath;

        logger.info("grep 검색 명령 실행 중", {
          command: command.join(" "),
          workDir,
        });

        const executor = createShellExecutor(config);
        const response = await executor.executeCommand({
          command: wrapScript(command.join(" ")),
          workdir: workDir,
          timeout: TIMEOUT_SEC,
        });

        let successResult = response.result;

        if (
          response.exitCode === 1 ||
          (response.exitCode === 127 && response.result.startsWith("sh: 1: "))
        ) {
          const errorResult = response.result ?? response.artifacts?.stdout;
          successResult = `종료 코드 1. 결과를 찾을 수 없습니다.\n\n${errorResult}`;
        } else if (response.exitCode > 1) {
          const errorResult = response.result ?? response.artifacts?.stdout;
          throw new Error(
            `grep 검색 명령 실행 실패. 종료 코드: ${response.exitCode}\n오류: ${errorResult}`,
          );
        }

        return {
          result: successResult,
          status: "success",
        };
      } catch (e) {
        const errorFields = getSandboxErrorFields(e);
        if (errorFields) {
          const errorResult =
            errorFields.result ?? errorFields.artifacts?.stdout;
          return {
            result: `검색 명령 실행 실패. 종료 코드: ${errorFields.exitCode}\n오류: ${errorResult}`,
            status: "error" as const,
          };
        }

        const errorMessage = e instanceof Error ? e.message : String(e);
        return {
          result: `grep 검색 명령 실행 실패: ${errorMessage}`,
          status: "error" as const,
        };
      }
    },
    createGrepToolFields(state.targetRepository),
  );

  return grepTool;
}
