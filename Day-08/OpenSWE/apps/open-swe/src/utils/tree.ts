/**
 * @file tree.ts
 * @description
 * 디렉토리 트리 구조 생성 유틸리티 함수를 제공합니다.
 * 저장소의 파일 구조를 tree 명령어로 가져옵니다.
 */

import { getCurrentTaskInput } from "@langchain/langgraph";
import {
  GraphState,
  TargetRepository,
  GraphConfig,
} from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "./logger.js";
import path from "node:path";
import { SANDBOX_ROOT_DIR, TIMEOUT_SEC } from "@openswe/shared/constants";
import { getSandboxErrorFields } from "./sandbox-error-fields.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";
import { createShellExecutor } from "./shell-executor/index.js";

const logger = createLogger(LogLevel.INFO, "Tree");

/**
 * 트리 생성 실패 시 반환되는 메시지입니다.
 */
export const FAILED_TO_GENERATE_TREE_MESSAGE =
  "트리 생성에 실패했습니다. 다시 시도하십시오.";

/**
 * 코드베이스의 파일 트리를 생성합니다.
 * 로컬 모드와 샌드박스 모드를 모두 지원합니다.
 * @param config - 그래프 설정.
 * @param sandboxSessionId_ - 샌드박스 세션 ID (선택 사항).
 * @param targetRepository_ - 대상 저장소 (선택 사항).
 * @returns 파일 트리 문자열 또는 실패 메시지.
 */
export async function getCodebaseTree(
  config: GraphConfig,
  sandboxSessionId_?: string,
  targetRepository_?: TargetRepository,
): Promise<string> {
  try {
    const command = `git ls-files | tree --fromfile -L 3`;
    let sandboxSessionId = sandboxSessionId_;
    let targetRepository = targetRepository_;

    // 로컬 모드인지 확인
    if (isLocalMode(config)) {
      return getCodebaseTreeLocal(config);
    }

    // 샌드박스 세션 ID가 제공되지 않은 경우 현재 상태에서 가져오려고 시도합니다.
    if (!sandboxSessionId || !targetRepository) {
      try {
        const state = getCurrentTaskInput<GraphState>();
        // 제공된 샌드박스 세션 ID 및 대상 저장소를 선호합니다. 정의된 경우 상태로 대체합니다.
        sandboxSessionId = sandboxSessionId ?? state.sandboxSessionId;
        targetRepository = targetRepository ?? state.targetRepository;
      } catch {
        // LangGraph 인스턴스에서 실행되지 않았습니다. 계속합니다.
      }
    }

    if (!sandboxSessionId) {
      logger.error("트리 생성 실패: 샌드박스 세션 ID가 제공되지 않았습니다.");
      throw new Error("트리 생성 실패: 샌드박스 세션 ID가 제공되지 않았습니다.");
    }
    if (!targetRepository) {
      logger.error("트리 생성 실패: 대상 저장소가 제공되지 않았습니다.");
      throw new Error("트리 생성 실패: 대상 저장소가 제공되지 않았습니다.");
    }

    const executor = createShellExecutor(config);
    const repoDir = path.join(SANDBOX_ROOT_DIR, targetRepository.repo);
    const response = await executor.executeCommand({
      command,
      workdir: repoDir,
      timeout: TIMEOUT_SEC,
      sandboxSessionId,
    });

    if (response.exitCode !== 0) {
      logger.error("트리 생성 실패", {
        exitCode: response.exitCode,
        result: response.result ?? response.artifacts?.stdout,
      });
      throw new Error(
        `트리 생성 실패: ${response.result ?? response.artifacts?.stdout}`,
      );
    }

    return response.result;
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    logger.error("트리 생성 실패", {
      ...(errorFields ? { errorFields } : {}),
      ...(e instanceof Error
        ? {
            name: e.name,
            message: e.message,
            stack: e.stack,
          }
        : {}),
    });
    return FAILED_TO_GENERATE_TREE_MESSAGE;
  }
}

/**
 * ShellExecutor를 사용하는 로컬 버전의 getCodebaseTree입니다.
 * @param config - 그래프 설정.
 * @returns 파일 트리 문자열 또는 실패 메시지.
 */
async function getCodebaseTreeLocal(config: GraphConfig): Promise<string> {
  try {
    const executor = createShellExecutor(config);
    const command = `git ls-files | tree --fromfile -L 3`;

    const response = await executor.executeCommand({
      command,
      timeout: TIMEOUT_SEC,
    });

    if (response.exitCode !== 0) {
      logger.error("로컬 모드에서 트리 생성 실패", {
        exitCode: response.exitCode,
        result: response.result,
      });
      throw new Error(
        `로컬 모드에서 트리 생성 실패: ${response.result}`,
      );
    }

    return response.result;
  } catch (e) {
    logger.error("로컬 모드에서 트리 생성 실패", {
      ...(e instanceof Error
        ? {
            name: e.name,
            message: e.message,
            stack: e.stack,
          }
        : { error: e }),
    });
    return FAILED_TO_GENERATE_TREE_MESSAGE;
  }
}
