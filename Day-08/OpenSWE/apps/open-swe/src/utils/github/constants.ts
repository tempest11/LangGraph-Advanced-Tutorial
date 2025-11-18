/**
 * @file GitHub 기본 제외 패턴
 * @description
 * Git 커밋 시 제외할 기본 파일/디렉토리 패턴 목록.
 * 민감 정보, 빌드 산출물, 임시 파일 등을 커밋에서 제외합니다.
 *
 * 사용 위치:
 * - git.ts: getValidFilesToCommit()에서 파일 필터링
 * - open-pr.ts: PR 생성 전 커밋 파일 검증
 *
 * 카테고리:
 * 1. 의존성: node_modules
 * 2. 환경 변수: .env*
 * 3. 빌드 산출물: dist, build, .turbo, .next
 * 4. 테스트/커버리지: coverage, .nyc_output
 * 5. 로그: logs, *.log
 * 6. OS 임시 파일: .DS_Store, Thumbs.db
 * 7. 백업 파일: *.backup
 * 8. LangGraph API: langgraph_api
 */

/**
 * Git 커밋에서 기본적으로 제외되는 파일/디렉토리 패턴
 *
 * @description
 * shouldExcludeFile() 함수에서 사용되는 기본 제외 패턴 배열.
 * 각 패턴은 파일 경로에 포함되면 커밋에서 제외됩니다.
 *
 * 패턴 매칭:
 * - 정확한 문자열 매칭 (글롭 패턴 아님)
 * - 경로의 어느 부분이든 매칭 가능
 * - 예: "node_modules" → "src/node_modules/lib" 제외
 *
 * 추가 방법:
 * - 프로젝트별 제외 패턴은 호출 시 추가 배열 전달
 * - 예: [...DEFAULT_EXCLUDED_PATTERNS, "my-secret-dir"]
 *
 * @constant {string[]}
 *
 * @example
 * // 사용 예시 (git.ts)
 * const validFiles = allFiles.filter(filePath => {
 *   return !shouldExcludeFile(filePath, DEFAULT_EXCLUDED_PATTERNS);
 * });
 */
export const DEFAULT_EXCLUDED_PATTERNS = [
  "node_modules", // 의존성 디렉토리
  "langgraph_api", // LangGraph API 생성 파일
  ".env", // 환경 변수 파일
  ".env.local", // 로컬 환경 변수
  ".env.production", // 프로덕션 환경 변수
  ".env.development", // 개발 환경 변수
  "dist", // 빌드 출력 디렉토리
  "build", // 빌드 출력 디렉토리
  ".turbo", // Turbo 캐시
  ".next", // Next.js 빌드 캐시
  "coverage", // 테스트 커버리지
  ".nyc_output", // NYC 커버리지 출력
  "logs", // 로그 디렉토리
  "*.log", // 로그 파일
  ".DS_Store", // macOS 메타데이터
  "Thumbs.db", // Windows 썸네일 캐시
  "*.backup", // 백업 파일
];
