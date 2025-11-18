/**
 * @file 웹 문서 검색 도구
 * @description
 * FireCrawl과 LLM을 사용하여 웹 문서에서 자연어 쿼리로 정보를 추출하는 도구.
 *
 * 주요 기능:
 * 1. FireCrawl로 URL 크롤링 (마크다운 변환)
 * 2. 문서 캐싱 (documentCache에 저장하여 재사용)
 * 3. LLM 기반 정보 추출 (Hallucination 방지 프롬프트)
 * 4. 구조화된 결과 반환 (XML 형식)
 *
 * 처리 흐름:
 * 1. URL 파싱 및 검증
 * 2. 캐시 확인 → 없으면 FireCrawl로 크롤링
 * 3. LLM에 문서 + 쿼리 전달
 * 4. 추출된 정보 반환
 *
 * 사용 시나리오:
 * - Planner가 LangGraph 공식 문서 참조
 * - 라이브러리 API 사용법 검색
 * - 기술 문서에서 예제 코드 추출
 */

// LangChain 도구 생성 함수
import { tool } from "@langchain/core/tools";

// 로거 생성 유틸리티
import { createLogger, LogLevel } from "../../utils/logger.js";

// 도구 필드 정의 (도구 메타데이터)
import { createSearchDocumentForToolFields } from "@openswe/shared/open-swe/tools";

// FireCrawl 웹 크롤링 로더
import { FireCrawlLoader } from "@langchain/community/document_loaders/web/firecrawl";

// LLM 모델 로딩 유틸리티
import { loadModel } from "../../utils/llms/index.js";

// LLM 작업 타입 열거형
import { LLMTask } from "@openswe/shared/open-swe/llm-task";

// GraphConfig, GraphState 타입
import { GraphConfig, GraphState } from "@openswe/shared/open-swe/types";

// LangChain 메시지 콘텐츠를 문자열로 변환
import { getMessageContentString } from "@openswe/shared/messages";

// 문서 검색 LLM 프롬프트 템플릿
import { DOCUMENT_SEARCH_PROMPT } from "./prompt.js";

// URL 파싱 및 검증 유틸리티
import { parseUrl } from "../../utils/url-parser.js";

// Zod 스키마 검증 라이브러리
import { z } from "zod";

/**
 * 문서 검색 도구 로거
 *
 * @description
 * 문서 크롤링 및 검색 작업의 성공/실패를 추적하는 로거.
 * 캐시 히트/미스, 크롤링, LLM 호출 이벤트를 기록.
 *
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "SearchDocumentForTool");

/**
 * 문서 검색 도구 입력 타입
 *
 * @description
 * createSearchDocumentForToolFields의 Zod 스키마에서 추론된 타입.
 *
 * 필드:
 * - url: 검색할 웹 문서 URL
 * - query: 자연어 검색 쿼리
 *
 * @typedef {Object} SearchDocumentForInput
 */
type SearchDocumentForInput = z.infer<
  ReturnType<typeof createSearchDocumentForToolFields>["schema"]
>;

/**
 * 웹 문서 검색 도구 팩토리
 *
 * @description
 * URL에서 웹 문서를 크롤링하고 LLM으로 자연어 쿼리에 맞는 정보를 추출.
 *
 * 처리 흐름:
 * 1. URL 파싱 및 검증 (parseUrl)
 * 2. documentCache 확인:
 *    - 캐시 히트: 캐시된 내용 사용
 *    - 캐시 미스: FireCrawl로 크롤링 → 캐시 저장
 * 3. 빈 문서 검사 (내용 없으면 에러)
 * 4. LLM(SUMMARIZER)에 프롬프트 전달:
 *    - DOCUMENT_SEARCH_PROMPT 템플릿 사용
 *    - {DOCUMENT_PAGE_CONTENT}: 크롤링한 문서
 *    - {NATURAL_LANGUAGE_QUERY}: 사용자 쿼리
 * 5. LLM 응답 파싱 및 반환
 *
 * 캐싱 메커니즘:
 * - 같은 URL을 여러 번 검색해도 크롤링은 1회만 수행
 * - documentCache를 GraphState에 저장하여 전체 세션에서 공유
 * - stateUpdates로 캐시 업데이트 반환
 *
 * FireCrawl 설정:
 * - mode: "scrape" (단일 페이지 크롤링)
 * - formats: ["markdown"] (HTML → 마크다운 변환)
 *
 * @param {Pick<GraphState, "documentCache">} state - 그래프 상태 (문서 캐시)
 * @param {GraphConfig} config - 그래프 설정 (LLM 모델 선택)
 * @returns {Tool} 웹 문서 검색 도구
 *
 * @example
 * // LangGraph 문서에서 Send 사용법 검색
 * const tool = createSearchDocumentForTool(state, config);
 * const result = await tool.invoke({
 *   url: "https://langchain-ai.github.io/langgraph/concepts/low_level/#send",
 *   query: "How to use Send to route messages dynamically?"
 * });
 * // => { result: "<extracted_document_info>...</extracted_document_info>", status: "success" }
 */
