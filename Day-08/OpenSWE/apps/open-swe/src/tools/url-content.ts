/**
 * @file URL 컨텐츠 가져오기 도구
 * @description
 * FireCrawl을 사용하여 웹 페이지의 컨텐츠를 Markdown 형식으로 가져옵니다.
 * 문서 캐싱을 통해 동일한 URL에 대한 중복 요청을 방지합니다.
 *
 * 주요 기능:
 * - FireCrawl API를 통한 웹 스크래핑
 * - HTML → Markdown 자동 변환
 * - documentCache를 통한 캐싱
 * - URL 유효성 검증
 * - 빈 컨텐츠 감지
 *
 * FireCrawl 특징:
 * - JavaScript 렌더링 지원 (SPA 대응)
 * - 광고/팝업 자동 제거
 * - 깨끗한 Markdown 출력
 * - 페이지 메타데이터 추출
 *
 * 사용 시나리오:
 * - Planner: 외부 문서 참조 (API 문서, 가이드)
 * - Programmer: 라이브러리 문서 확인
 * - Reviewer: 관련 리소스 검토
 *
 * 캐싱 전략:
 * - 첫 요청: FireCrawl API 호출 → 캐시 저장
 * - 이후 요청: 캐시에서 즉시 반환
 * - stateUpdates로 그래프 상태에 캐시 업데이트
 */

// === LangChain Core ===
import { tool } from "@langchain/core/tools"; // 도구 생성 헬퍼

// === 로깅 ===
import { createLogger, LogLevel } from "../utils/logger.js"; // 구조화된 로거

// === 도구 필드 ===
import { createGetURLContentToolFields } from "@openswe/shared/open-swe/tools"; // URL 도구 스키마

// === FireCrawl Loader ===
import { FireCrawlLoader } from "@langchain/community/document_loaders/web/firecrawl"; // 웹 스크래핑

// === 타입 정의 ===
import { GraphState } from "@openswe/shared/open-swe/types"; // 그래프 상태

// === 유틸리티 ===
import { parseUrl } from "../utils/url-parser.js"; // URL 파싱 및 검증

/**
 * 로거 인스턴스
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "GetURLContentTool");

/**
 * URL 컨텐츠 가져오기 도구를 생성합니다.
 *
 * @description
 * FireCrawl API를 사용하여 웹 페이지를 스크래핑하고 Markdown으로 변환합니다.
 * documentCache를 통해 동일 URL에 대한 중복 요청을 방지합니다.
 *
 * 처리 흐름:
 * 1. URL 파싱 및 유효성 검증
 * 2. 캐시 확인:
 *    - 캐시 있음: 즉시 반환
 *    - 캐시 없음: FireCrawl API 호출
 * 3. FireCrawl 스크래핑:
 *    - mode: "scrape" (단일 페이지)
 *    - formats: ["markdown"] (Markdown 변환)
 * 4. 캐시 업데이트 (stateUpdates)
 * 5. 빈 컨텐츠 확인
 * 6. 결과 반환
 *
 * 캐싱 메커니즘:
 * - 캐시 키: 파싱된 URL (href)
 * - 캐시 저장: stateUpdates.documentCache
 * - 캐시 재사용: 동일 URL 재요청 시 API 호출 없이 즉시 반환
 *
 * FireCrawl 설정:
 * - mode: "scrape" - 단일 페이지 스크래핑
 * - formats: ["markdown"] - Markdown 형식으로 변환
 * - JavaScript 렌더링 자동 처리
 * - 광고/팝업 자동 제거
 *
 * stateUpdates 반환:
 * - documentCache: 업데이트된 캐시 객체
 * - LangGraph가 자동으로 상태에 병합
 * - 다음 노드에서 캐시 사용 가능
 *
 * 오류 처리:
 * - URL 파싱 실패: parseUrl 에러 메시지
 * - FireCrawl 실패: API 에러 메시지
 * - 빈 컨텐츠: "콘텐츠를 찾을 수 없습니다" 메시지
 *
 * @param {Pick<GraphState, "documentCache">} state - 그래프 상태
 *   - documentCache: URL → 컨텐츠 매핑 객체
 *
 * @returns {Tool} 생성된 get_url_content 도구
 *   - result: 웹 페이지 컨텐츠 (Markdown)
 *   - status: "success" | "error"
 *   - stateUpdates: 업데이트된 documentCache (캐시 미스 시에만)
 *
 * @example
 * // 첫 요청 (캐시 미스)
 * const tool = createGetURLContentTool(state);
 * const result = await tool.invoke({ url: "https://docs.python.org/3/" });
 * // → FireCrawl API 호출
 * // → result.stateUpdates.documentCache에 저장
 *
 * @example
 * // 두 번째 요청 (캐시 히트)
 * const result2 = await tool.invoke({ url: "https://docs.python.org/3/" });
 * // → 캐시에서 즉시 반환
 * // → stateUpdates 없음
 *
 * @example
 * // URL 파싱 오류
 * const result = await tool.invoke({ url: "invalid-url" });
 * // → { result: "유효하지 않은 URL...", status: "error" }
 */
export function createGetURLContentTool(
  state: Pick<GraphState, "documentCache">,
) {
  const getURLContentTool = tool(
    async (
      input,
    ): Promise<{
      result: string;
      status: "success" | "error";
      stateUpdates?: Partial<Pick<GraphState, "documentCache">>;
    }> => {
      const { url } = input;

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
          logger.info("문서가 캐시되지 않았으므로 FireCrawl을 통해 가져옵니다.", {
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

          // === 2-2: 문서 로드 및 페이지 콘텐츠 결합 ===
          const docs = await loader.load();
          documentContent = docs.map((doc) => doc.pageContent).join("\n\n");

          // === 2-3: 캐시 업데이트 및 stateUpdates 반환 ===
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
          // === 2-4: 캐시 히트 - 캐시된 내용 사용 ===
          logger.info("캐시된 문서 내용 사용 중", {
            url: parsedUrl,
            contentLength: documentContent.length,
          });
        }

        // === 3단계: 빈 문서 검사 ===
        if (!documentContent.trim()) {
          return {
            result: `URL에서 콘텐츠를 찾을 수 없습니다: ${url}`,
            status: "error",
          };
        }

        // === 4단계: 성공 결과 반환 ===
        return {
          result: documentContent,
          status: "success",
        };
      } catch (e) {
        // === 5단계: 에러 처리 ===
        const errorString = e instanceof Error ? e.message : String(e);
        logger.error("URL 콘텐츠를 가져오는 데 실패했습니다.", {
          url: parsedUrl,
          error: errorString,
        });
        return {
          result: `URL 콘텐츠를 가져오는 데 실패했습니다: ${parsedUrl}\n오류:\n${errorString}`,
          status: "error",
        };
      }
    },
    createGetURLContentToolFields(),
  );
  return getURLContentTool;
}
