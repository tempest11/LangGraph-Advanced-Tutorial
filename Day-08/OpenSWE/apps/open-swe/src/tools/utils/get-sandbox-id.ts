/**
 * @file 샌드박스 세션 ID 추출 및 검증 유틸리티
 * @description
 * 도구 실행 시 필요한 샌드박스 세션 ID를 안전하게 가져오는 유틸리티 함수.
 *
 * 주요 기능:
 * 1. 다중 소스에서 샌드박스 ID 추출 (도구 input 또는 GraphState)
 * 2. ID 존재 여부 검증 (없으면 에러)
 * 3. Daytona SDK로 실제 샌드박스 객체 반환
 *
 * 사용 시나리오:
 * - Shell 명령 실행 전 샌드박스 확인
 * - 파일 조작 도구에서 샌드박스 접근
 * - 모든 샌드박스 기반 도구의 공통 전처리
 */

// LangGraph 현재 작업 입력 가져오기
import { getCurrentTaskInput } from "@langchain/langgraph";

// GraphState 타입 정의 (샌드박스 세션 ID 포함)
import { GraphState } from "@openswe/shared/open-swe/types";

// 로거 생성 유틸리티
import { createLogger, LogLevel } from "../../utils/logger.js";

// Daytona 샌드박스 클라이언트
import { daytonaClient } from "../../utils/sandbox.js";

// Daytona SDK 샌드박스 타입
import { Sandbox } from "@daytonaio/sdk";

/**
 * 샌드박스 세션 로거
 *
 * @description
 * 샌드박스 ID 추출 및 검증 과정에서 발생하는 에러를 추적.
 * INFO 레벨로 설정하여 중요한 실패만 기록.
 *
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "GetSandboxSessionOrThrow");

/**
 * 샌드박스 세션 ID를 추출하고 Sandbox 객체를 반환
 *
 * @description
 * 도구 실행 시 필요한 샌드박스 객체를 안전하게 가져오는 핵심 유틸리티.
 *
 * 처리 흐름:
 * 1. 도구의 input 파라미터에서 xSandboxSessionId 확인
 * 2. input에 없으면 GraphState에서 sandboxSessionId 추출
 * 3. ID가 없으면 에러 throw (샌드박스 필수)
 * 4. Daytona SDK로 샌드박스 객체 가져오기
 *
 * ID 우선순위:
 * - 1순위: input.xSandboxSessionId (도구 파라미터)
 * - 2순위: GraphState.sandboxSessionId (그래프 상태)
 *
 * @param {Record<string, unknown>} input - 도구 실행 시 전달된 입력 객체
 * @returns {Promise<Sandbox>} Daytona 샌드박스 객체
 * @throws {Error} 샌드박스 세션 ID가 없을 때
 *
 * @example
 * // Shell 도구에서 사용
 * const sandbox = await getSandboxSessionOrThrow(input);
 * await sandbox.exec({ command: "ls -la" });
 *
 * @example
 * // View 도구에서 사용
 * const sandbox = await getSandboxSessionOrThrow(input);
 * const content = await sandbox.readFile({ path: "/workspace/file.ts" });
 */
export async function getSandboxSessionOrThrow(
  input: Record<string, unknown>,
): Promise<Sandbox> {
  let sandboxSessionId = "";

  // === 1단계: 샌드박스 세션 ID 추출 ===
  // 도구의 input 파라미터에서 우선 확인
  if ("xSandboxSessionId" in input && input.xSandboxSessionId) {
    sandboxSessionId = input.xSandboxSessionId as string;
  } else {
    // input에 없으면 LangGraph의 현재 GraphState에서 가져오기
    const state = getCurrentTaskInput<GraphState>();
    sandboxSessionId = state.sandboxSessionId;
  }

  // === 2단계: ID 존재 여부 검증 ===
  // 샌드박스 ID가 없으면 도구 실행 불가 (에러)
  if (!sandboxSessionId) {
    logger.error("FAILED TO RUN COMMAND: No sandbox session ID provided");
    throw new Error("FAILED TO RUN COMMAND: No sandbox session ID provided");
  }

  // === 3단계: Daytona SDK로 샌드박스 객체 가져오기 ===
  // 실제 샌드박스 인스턴스 반환 (exec, readFile 등 사용 가능)
  const sandbox = await daytonaClient().get(sandboxSessionId);
  return sandbox;
}
