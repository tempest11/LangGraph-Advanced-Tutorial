/**
 * @file types.ts
 * @description 이 파일은 Open SWE V2 에이전트 애플리케이션 전반에서 사용되는 핵심 TypeScript 타입과
 * Zod 스키마를 중앙에서 정의하고 관리합니다. 타입을 한 곳에 모아 관리함으로써 명령어 인자,
 * 상태 객체, 승인 워크플로우 등 다양한 컴포넌트 간의 데이터 구조를 일관되게 유지하고,
 * TypeScript의 정적 타입 검사를 통해 코드의 안정성과 신뢰성을 높입니다.
 */

import { z } from "zod";

/**
 * ===================================================================================
 * Open SWE V2 코딩 에이전트를 위한 타입 정의
 * ===================================================================================
 */

// ===================================================================================
// ## 명령어 인자 타입 (Command Argument Types)
// ===================================================================================
// 아래 인터페이스들은 각기 다른 도구(명령어)들이 받는 인자 객체의 형태를 정의합니다.
// 이를 통해 `AgentStateHelpers.getApprovalKey`와 같은 함수에서 인자 타입을 명확히 하고
// 안전하게 속성에 접근할 수 있습니다.

/** 파일 수정 관련 명령어(`write_file`, `edit_file` 등)의 인자 타입을 정의합니다. */
export interface FileEditCommandArgs {
  file_path?: string;
  path?: string;
}

/** `execute_bash` 명령어의 인자 타입을 정의합니다. */
export interface ExecuteBashCommandArgs {
  cwd?: string;
}

/** 파일 시스템 탐색 명령어(`ls`, `glob`, `grep`)의 인자 타입을 정의합니다. */
export interface FileSystemCommandArgs {
  path?: string;
  directory?: string;
}

/** 특정 카테고리에 속하지 않는 일반적인 명령어 인자를 위한 타입입니다. */
export interface GenericCommandArgs {
  [key: string]: any;
}

/**
 * 모든 가능한 명령어 인자 구조를 포괄하는 유니언 타입입니다.
 * 이를 통해 다양한 형태의 인자 객체를 단일 타입으로 처리할 수 있습니다.
 */
export type CommandArgs =
  | FileEditCommandArgs
  | ExecuteBashCommandArgs
  | FileSystemCommandArgs
  | GenericCommandArgs;

// ===================================================================================
// ## 명령어 이름 타입 (Command Name Types)
// ===================================================================================
// 아래 타입들은 다양한 명령어 카테고리에 속하는 유효한 도구(명령어) 이름을 문자열 리터럴로 정의합니다.

export type FileEditCommand =
  | "write_file"
  | "str_replace_based_edit_tool"
  | "edit_file";
export type ExecuteBashCommand = "execute_bash";
export type FileSystemCommand = "ls" | "glob" | "grep";
export type GenericCommand = string; // 다른 모든 명령어 이름을 포괄하는 대체 타입입니다.

/**
 * 시스템 내에서 사용될 수 있는 모든 유효한 명령어 이름의 유니언 타입입니다.
 */
export type Command =
  | FileEditCommand
  | ExecuteBashCommand
  | FileSystemCommand
  | GenericCommand;

// ===================================================================================
// ## 승인 시스템 타입 (Approval System Types)
// ===================================================================================

/**
 * 사용자 승인을 캐시하기 위해 `AgentStateHelpers.getApprovalKey` 함수가 생성하는
 * 고유한 문자열 키의 타입입니다. (예: 'execute_bash:/path/to/dir')
 */
export type ApprovalKey = string;

/**
 * 에이전트 상태의 `approved_operations` 필드의 구조를 정의하는 Zod 스키마입니다.
 * 이 스키마는 상태 객체의 형태를 검증하고, 기본값을 제공합니다.
 */
export const ApprovedOperationsSchema = z
  .object({
    /**
     * 사용자가 이미 승인한 작업들의 고유 키(`ApprovalKey`)를 저장하는 Set입니다.
     * Set을 사용하여 중복된 키 저장을 방지하고 빠른 조회(O(1))를 보장합니다.
     */
    cached_approvals: z.set(z.string()).default(() => new Set<string>()),
  })
  .optional();

/**
 * `ApprovedOperationsSchema` Zod 스키마로부터 추론된 TypeScript 타입입니다.
 * 에이전트 상태 내 `approved_operations` 객체의 타입을 나타냅니다.
 */
export type ApprovedOperations = z.infer<typeof ApprovedOperationsSchema>;

/**
 * (참고용) `AgentStateHelpers.getApprovalKey` 함수의 내부 로직과 반환 값의
 * 구조를 설명하기 위한 인터페이스입니다. 실제 코드에서는 사용되지 않습니다.
 */
export interface ApprovalKeyResult {
  command: Command;
  targetDir: string;
  normalizedDir: string;
  approvalKey: ApprovalKey;
}
