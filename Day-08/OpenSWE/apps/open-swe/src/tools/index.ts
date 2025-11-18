/**
 * @file Tools Export 인덱스
 * @description
 * Open SWE 에이전트가 사용하는 모든 도구들을 중앙에서 내보냅니다.
 *
 * 도구 카테고리:
 * 1. **코드 수정 도구**: apply-patch, text-editor
 * 2. **실행 도구**: shell, install-dependencies
 * 3. **검색 도구**: grep, search-documents-for
 * 4. **컨텐츠 도구**: url-content
 * 5. **설정 도구**: default-tsconfig
 * 6. **공유 도구 필드**: update-plan, session-plan, request-help
 *
 * 사용 방법:
 * ```typescript
 * import { createShellTool, createGrepTool } from "./tools/index.js";
 * ```
 */

// === 코드 수정 도구 ===
export * from "./apply-patch.js";              // 패치 적용 도구
export * from "./builtin-tools/text-editor.js"; // 텍스트 편집기 도구

// === 실행 도구 ===
export * from "./shell.js";                     // Shell 명령 실행 도구
export * from "./install-dependencies.js";      // 의존성 설치 도구

// === 검색 도구 ===
export * from "./grep.js";                      // ripgrep 기반 파일 검색
export * from "./search-documents-for/index.js"; // 문서 검색 도구

// === 컨텐츠 도구 ===
export * from "./url-content.js";               // URL 컨텐츠 가져오기

// === 설정 도구 ===
export * from "./default-tsconfig.js";          // 기본 TypeScript 설정

// === 공유 도구 필드 (도구 스키마만 export) ===
export {
  createUpdatePlanToolFields,       // 계획 업데이트 도구 필드
  createSessionPlanToolFields,      // 세션 계획 도구 필드
  createRequestHumanHelpToolFields, // 인간 도움 요청 도구 필드
} from "@openswe/shared/open-swe/tools";