export function createSearchDocumentForTool(
  state: Pick<GraphState, "documentCache">,
  config: GraphConfig,
) {
  const searchDocumentForTool = tool(
    async (
      input: SearchDocumentForInput,
    ): Promise<{
      result: string;
      status: "success" | "error";
      stateUpdates?: Partial<Pick<GraphState, "documentCache">>;
    }> => {
      const { url, query } = input;

      // === 1단계: URL 파싱 및 검증 ===
      const urlParseResult = parseUrl(url);
      if (!urlParseResult.success) {
        return { result: urlParseResult.errorMessage, status: "error" };
      }
      const parsedUrl = urlParseResult.url?.href;

      try {
        // === 2단계: 문서 캐시 확인 ===
        let documentContent = state.documentCache[parsedUrl];

        if (!documentContent) {
          // === 2-1: 캐시 미스 - FireCrawl로 크롤링 ===
          logger.info("Document not cached, fetching via FireCrawl", {
            url: parsedUrl,
          });

          // FireCrawl 로더 생성 (마크다운 형식으로 크롤링)
          const loader = new FireCrawlLoader({
            url: parsedUrl,
            mode: "scrape", // 단일 페이지 크롤링
            params: {
              formats: ["markdown"], // HTML → 마크다운 변환
            },
          });

          // 문서 로드 및 페이지 콘텐츠 결합
          const docs = await loader.load();
          documentContent = docs.map((doc) => doc.pageContent).join("\n\n");

          // === 2-2: 캐시 업데이트 및 stateUpdates 반환 ===
          if (state.documentCache) {
            const stateUpdates = {
              documentCache: {
                ...state.documentCache,
                [parsedUrl]: documentContent,
              },
            };
            return { result: documentContent, status: "success", stateUpdates };
          }
        } else {
          // === 2-3: 캐시 히트 - 캐시된 내용 사용 ===
          logger.info("Using cached document content", {
            url: parsedUrl,
            contentLength: documentContent.length,
          });
        }

        // === 3단계: 빈 문서 검사 ===
        if (!documentContent.trim()) {
          return {
            result: `No content found at URL: ${url}`,
            status: "error",
          };
        }

        // === 4단계: LLM 모델 로드 (SUMMARIZER) ===
        const model = await loadModel(config, LLMTask.SUMMARIZER);

        // === 5단계: 프롬프트 템플릿에 변수 대입 ===
        const searchPrompt = DOCUMENT_SEARCH_PROMPT.replace(
          "{DOCUMENT_PAGE_CONTENT}",
          documentContent,
        ).replace("{NATURAL_LANGUAGE_QUERY}", query);

        // === 6단계: LLM 호출 (정보 추출) ===
        const response = await model
          .withConfig({ tags: ["nostream"], runName: "document-search" })
          .invoke([
            {
              role: "user",
              content: searchPrompt,
            },
          ]);

        // === 7단계: 응답 파싱 ===
        const searchResult = getMessageContentString(response.content);

        // === 8단계: 성공 로깅 및 결과 반환 ===
        logger.info("Document search completed", {
          url,
          query,
          resultLength: searchResult.length,
        });

        return {
          result: searchResult,
          status: "success",
        };
      } catch (e) {
        // === 9단계: 에러 처리 ===
        const errorString = e instanceof Error ? e.message : String(e);
        logger.error("Failed to search document", {
          url: parsedUrl,
          query,
          error: errorString,
        });
        return {
          result: `Failed to search document at ${parsedUrl}\nError:\n${errorString}`,
          status: "error",
        };
      }
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createSearchDocumentForToolFields(),
  );

  return searchDocumentForTool;
}
