/**
 * @file 구조화된 로깅 시스템
 * @description
 * Open SWE 애플리케이션 전체에서 사용되는 중앙 집중식 로깅 유틸리티입니다.
 * 컨텍스트별 색상 코딩, 로그 레벨 관리, LangGraph 실행 추적을 지원합니다.
 *
 * 주요 기능:
 * 1. 로그 레벨 제어 (DEBUG, INFO, WARN, ERROR)
 * 2. 컨텍스트별 자동 색상 할당 (개발 환경)
 * 3. LangGraph thread_id/run_id 자동 추적
 * 4. 환경별 로그 출력 제어 (프로덕션 vs 개발)
 *
 * 환경별 동작:
 * - 개발: 모든 레벨 로그 + 색상 출력
 * - 프로덕션: WARN, ERROR만 출력 + 색상 없음
 *
 * 사용 위치:
 * - 모든 노드, 도구, 유틸리티에서 로거 인스턴스 생성
 * - ESLint no-console 규칙 우회 (유일한 허용 지점)
 *
 * @example
 * const logger = createLogger(LogLevel.INFO, "MyComponent");
 * logger.info("Processing started", { itemCount: 10 });
 * logger.error("Failed to process", { error: err });
 */

/* eslint-disable no-console */

import { getConfig } from "@langchain/langgraph";

/**
 * 로그 레벨을 정의하는 Enum입니다.
 *
 * @description
 * 로그 출력 수준을 제어하여 필요한 정보만 표시합니다.
 * 레벨 순서: DEBUG < INFO < WARN < ERROR
 *
 * 레벨별 설명:
 * - DEBUG: 상세한 디버깅 정보 (개발 전용)
 * - INFO: 일반 정보성 메시지 (기본 레벨)
 * - WARN: 경고 메시지 (잠재적 문제)
 * - ERROR: 에러 메시지 (실제 문제)
 *
 * @enum {string}
 */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * ANSI 이스케이프 코드: 텍스트 스타일 리셋
 * 색상 및 스타일을 기본값으로 되돌립니다.
 */
const RESET = "\x1b[0m";

/**
 * ANSI 이스케이프 코드: 굵은 텍스트
 * 로그 접두사를 강조하기 위해 사용됩니다.
 */
const BOLD = "\x1b[1m";

/**
 * 로거 접두사에 사용할 ANSI 색상 코드 배열입니다.
 *
 * @description
 * 컨텍스트(로거 이름)마다 고유한 색상을 자동 할당하여
 * 터미널에서 로그를 시각적으로 구분하기 쉽게 합니다.
 *
 * 색상 할당:
 * - 로거 이름의 해시값을 배열 길이로 나눈 나머지로 색상 선택
 * - 동일한 이름은 항상 같은 색상 유지 (일관성)
 *
 * @constant {string[]}
 */
const COLORS = [
  "\x1b[31m",  // Red
  "\x1b[32m",  // Green
  "\x1b[33m",  // Yellow
  "\x1b[34m",  // Blue
  "\x1b[35m",  // Magenta
  "\x1b[36m",  // Cyan
  "\x1b[91m",  // Bright Red
  "\x1b[92m",  // Bright Green
  "\x1b[93m",  // Bright Yellow
  "\x1b[94m",  // Bright Blue
  "\x1b[95m",  // Bright Magenta
  "\x1b[96m",  // Bright Cyan
];

/**
 * 문자열을 양의 정수로 해싱하는 간단한 해시 함수입니다.
 *
 * @description
 * 로거 이름(prefix)을 COLORS 배열의 인덱스로 변환하기 위해 사용됩니다.
 * 동일한 문자열은 항상 동일한 해시값을 반환하여 색상 일관성을 보장합니다.
 *
 * 알고리즘:
 * 1. 각 문자의 ASCII 코드를 순회
 * 2. hash = (hash << 5) - hash + char (비트 시프트 최적화)
 * 3. 32비트 정수로 변환 (hash |= 0)
 * 4. 절댓값 반환 (양수 보장)
 *
 * @param {string} str - 해싱할 문자열 (로거 이름)
 * @returns {number} 양의 정수 해시값 (0 이상)
 *
 * @example
 * simpleHash("MyLogger") % COLORS.length; // 색상 인덱스
 */
