/**
 * @file state.ts
 * @description Open SWE V2 에이전트의 LangGraph 상태 관리를 정의하는 파일입니다.
 * 이 파일은 `deepagents`의 기본 `DeepAgentState`를 확장하여, 사용자 승인 워크플로우를
 * 지원하기 위한 커스텀 필드(`approved_operations`)를 추가합니다. 또한, `AgentStateHelpers`
 * 클래스를 통해 승인 캐시를 효율적으로 관리(고유 키 생성, 승인 여부 확인, 신규 승인 추가 등)하는
 * 유틸리티 메서드를 제공하여 코드의 응집성과 재사용성을 높입니다.
 */

import "@langchain/langgraph/zod";
import { z } from "zod";
import { withLangGraph } from "@langchain/langgraph/zod";
import * as path from "path";
import { DeepAgentState } from "deepagents";
import { FILE_EDIT_COMMANDS } from "./constants.js";
import {
  Command,
  CommandArgs,
  ApprovalKey,
  FileEditCommandArgs,
  ExecuteBashCommandArgs,
  FileSystemCommandArgs,
  ApprovedOperations,
} from "./types.js";

// `deepagents`의 기본 `DeepAgentState`를 확장하여 이 프로젝트에 특화된 상태 필드를 추가합니다.
export const CodingAgentState: any = DeepAgentState.extend({
  /**
   * 사용자가 이미 승인한 민감한 명령어들의 캐시를 저장하는 필드입니다.
   * 이 캐시는 `Set<string>` 형태로, 동일한 작업에 대해 반복적으로 사용자에게
   * 승인을 요청하는 것을 방지하여 사용자 경험을 향상시킵니다.
   */
  approved_operations: withLangGraph(
    z.custom<ApprovedOperations>().optional(),
    {
      // 리듀서 함수는 상태가 업데이트될 때 새로운 값이 기존 값을 완전히 대체하도록 정의합니다.
      // 이를 통해 승인 목록의 병합 복잡성을 피하고 상태를 단순하게 유지합니다.
      reducer: {
        schema: z.custom<ApprovedOperations>().optional(),
        fn: (
          _state: ApprovedOperations | undefined,
          update: ApprovedOperations | undefined,
        ) => update,
      },
      // 상태의 기본값으로, `cached_approvals`를 빈 Set으로 초기화한 객체를 제공합니다.
      default: () => ({ cached_approvals: new Set<string>() }),
    },
  ),
});

// `CodingAgentState` Zod 스키마로부터 추론된 TypeScript 타입으로, 상태 객체의 타입을 정의합니다.
export type CodingAgentStateType = z.infer<typeof CodingAgentState>;

/**
 * 에이전트의 상태, 특히 명령어 승인 워크플로우와 관련된 부분을 관리하기 위한
 * 정적 헬퍼 메서드를 제공하는 클래스입니다. 이 클래스는 관련 로직을 중앙에서 관리하여
 * 코드의 일관성과 유지보수성을 높입니다.
 */
export class AgentStateHelpers {
  /**
   * 주어진 명령어와 인자에 대해 고유하고 결정적인 캐시 키를 생성합니다.
   * 이 키는 사용자 승인을 추적하고 캐시하는 데 사용됩니다. 키는 명령어 이름과
   * 정규화된 대상 디렉토리 경로의 조합으로 구성되어, 동일한 디렉토리 내에서
   * 수행되는 동일한 명령어는 같은 키를 갖도록 보장합니다.
   *
   * @param command - 승인을 확인할 명령어의 이름 (예: 'execute_bash').
   * @param args - 해당 명령어에 전달된 인자 객체.
   * @returns {ApprovalKey} 승인 캐싱에 사용될 고유한 문자열 키 (예: 'execute_bash:/path/to/dir').
   */
  static getApprovalKey(command: Command, args: CommandArgs): ApprovalKey {
    let targetDir: string | null = null;

    // 명령어 유형에 따라 승인의 범위를 결정할 대상 디렉토리를 추출합니다.
    if (FILE_EDIT_COMMANDS.has(command)) {
      const fileArgs = args as FileEditCommandArgs;
      const filePath = fileArgs.file_path || fileArgs.path;
      if (filePath) {
        targetDir = path.dirname(path.resolve(filePath));
      }
    } else if (command === "execute_bash") {
      const bashArgs = args as ExecuteBashCommandArgs;
      targetDir = bashArgs.cwd || process.cwd();
    } else if (["ls", "glob", "grep"].includes(command)) {
      const fsArgs = args as FileSystemCommandArgs;
      targetDir = fsArgs.path || fsArgs.directory || process.cwd();
    }

    // 특정 디렉토리가 식별되지 않은 경우, 현재 프로세스의 작업 디렉토리를 기본값으로 사용합니다.
    if (!targetDir) {
      targetDir = process.cwd();
    }

    // `path.normalize`를 사용하여 '..' 같은 상대 경로를 해석하고, 일관된 형식의 절대 경로를 얻습니다.
    const normalizedDir = path.normalize(targetDir);
    // 최종 키는 '명령어:정규화된_디렉토리' 형식의 문자열입니다.
    return `${command}:${normalizedDir}`;
  }

  /**
   * 특정 작업(명령어와 인자의 조합)이 현재 상태에서 이미 사용자에 의해 승인되었는지 확인합니다.
   *
   * @param state - 현재 에이전트의 상태 객체.
   * @param command - 검사할 명령어의 이름.
   * @param args - 해당 명령어에 전달된 인자 객체.
   * @returns {boolean} 작업이 이전에 승인되었다면 `true`, 그렇지 않으면 `false`를 반환합니다.
   */
  static isOperationApproved(
    state: CodingAgentStateType,
    command: Command,
    args: CommandArgs,
  ): boolean {
    if (
      !state.approved_operations ||
      !state.approved_operations.cached_approvals
    ) {
      return false;
    }

    const approvalKey = this.getApprovalKey(command, args);
    return state.approved_operations.cached_approvals.has(approvalKey);
  }

  /**
   * 새로운 작업을 에이전트 상태의 승인된 작업 캐시에 추가합니다.
   * 이 함수는 사용자가 민감한 작업을 승인한 직후 호출됩니다.
   *
   * @param state - 수정할 현재 에이전트의 상태 객체.
   * @param command - 승인된 명령어의 이름.
   * @param args - 해당 명령어에 전달된 인자 객체.
   */
  static addApprovedOperation(
    state: CodingAgentStateType,
    command: Command,
    args: CommandArgs,
  ): void {
    if (!state.approved_operations) {
      state.approved_operations = { cached_approvals: new Set<string>() };
    }

    if (!state.approved_operations.cached_approvals) {
      state.approved_operations.cached_approvals = new Set<string>();
    }

    const approvalKey = this.getApprovalKey(command, args);
    state.approved_operations.cached_approvals.add(approvalKey);
  }
}
