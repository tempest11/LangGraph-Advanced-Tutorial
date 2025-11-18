/**
 * @file langgraph-client.ts
 * @description
 * LangGraph SDK 클라이언트를 생성하는 유틸리티 함수를 제공합니다.
 * 로컬 또는 프로덕션 환경에서 LangGraph 서버에 연결하기 위한 클라이언트를 구성합니다.
 */

import { Client } from "@langchain/langgraph-sdk";

/**
 * LangGraph SDK 클라이언트를 생성합니다.
 *
 * @description
 * 환경 변수에서 URL과 API 키를 읽어 LangGraph 서버에 연결할 클라이언트를 생성합니다.
 *
 * 환경 변수:
 * - LANGGRAPH_PROD_URL: 프로덕션 LangGraph 서버 URL
 * - PORT: 로컬 서버 포트 (기본값: 2024)
 * - LANGGRAPH_API_KEY: LangGraph API 키 (includeApiKey=true일 때 필수)
 *
 * @param options - 클라이언트 생성 옵션
 * @param options.defaultHeaders - 기본 헤더
 * @param options.includeApiKey - API 키 포함 여부
 * @returns 생성된 LangGraph 클라이언트 인스턴스
 *
 * @throws {Error} includeApiKey=true이지만 LANGGRAPH_API_KEY가 없는 경우
 *
 * @example
 * const client = createLangGraphClient({ includeApiKey: true });
 */
export function createLangGraphClient(options?: {
  defaultHeaders?: Record<string, string>;
  includeApiKey?: boolean;
}) {
  // TODO: 포트 관련 문제가 해결된 후 이 필요성을 제거합니다.
  const productionUrl = process.env.LANGGRAPH_PROD_URL;
  const port = process.env.PORT ?? "2024";
  if (options?.includeApiKey && !process.env.LANGGRAPH_API_KEY) {
    throw new Error("LANGGRAPH_API_KEY를 찾을 수 없습니다.");
  }
  return new Client({
    ...(options?.includeApiKey && {
      apiKey: process.env.LANGGRAPH_API_KEY,
    }),
    apiUrl: productionUrl ?? `http://localhost:${port}`,
    defaultHeaders: options?.defaultHeaders,
  });
}
