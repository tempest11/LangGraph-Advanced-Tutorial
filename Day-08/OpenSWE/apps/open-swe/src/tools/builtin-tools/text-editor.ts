/**
 * @file Text Editor 파일 편집 통합 도구
 * @description
 * 4가지 파일 편집 명령(view, str_replace, create, insert)을 통합한 LangChain 도구.
 * 로컬/샌드박스 듀얼 모드 지원으로 유연한 파일 조작 제공.
 *
 * 주요 기능:
 * 1. view: 파일 내용 보기 (전체 또는 줄 범위 지정)
 * 2. str_replace: 정확한 문자열 교체 (sed 또는 handler)
 * 3. create: 새 파일 생성 (덮어쓰기 방지)
 * 4. insert: 특정 줄에 텍스트 삽입
 *
 * 모드별 구현:
 * - 로컬 모드: Shell 명령어 (cat, sed, echo) + LocalShellExecutor
 * - 샌드박스 모드: Daytona SDK + handlers.ts 함수들
 *
 * 경로 처리:
 * - 샌드박스 경로(/home/daytona/project/) → 로컬 상대 경로 자동 변환
 * - 로컬 경로(/home/daytona/local/) → 로컬 상대 경로 자동 변환
 *
 * 사용 시나리오:
 * - Programmer: 코드 수정, 새 파일 생성
 * - Planner: 설정 파일 확인 (view)
 * - Reviewer: 변경 사항 확인
 *
 * 안전성:
 * - create: 기존 파일 덮어쓰기 방지
 * - str_replace: 정확한 매칭 강제 (샌드박스 모드)
 * - 입력 파라미터 검증 (필수 필드 확인)
 */

// Node.js path 모듈 (경로 조합)
import { join } from "path";

// LangChain 도구 생성 함수
import { tool } from "@langchain/core/tools";

// GraphState, GraphConfig 타입
import { GraphState, GraphConfig } from "@openswe/shared/open-swe/types";

// 로거 생성 유틸리티
import { createLogger, LogLevel } from "../../utils/logger.js";

// Git 레포지토리 절대 경로 가져오기
import { getRepoAbsolutePath } from "@openswe/shared/git";

// 샌드박스 세션 ID 추출 유틸리티
import { getSandboxSessionOrThrow } from "../utils/get-sandbox-id.js";

// Text Editor 도구 필드 정의 (도구 메타데이터)
import { createTextEditorToolFields } from "@openswe/shared/open-swe/tools";

// 샌드박스 모드 명령 핸들러들
import {
  handleViewCommand, // 파일 보기 핸들러
  handleStrReplaceCommand, // 문자열 교체 핸들러
  handleCreateCommand, // 파일 생성 핸들러
  handleInsertCommand, // 줄 삽입 핸들러
} from "./handlers.js";

// 로컬 모드 유틸리티
import {
  isLocalMode, // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리 경로
} from "@openswe/shared/open-swe/local-mode";

// 타임아웃 상수
import { TIMEOUT_SEC } from "@openswe/shared/constants";

// 로컬 Shell 실행기
import { getLocalShellExecutor } from "../../utils/shell-executor/index.js";