function simpleHash(str: string): number {
  let hash = 0;
  if (str.length === 0) {
    return hash;
  }
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * LangGraph 설정에서 thread_id와 run_id를 안전하게 추출합니다.
 *
 * @description
 * 현재 실행 중인 LangGraph 그래프의 컨텍스트 ID를 가져옵니다.
 * 이 ID들은 로그에 자동으로 포함되어 특정 실행을 추적할 수 있게 합니다.
 *
 * 추출 프로세스:
 * 1. LangGraph의 getConfig() 호출
 * 2. config.configurable에서 thread_id, run_id 추출
 * 3. 실패 시 빈 객체 반환 (에러 발생 방지)
 *
 * 사용 시나리오:
 * - 그래프 노드 내부에서 실행: ID 반환
 * - 일반 유틸리티에서 실행: 빈 객체 반환
 *
 * @returns {{ thread_id?: string; run_id?: string }} 실행 컨텍스트 ID 또는 빈 객체
 *
 * @example
 * const ids = getThreadAndRunIds();
 * // { thread_id: "abc-123", run_id: "xyz-456" }
 */
function getThreadAndRunIds(): { thread_id?: string; run_id?: string } {
  try {
    const config = getConfig();
    return {
      thread_id: config.configurable?.thread_id,
      run_id: config.configurable?.run_id,
    };
  } catch {
    return {};
  }
}

/**
 * LangGraph 실행 ID를 선택적으로 포함하여 로그를 출력합니다.
 *
 * @description
 * 로그 메시지에 thread_id와 run_id를 자동으로 추가하여
 * 분산 실행 환경에서 로그를 추적할 수 있게 합니다.
 *
 * 출력 형식:
 * 1. ID 있음 + 데이터 있음: "[Prefix] message { data, thread_id, run_id }"
 * 2. ID 있음 + 데이터 없음: "[Prefix] message { thread_id, run_id }"
 * 3. ID 없음 + 데이터 있음: "[Prefix] message { data }"
 * 4. ID 없음 + 데이터 없음: "[Prefix] message"
 *
 * @param {string} styledPrefix - 색상이 적용된 로거 접두사 (예: "[Logger]")
 * @param {string} message - 로그 메시지 내용
 * @param {any} [data] - 추가 데이터 객체 (선택사항)
 *
 * @example
 * logWithOptionalIds("[API]", "Request received", { method: "POST" });
 * // [API] Request received { method: "POST", thread_id: "...", run_id: "..." }
 */
function logWithOptionalIds(styledPrefix: string, message: string, data?: any) {
  const ids = getThreadAndRunIds();
  if (Object.keys(ids).length > 0) {
    const logData = data !== undefined ? { ...data, ...ids } : ids;
    console.log(`${styledPrefix} ${message}`, logData);
  } else {
    if (data !== undefined) {
      console.log(`${styledPrefix} ${message}`, data);
    } else {
      console.log(`${styledPrefix} ${message}`);
    }
  }
}

/**
 * 컨텍스트별 로거 인스턴스를 생성하는 팩토리 함수입니다.
 *
 * @description
 * 각 컴포넌트, 노드, 도구마다 고유한 로거를 생성합니다.
 * 로그 레벨, 색상, 환경별 동작을 자동으로 설정합니다.
 *
 * 생성 프로세스:
 * 1. prefix 문자열을 해싱하여 색상 선택
 * 2. 환경에 따라 접두사 스타일 결정
 *    - 개발: 굵은 글씨 + 색상 + [prefix]
 *    - 프로덕션: 일반 텍스트 + [prefix]
 * 3. 4개의 로그 메서드를 가진 객체 반환
 *
 * 환경별 출력 제어:
 * - 개발: level에 따라 debug, info, warn, error
 * - 프로덕션: warn, error만 출력 (성능 최적화)
 *
 * @param {LogLevel} level - 이 로거가 출력할 최소 로그 레벨
 * @param {string} prefix - 로그 접두사 (컴포넌트/노드 이름)
 * @returns {Object} debug, info, warn, error 메서드를 가진 로거 객체
 *
 * @example
 * const logger = createLogger(LogLevel.INFO, "TakeAction");
 * logger.debug("This won't show at INFO level");
 * logger.info("Processing tool calls", { count: 5 });
 * logger.error("Tool execution failed", { error: err });
 */
export function createLogger(level: LogLevel, prefix: string) {
  const hash = simpleHash(prefix);
  const color = COLORS[hash % COLORS.length];

  const styledPrefix =
    process.env.NODE_ENV === "production"
      ? `[${prefix}]`
      : `${BOLD}${color}[${prefix}]${RESET}`;

  const isProduction = process.env.NODE_ENV === "production";

  return {
    debug: (message: string, data?: any) => {
      if (!isProduction && level === LogLevel.DEBUG) {
        logWithOptionalIds(styledPrefix, message, data);
      }
    },
    info: (message: string, data?: any) => {
      if (
        !isProduction &&
        (level === LogLevel.INFO || level === LogLevel.DEBUG)
      ) {
        logWithOptionalIds(styledPrefix, message, data);
      }
    },
    warn: (message: string, data?: any) => {
      if (
        level === LogLevel.WARN ||
        level === LogLevel.INFO ||
        level === LogLevel.DEBUG
      ) {
        logWithOptionalIds(styledPrefix, message, data);
      }
    },
    error: (message: string, data?: any) => {
      if (
        level === LogLevel.ERROR ||
        level === LogLevel.WARN ||
        level === LogLevel.INFO ||
        level === LogLevel.DEBUG
      ) {
        logWithOptionalIds(styledPrefix, message, data);
      }
    },
  };
}
