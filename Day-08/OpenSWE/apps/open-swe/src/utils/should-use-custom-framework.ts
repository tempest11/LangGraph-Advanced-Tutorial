/**
 * @file should-use-custom-framework.ts
 * @description
 * 사용자 정의 프레임워크 사용 여부를 판단하는 유틸리티 함수를 제공합니다.
 * 프로젝트가 커스텀 프레임워크를 사용하는지 설정에서 확인합니다.
 */

import { GraphConfig } from "@openswe/shared/open-swe/types";

/**
 * 사용자 정의 프레임워크 사용 여부를 확인합니다.
 *
 * @description
 * GraphConfig의 `customFramework` 설정을 확인하여 커스텀 프레임워크 사용 여부를 반환합니다.
 * 설정이 명시적으로 `true`인 경우에만 `true`를 반환하며, 기본값은 `false`입니다.
 *
 * @param config - LangGraph 설정 객체
 * @returns 커스텀 프레임워크 사용 여부 (기본값: false)
 *
 * @example
 * if (shouldUseCustomFramework(config)) {
 *   // 커스텀 프레임워크 전용 로직 실행
 * }
 */
export function shouldUseCustomFramework(config: GraphConfig): boolean {
  return config.configurable?.customFramework === true;
}
