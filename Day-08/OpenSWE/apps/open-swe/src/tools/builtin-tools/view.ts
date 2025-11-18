/**
 * @file View 파일 내용 보기 도구
 * @description
 * 파일의 전체 또는 일부 내용을 보는 LangChain 도구.
 * 로컬 파일시스템과 클라우드 샌드박스 모두 지원.
 *
 * 주요 기능:
 * 1. 파일 전체 내용 읽기
 * 2. 특정 줄 범위 읽기 (view_range)
 * 3. 로컬/샌드박스 듀얼 모드 지원
 *
 * 모드별 처리:
 * - 로컬 모드: cat 명령으로 파일 읽기
 * - 샌드박스 모드: Daytona SDK + handleViewCommand
 *
 * 사용 시나리오:
 * - Planner가 코드베이스 탐색 시 파일 확인
 * - Programmer가 수정할 파일 내용 읽기
 * - Reviewer가 변경된 파일 검토
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

// View 도구 필드 정의 (도구 메타데이터)
import { createViewToolFields } from "@openswe/shared/open-swe/tools";

// View 명령 핸들러 (샌드박스 모드용)
import { handleViewCommand } from "./handlers.js";

// 로컬 모드 유틸리티
import {
  isLocalMode, // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리 경로
} from "@openswe/shared/open-swe/local-mode";

// 타임아웃 상수
import { TIMEOUT_SEC } from "@openswe/shared/constants";

// Shell 명령 실행기
import { createShellExecutor } from "../../utils/shell-executor/index.js";

/**
 * View 도구 로거
 *
 * @description
 * 파일 보기 작업의 성공/실패를 추적하는 로거.
 * INFO 레벨로 설정하여 중요 이벤트만 기록.
 *
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "ViewTool");

/**
 * View 파일 내용 보기 도구 팩토리
 *
 * @description
 * 파일의 전체 또는 특정 줄 범위의 내용을 읽는 LangChain 도구 생성.
 * 로컬 파일시스템과 Daytona 샌드박스를 모두 지원하는 듀얼 모드 구현.
 *
 * 처리 흐름:
 * 1. command 검증 ("view"만 허용)
 * 2. 작업 디렉토리 결정 (로컬 vs 샌드박스)
 * 3. 로컬 모드:
 *    - 샌드박스 경로 접두사 제거 (/home/daytona/project/ → 상대 경로)
 *    - cat 명령으로 파일 읽기
 * 4. 샌드박스 모드:
 *    - handleViewCommand로 처리
 *    - view_range 파라미터 지원 (특정 줄 범위)
 * 5. 결과 반환 (파일 내용 또는 에러)
 *
 * 경로 처리:
 * - 로컬 모드: /home/daytona/project/src/index.ts → src/index.ts
 * - 샌드박스 모드: 절대 경로 그대로 사용
 *
 * @param {Pick<GraphState, "sandboxSessionId" | "targetRepository">} state - 그래프 상태 (샌드박스 ID, 타겟 레포지토리)
 * @param {GraphConfig} config - 그래프 설정 (로컬/클라우드 모드)
 * @returns {Tool} 파일 내용 보기 도구
 *
 * @example
 * // 파일 전체 읽기
 * const tool = createViewTool(state, config);
 * const result = await tool.invoke({ command: "view", path: "src/index.ts" });
 *
 * @example
 * // 특정 줄 범위 읽기 (10-20줄)
 * const result = await tool.invoke({
 *   command: "view",
 *   path: "src/index.ts",
 *   view_range: [10, 20]
 * });
 */
export function createViewTool(
  state: Pick<GraphState, "sandboxSessionId" | "targetRepository">,
  config: GraphConfig,
) {
  const viewTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      try {
        // === 1단계: Input 파라미터 추출 및 검증 ===
        const { command, path, view_range } = input as any;

        // command가 "view"가 아니면 에러
        if (command !== "view") {
          throw new Error(`Unknown command: ${command}`);
        }

        // === 2단계: 작업 디렉토리 결정 ===
        // 로컬 모드면 로컬 디렉토리, 샌드박스 모드면 레포지토리 절대 경로
        const workDir = isLocalMode(config)
          ? getLocalWorkingDirectory()
          : getRepoAbsolutePath(state.targetRepository);

        let result: string;

        if (isLocalMode(config)) {
          // === 3단계: 로컬 모드 처리 ===
          // Shell executor 생성 (LocalShellExecutor)
          const executor = createShellExecutor(config);

          // === 3-1: 샌드박스 경로를 로컬 경로로 변환 ===
          // /home/daytona/project/src/index.ts → src/index.ts
          let localPath = path;
          if (path.startsWith("/home/daytona/project/")) {
            // 샌드박스 접두사 제거하여 상대 경로 추출
            localPath = path.replace("/home/daytona/project/", "");
          }
          const filePath = join(workDir, localPath);

          // === 3-2: cat 명령으로 파일 읽기 ===
          const response = await executor.executeCommand({
            command: `cat "${filePath}"`,
            workdir: workDir,
            timeout: TIMEOUT_SEC,
          });

          // === 3-3: Exit code 검증 ===
          if (response.exitCode !== 0) {
            throw new Error(`Failed to read file: ${response.result}`);
          }

          result = response.result;
        } else {
          // === 4단계: 샌드박스 모드 처리 ===
          // Daytona 샌드박스 객체 가져오기
          const sandbox = await getSandboxSessionOrThrow(input);

          // handleViewCommand로 파일 읽기 (view_range 지원)
          result = await handleViewCommand(sandbox, config, {
            path,
            workDir,
            viewRange: view_range as [number, number] | undefined,
          });
        }

        // === 5단계: 성공 로깅 및 결과 반환 ===
        logger.info(`View command executed successfully on ${path}`);
        return { result, status: "success" };
      } catch (error) {
        // === 6단계: 에러 처리 ===
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`View command failed: ${errorMessage}`);
        return {
          result: `Error: ${errorMessage}`,
          status: "error",
        };
      }
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createViewToolFields(state.targetRepository),
  );

  return viewTool;
}
