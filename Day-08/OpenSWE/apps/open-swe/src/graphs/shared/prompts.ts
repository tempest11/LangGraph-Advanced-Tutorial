/**
 * @file 공유 프롬프트 정의
 * @description
 * 여러 그래프에서 공통으로 사용되는 시스템 프롬프트 및 제약 사항을 정의합니다.
 *
 * 이 파일에는 LLM에게 제공되는 중요한 제약 사항과 가이드라인이 포함되어 있으며,
 * 보안 및 권한 관리와 관련된 핵심 규칙을 명시합니다.
 */

/**
 * GitHub Workflows 디렉토리 권한 제약 프롬프트
 *
 * @description
 * LLM이 GitHub Actions 워크플로우 파일을 수정할 때 따라야 하는 엄격한 규칙입니다.
 * 보안상의 이유로 `.github/workflows/` 디렉토리에 대한 직접 접근을 금지하고,
 * 임시 디렉토리를 사용하도록 강제합니다.
 *
 * 주요 제약 사항:
 * 1. `.github/workflows/` 디렉토리 내 파일 편집/삭제 금지
 * 2. 워크플로우 수정 시 `tmp-workflows` 디렉토리 사용 필수
 * 3. 규칙 위반 시 세션 즉시 종료 (치명적 오류)
 * 4. 사용자가 수동으로 파일을 이동해야 함을 안내
 *
 * 사용처:
 * - Programmer 그래프의 액션 생성 프롬프트에 포함
 * - LLM에게 워크플로우 관련 작업 시 제약 사항 명시
 *
 * 보안 배경:
 * - GitHub Actions 워크플로우는 민감한 권한을 가질 수 있음
 * - 잘못된 수정은 CI/CD 파이프라인 전체에 영향
 * - 자동화된 에이전트의 직접 수정은 위험 요소
 *
 * @constant {string}
 *
 * @example
 * // Programmer 프롬프트에 포함하는 예시
 * const systemPrompt = `
 *   You are a coding assistant...
 *   ${GITHUB_WORKFLOWS_PERMISSIONS_PROMPT}
 *   ...
 * `;
 */
export const GITHUB_WORKFLOWS_PERMISSIONS_PROMPT = `
IMPORTANT: You do not have permissions to EDIT or DELETE files inside the GitHub workflows directory (commonly found at .github/workflows/).
  - If you need to modify or create a workflow, ensure you always do so inside a 'tmp-workflows' directory.
  - Any attempt to create or modify a workflow file in the .github/workflows/ directory will result in a fatal error that will end the session.
  - Notify the user that they will need to manually move the workflow file from the 'tmp-workflows' directory to the .github/workflows/ directory since you do not have permissions to do so.
`;
