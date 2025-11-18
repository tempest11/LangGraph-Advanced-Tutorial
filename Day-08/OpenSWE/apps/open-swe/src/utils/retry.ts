/**
 * @file retry.ts
 * @description
 * 비동기 함수에 재시도 로직을 적용하는 유틸리티 함수들을 제공합니다.
 * 네트워크 요청, API 호출 등 일시적 실패가 발생할 수 있는 작업에 사용됩니다.
 *
 * 주요 기능:
 * - 설정 가능한 재시도 횟수와 지연 시간
 * - 재시도 래퍼 함수 생성
 * - 마지막 에러 반환
 */

/**
 * 재시도 옵션 인터페이스입니다.
 *
 * @interface
 * @property {number} [retries] - 최대 재시도 횟수 (기본값: 3)
 * @property {number} [delay] - 재시도 사이의 지연 시간 (ms, 기본값: 0)
 */
interface RetryOptions {
  retries?: number;
  delay?: number;
}

/**
 * 재시도 로직을 적용하여 비동기 함수를 실행합니다.
 *
 * @description
 * 함수가 실패하면 설정된 횟수만큼 재시도합니다.
 * 모든 재시도가 실패하면 마지막 에러를 반환합니다.
 *
 * 동작 방식:
 * 1. 함수 실행 시도
 * 2. 성공하면 결과 반환
 * 3. 실패하면 지연 후 재시도
 * 4. 최대 재시도 횟수 도달 시 마지막 에러 반환
 *
 * @template T - 함수 반환 타입
 * @param fn - 실행할 비동기 함수
 * @param options - 재시도 설정 옵션
 * @returns 함수 실행 결과 또는 마지막 에러
 *
 * @example
 * const result = await withRetry(
 *   () => fetchDataFromAPI(),
 *   { retries: 3, delay: 1000 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T | Error | undefined> {
  const { retries = 3, delay = 0 } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === retries) {
        return lastError;
      }

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return lastError;
}

/**
 * 재시도 로직이 적용된 함수 래퍼를 생성합니다.
 *
 * @description
 * 주어진 비동기 함수를 재시도 로직으로 감싼 새로운 함수를 반환합니다.
 * 반환된 함수는 원본 함수와 동일한 시그니처를 유지하며,
 * 호출 시 자동으로 재시도 로직이 적용됩니다.
 *
 * 사용 사례:
 * - 자주 호출되는 API 함수에 재시도 로직 적용
 * - 불안정한 네트워크 환경에서의 데이터 요청
 * - 일시적 오류가 예상되는 작업
 *
 * @template T - 함수 인자 타입 배열
 * @template R - 함수 반환 타입
 * @param fn - 래핑할 비동기 함수
 * @param options - 재시도 설정 옵션
 * @returns 재시도 로직이 적용된 새 함수
 *
 * @example
 * const robustFetch = createRetryWrapper(
 *   fetchUser,
 *   { retries: 5, delay: 2000 }
 * );
 * const user = await robustFetch(userId);
 */
export function createRetryWrapper<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {},
): (...args: T) => Promise<R | Error | undefined> {
  return (...args: T) => withRetry(() => fn(...args), options);
}