/**
 * Text Editor 도구 로거
 *
 * @description
 * 파일 편집 작업의 성공/실패를 추적하는 로거.
 * 각 명령(view, str_replace, create, insert)의 실행 결과 기록.
 *
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "TextEditorTool");

/**
 * Text Editor 통합 도구 팩토리
 *
 * @description
 * 4가지 파일 편집 명령을 제공하는 통합 LangChain 도구 생성.
 * 로컬 모드와 샌드박스 모드를 모두 지원하는 듀얼 구현.
 *
 * 처리 흐름:
 * 1. 입력 파라미터 추출 (command, path, 명령별 파라미터)
 * 2. 모드 판단 (로컬 vs 샌드박스)
 * 3. 작업 디렉토리 결정
 * 4. 로컬 모드:
 *    - LocalShellExecutor 생성
 *    - 경로 변환 (샌드박스 → 로컬)
 *    - 명령별 Shell 명령 실행 (cat, sed, echo)
 * 5. 샌드박스 모드:
 *    - 샌드박스 세션 가져오기
 *    - 명령별 핸들러 호출 (handlers.ts)
 * 6. 결과 반환
 *
 * 지원 명령:
 * - view: 파일 내용 보기
 *   - 파라미터: path, view_range (optional)
 *   - 로컬: cat
 *   - 샌드박스: handleViewCommand
 *
 * - str_replace: 문자열 교체
 *   - 파라미터: path, old_str, new_str
 *   - 로컬: sed -i (글로벌 교체)
 *   - 샌드박스: handleStrReplaceCommand (정확히 1개 매칭)
 *
 * - create: 새 파일 생성
 *   - 파라미터: path, file_text
 *   - 로컬: echo (덮어쓰기 가능)
 *   - 샌드박스: handleCreateCommand (덮어쓰기 방지)
 *
 * - insert: 특정 줄에 텍스트 삽입
 *   - 파라미터: path, insert_line, new_str
 *   - 로컬: sed -i (줄 번호 삽입)
 *   - 샌드박스: handleInsertCommand
 *
 * 경로 변환 (로컬 모드):
 * - /home/daytona/project/src/index.ts → src/index.ts
 * - /home/daytona/local/src/index.ts → src/index.ts
 * - 상대 경로는 그대로 사용
 *
 * 문자열 이스케이프 (로컬 모드):
 * - 백슬래시: \\ → \\\\
 * - 슬래시: / → \\/
 * - 작은따옴표: ' → '"'"'
 *
 * @param {Pick<GraphState, "sandboxSessionId" | "targetRepository">} state - 그래프 상태 (샌드박스 ID, 타겟 레포지토리)
 * @param {GraphConfig} config - 그래프 설정 (로컬/클라우드 모드)
 * @returns {Tool} 파일 편집 통합 도구
 *
 * @example
 * // 파일 보기
 * const tool = createTextEditorTool(state, config);
 * await tool.invoke({ command: "view", path: "src/index.ts" });
 *
 * @example
 * // 문자열 교체
 * await tool.invoke({
 *   command: "str_replace",
 *   path: "src/index.ts",
 *   old_str: "const x = 10;",
 *   new_str: "const x = 20;"
 * });
 *
 * @example
 * // 새 파일 생성
 * await tool.invoke({
 *   command: "create",
 *   path: "src/newFile.ts",
 *   file_text: "export const newFunction = () => {};"
 * });
 *
 * @example
 * // 줄 삽입
 * await tool.invoke({
 *   command: "insert",
 *   path: "src/index.ts",
 *   insert_line: 0,
 *   new_str: "import { tool } from '@langchain/core/tools';"
 * });
 */
