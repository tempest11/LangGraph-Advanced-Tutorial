/**
 * @file local-mode.ts
 * @description 이 파일은 에이전트가 로컬 파일 시스템에서 실행 중인지(로컬 모드) 아니면
 * 샌드박스 환경에서 실행 중인지 확인하고, 로컬 모드일 경우 작업 디렉토리 경로를
 * 가져오는 유틸리티 함수들을 제공합니다.
 */

import { GraphConfig } from "@openswe/shared/open-swe/types";

/**
 * 현재 실행 컨텍스트가 로컬 모드인지 확인합니다.
 * 로컬 모드는 샌드박스/Daytona 대신 로컬 파일에 대해 작업하는 것을 의미합니다.
 * @param config - 그래프 실행 설정 객체.
 * @returns {boolean} 로컬 모드이면 true를 반환합니다.
 */
export function isLocalMode(config?: GraphConfig): boolean {
  if (!config) {
    // config 객체가 없으면 환경 변수를 통해 확인합니다.
    return isLocalModeFromEnv();
  }
  // `configurable` 객체 내의 `x-local-mode` 플래그를 확인합니다.
  return (config.configurable as any)?.["x-local-mode"] === "true";
}

/**
 * 로컬 모드 작업의 로컬 작업 디렉토리를 가져옵니다.
 * 환경 변수에 지정되지 않은 경우 현재 프로세스의 작업 디렉토리를 기본값으로 합니다.
 * @returns {string} 로컬 작업 디렉토리의 경로.
 */
export function getLocalWorkingDirectory(): string {
  return (
    process.env.OPEN_SWE_LOCAL_PROJECT_PATH ||
    process.env.OPEN_SWE_PROJECT_PATH ||
    process.cwd()
  );
}

/**
 * 환경 변수를 기반으로 로컬 모드인지 확인합니다.
 * (GraphConfig를 사용할 수 없는 컨텍스트에서 유용합니다.)
 * @returns {boolean} `OPEN_SWE_LOCAL_MODE` 환경 변수가 "true"이면 true를 반환합니다.
 */
export function isLocalModeFromEnv(): boolean {
  return process.env.OPEN_SWE_LOCAL_MODE === "true";
}