/**
 * @file GitHub 이슈 라벨 유틸리티
 * @description
 * 환경별 (production/development) GitHub 이슈 라벨을 반환하는 유틸리티 함수들.
 *
 * 라벨 종류:
 * 1. open-swe: 기본 라벨 (사용자 승인 필요)
 * 2. open-swe-auto: 자동 승인 라벨
 * 3. open-swe-max: 최대 토큰 사용 라벨
 * 4. open-swe-max-auto: 최대 토큰 + 자동 승인
 *
 * 환경별 라벨:
 * - production: open-swe, open-swe-auto 등
 * - development: open-swe-dev, open-swe-auto-dev 등 (-dev 접미사)
 *
 * 사용 위치:
 * - api.ts: 이슈 라벨 필터링
 * - Manager 그래프: 트리거 조건 확인
 */

/**
 * 기본 Open SWE 라벨을 반환합니다.
 *
 * @description
 * 환경(NODE_ENV)에 따라 프로덕션/개발 라벨을 반환.
 * Manager 그래프가 이 라벨이 있는 이슈에 대해 Planner를 시작합니다.
 *
 * @returns {"open-swe" | "open-swe-dev"} 환경별 라벨
 *
 * @example
 * const label = getOpenSWELabel();
 * // production: "open-swe"
 * // development: "open-swe-dev"
 */
export function getOpenSWELabel(): "open-swe" | "open-swe-dev" {
  return process.env.NODE_ENV === "production" ? "open-swe" : "open-swe-dev";
}

/**
 * 자동 승인 Open SWE 라벨을 반환합니다.
 *
 * @description
 * Planner의 계획 제안을 자동으로 승인하는 라벨.
 * 사용자 인터럽트 없이 바로 Programmer가 시작됩니다.
 *
 * @returns {"open-swe-auto" | "open-swe-auto-dev"} 환경별 자동 승인 라벨
 *
 * @example
 * const autoLabel = getOpenSWEAutoAcceptLabel();
 * // production: "open-swe-auto"
 * // development: "open-swe-auto-dev"
 */
export function getOpenSWEAutoAcceptLabel():
  | "open-swe-auto"
  | "open-swe-auto-dev" {
  return process.env.NODE_ENV === "production"
    ? "open-swe-auto"
    : "open-swe-auto-dev";
}

/**
 * 최대 토큰 사용 라벨을 반환합니다.
 *
 * @description
 * 더 많은 LLM 토큰을 사용하여 복잡한 작업을 처리하는 라벨.
 * 일반 모드보다 긴 대화와 더 많은 컨텍스트를 허용합니다.
 *
 * @returns {"open-swe-max" | "open-swe-max-dev"} 환경별 최대 모드 라벨
 *
 * @example
 * const maxLabel = getOpenSWEMaxLabel();
 * // production: "open-swe-max"
 * // development: "open-swe-max-dev"
 */
export function getOpenSWEMaxLabel(): "open-swe-max" | "open-swe-max-dev" {
  return process.env.NODE_ENV === "production"
    ? "open-swe-max"
    : "open-swe-max-dev";
}

/**
 * 최대 토큰 + 자동 승인 라벨을 반환합니다.
 *
 * @description
 * 최대 토큰 사용 + 자동 승인이 결합된 라벨.
 * 복잡한 작업을 사용자 인터럽트 없이 처리합니다.
 *
 * @returns {"open-swe-max-auto" | "open-swe-max-auto-dev"} 환경별 최대+자동 라벨
 *
 * @example
 * const maxAutoLabel = getOpenSWEMaxAutoAcceptLabel();
 * // production: "open-swe-max-auto"
 * // development: "open-swe-max-auto-dev"
 */
export function getOpenSWEMaxAutoAcceptLabel():
  | "open-swe-max-auto"
  | "open-swe-max-auto-dev" {
  return process.env.NODE_ENV === "production"
    ? "open-swe-max-auto"
    : "open-swe-max-auto-dev";
}