export function createTextEditorTool(
  state: Pick<GraphState, "sandboxSessionId" | "targetRepository">,
  config: GraphConfig,
) {
  const textEditorTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      try {
        // === 1단계: Input 파라미터 추출 ===
        const {
          command,
          path,
          view_range,
          old_str,
          new_str,
          file_text,
          insert_line,
        } = input;

        // === 2단계: 모드 및 작업 디렉토리 결정 ===
        const localMode = isLocalMode(config);
        const localAbsolutePath = getLocalWorkingDirectory();
        const sandboxAbsolutePath = getRepoAbsolutePath(state.targetRepository);
        const workDir = localMode ? localAbsolutePath : sandboxAbsolutePath;
        let result: string;

        if (localMode) {
          // === 3단계: 로컬 모드 처리 ===
          // LocalShellExecutor 생성
          const executor = getLocalShellExecutor(localAbsolutePath);

          // === 3-1: 샌드박스 경로 → 로컬 경로 변환 ===
          let localPath = path;
          if (path.startsWith("/home/daytona/project/")) {
            // 샌드박스 접두사 제거
            localPath = path.replace("/home/daytona/project/", "");
          } else if (path.startsWith("/home/daytona/local/")) {
            // 로컬 샌드박스 접두사 제거
            localPath = path.replace("/home/daytona/local/", "");
          }
          const filePath = join(workDir, localPath);

          // === 3-2: 명령별 Shell 명령 실행 ===
          switch (command) {
            case "view": {
              // cat 명령으로 파일 내용 읽기
              const viewResponse = await executor.executeCommand(
                `cat "${filePath}"`,
                {
                  workdir: workDir,
                  timeout: TIMEOUT_SEC,
                  localMode: true,
                },
              );
              if (viewResponse.exitCode !== 0) {
                throw new Error(`Failed to read file: ${viewResponse.result}`);
              }
              result = viewResponse.result;
              break;
            }
            case "str_replace": {
              // === str_replace: sed 명령으로 문자열 교체 ===
              if (!old_str || new_str === undefined) {
                throw new Error(
                  "str_replace command requires both old_str and new_str parameters",
                );
              }

              // 정규식 특수 문자 이스케이프 (sed 용)
              const escapedOldStr = old_str
                .replace(/\\/g, "\\\\") // 백슬래시
                .replace(/\//g, "\\/") // 슬래시
                .replace(/'/g, "'\"'\"'"); // 작은따옴표

              const escapedNewStr = new_str
                .replace(/\\/g, "\\\\")
                .replace(/\//g, "\\/")
                .replace(/'/g, "'\"'\"'");

              // sed -i: 파일 내용 직접 수정 (글로벌 교체)
              const sedResponse = await executor.executeCommand(
                `sed -i 's/${escapedOldStr}/${escapedNewStr}/g' "${filePath}"`,
                {
                  workdir: workDir,
                  timeout: TIMEOUT_SEC,
                  localMode: true,
                },
              );
              if (sedResponse.exitCode !== 0) {
                throw new Error(
                  `Failed to replace string: ${sedResponse.result}`,
                );
              }
              result = `Successfully replaced '${old_str}' with '${new_str}' in ${path}`;
              break;
            }
            case "create": {
              // === create: echo 명령으로 파일 생성 ===
              if (!file_text) {
                throw new Error("create command requires file_text parameter");
              }

              // 문자열 이스케이프 (Shell 용)
              const escapedFileText = file_text
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "'\"'\"'");

              // echo: 파일에 내용 쓰기 (덮어쓰기 가능)
              const createResponse = await executor.executeCommand(
                `echo '${escapedFileText}' > "${filePath}"`,
                {
                  workdir: workDir,
                  timeout: TIMEOUT_SEC,
                  localMode: true,
                },
              );
              if (createResponse.exitCode !== 0) {
                throw new Error(
                  `Failed to create file: ${createResponse.result}`,
                );
              }
              result = `Successfully created file ${path}`;
              break;
            }
            case "insert": {
              // === insert: sed 명령으로 줄 삽입 ===
              if (insert_line === undefined || new_str === undefined) {
                throw new Error(
                  "insert command requires both insert_line and new_str parameters",
                );
              }

              // 문자열 이스케이프 (sed 용)
              const escapedNewStr = new_str
                .replace(/\\/g, "\\\\")
                .replace(/\//g, "\\/")
                .replace(/'/g, "'\"'\"'");

              // sed -i: 특정 줄에 텍스트 삽입
              const insertResponse = await executor.executeCommand(
                `sed -i '${insert_line}i\\${escapedNewStr}' "${filePath}"`,
                {
                  workdir: workDir,
                  timeout: TIMEOUT_SEC,
                  localMode: true,
                },
              );
              if (insertResponse.exitCode !== 0) {
                throw new Error(
                  `Failed to insert line: ${insertResponse.result}`,
                );
              }
              result = `Successfully inserted line at position ${insert_line} in ${path}`;
              break;
            }
            default:
              throw new Error(`Unknown command: ${command}`);
          }
        } else {
          // === 4단계: 샌드박스 모드 처리 ===
          // Daytona 샌드박스 객체 가져오기
          const sandbox = await getSandboxSessionOrThrow(input);

          // === 4-1: 명령별 핸들러 호출 (handlers.ts) ===
          switch (command) {
            case "view":
              result = await handleViewCommand(sandbox, config, {
                path,
                workDir,
                viewRange: view_range,
              });
              break;
            case "str_replace":
              if (!old_str || new_str === undefined) {
                throw new Error(
                  "str_replace command requires both old_str and new_str parameters",
                );
              }
              result = await handleStrReplaceCommand(sandbox, config, {
                path,
                workDir,
                oldStr: old_str,
                newStr: new_str,
              });
              break;
            case "create":
              if (!file_text) {
                throw new Error("create command requires file_text parameter");
              }
              result = await handleCreateCommand(sandbox, config, {
                path,
                workDir,
                fileText: file_text,
              });
              break;
            case "insert":
              if (insert_line === undefined || new_str === undefined) {
                throw new Error(
                  "insert command requires both insert_line and new_str parameters",
                );
              }
              result = await handleInsertCommand(sandbox, config, {
                path,
                workDir,
                insertLine: insert_line,
                newStr: new_str,
              });
              break;
            default:
              throw new Error(`Unknown command: ${command}`);
          }
        }

        // === 5단계: 성공 로깅 및 결과 반환 ===
        logger.info(
          `Text editor command '${command}' executed successfully on ${path}`,
        );
        return { result, status: "success" };
      } catch (error) {
        // === 6단계: 에러 처리 ===
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Text editor command failed: ${errorMessage}`);
        return {
          result: `Error: ${errorMessage}`,
          status: "error",
        };
      }
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createTextEditorToolFields(state.targetRepository, config),
  );

  return textEditorTool;
}
