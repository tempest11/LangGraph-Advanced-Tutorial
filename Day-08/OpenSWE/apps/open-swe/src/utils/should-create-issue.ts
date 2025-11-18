/**
 * @file should-create-issue.ts
 * @description
 * GitHub Issue 자동 생성 여부를 판단하는 유틸리티 함수를 제공합니다.
 * 작업 완료 후 GitHub Issue를 생성할지 여부를 설정에서 확인합니다.
 */

import { GraphConfig } from "@openswe/shared/open-swe/types";

/**
 * GitHub Issue 생성 여부를 확인합니다.
 *
 * @description
 * GraphConfig의 `shouldCreateIssue` 설정을 확인하여 Issue 생성 여부를 반환합니다.
 * 설정이 명시적으로 `false`가 아닌 경우 기본적으로 `true`를 반환합니다.
 *
 * @param config - LangGraph 설정 객체
 * @returns Issue 생성 여부 (기본값: true)
 *
 * @example
 * if (shouldCreateIssue(config)) {
 *   await createGitHubIssue(...);
 * }
 */
export function shouldCreateIssue(config: GraphConfig): boolean {
  return config.configurable?.shouldCreateIssue !== false;
}
