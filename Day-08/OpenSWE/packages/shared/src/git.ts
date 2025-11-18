/**
 * @file git.ts
 * @description Git 및 저장소 경로와 관련된 유틸리티 함수를 제공합니다.
 * 로컬 모드와 샌드박스 모드를 구분하여 대상 저장소의 절대 경로를 계산하는
 * 로직을 포함합니다.
 */

import { SANDBOX_ROOT_DIR } from "./constants.js";
import { TargetRepository, GraphConfig } from "./open-swe/types.js";
import {
  isLocalMode,
  getLocalWorkingDirectory,
} from "./open-swe/local-mode.js";

/**
 * 대상 저장소의 절대 경로를 반환합니다.
 * 로컬 모드인 경우 로컬 작업 디렉토리 경로를, 그렇지 않은 경우 샌드박스 내의
 * 저장소 경로를 반환합니다.
 * @param targetRepository - 대상 저장소 정보 (소유자, 저장소 이름 등).
 * @param config - 그래프 실행 설정. 로컬 모드 여부를 확인하는 데 사용됩니다.
 * @returns {string} 저장소의 절대 경로.
 * @throws {Error} 저장소 이름이 제공되지 않은 경우 에러를 발생시킵니다.
 */
export function getRepoAbsolutePath(
  targetRepository: TargetRepository,
  config?: GraphConfig,
): string {
  // 먼저 로컬 모드인지 확인합니다.
  if (config && isLocalMode(config)) {
    return getLocalWorkingDirectory();
  }

  const repoName = targetRepository.repo;
  if (!repoName) {
    throw new Error("저장소 이름이 제공되지 않았습니다.");
  }

  // 샌드박스 환경의 절대 경로를 구성합니다.
  return `${SANDBOX_ROOT_DIR}/${repoName}`;
}