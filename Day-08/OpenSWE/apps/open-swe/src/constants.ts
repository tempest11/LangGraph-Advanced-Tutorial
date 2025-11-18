/**
 * @file 전역 상수 정의
 * @description
 * Open SWE 에이전트 전체에서 사용되는 상수 값들을 중앙에서 관리합니다.
 *
 * 포함 내용:
 * - 샌드박스 환경 설정
 * - LangGraph 권한 관리
 * - 요청 출처 식별
 */

// Daytona 샌드박스 스냅샷 이름 (공유 상수)
import { DAYTONA_SNAPSHOT_NAME } from "@openswe/shared/constants";

// Daytona SDK 타입 정의
import { CreateSandboxFromSnapshotParams } from "@daytonaio/sdk";

/**
 * 샌드박스 생성을 위한 기본 매개변수
 *
 * @description
 * Daytona를 사용하여 격리된 개발 환경(샌드박스)을 생성할 때 사용되는 기본 설정입니다.
 * 모든 에이전트(Planner, Programmer)가 코드를 실행할 때 이 설정을 사용합니다.
 *
 * 설정 항목:
 * - user: 샌드박스 내 사용자 계정 (daytona 사용자)
 * - snapshot: 사전 구성된 개발 환경 스냅샷 이름
 * - autoDeleteInterval: 유휴 시 자동 삭제 시간 (분 단위)
 *
 * 자동 삭제 정책:
 * - 15분 동안 활동이 없으면 샌드박스 자동 삭제
 * - 비용 절감 및 리소스 관리 목적
 * - 장시간 작업 시 주기적인 액션으로 타이머 리셋 가능
 *
 * @constant {CreateSandboxFromSnapshotParams}
 */
export const DEFAULT_SANDBOX_CREATE_PARAMS: CreateSandboxFromSnapshotParams = {
  user: "daytona",                     // 샌드박스 사용자
  snapshot: DAYTONA_SNAPSHOT_NAME,     // 스냅샷 이름 (개발 환경 템플릿)
  autoDeleteInterval: 15,              // 15분 유휴 후 자동 삭제
};

/**
 * LangGraph 사용자의 기본 권한 목록
 *
 * @description
 * LangGraph API를 사용하는 사용자(에이전트 또는 외부 클라이언트)에게
 * 부여되는 기본 권한 목록입니다. 이 권한들은 인증 및 인가 과정에서 사용됩니다.
 *
 * 권한 범주:
 * 1. **threads**: 대화 스레드 관리 (생성, 읽기, 업데이트, 삭제, 검색, 실행)
 * 2. **assistants**: 에이전트 어시스턴트 관리
 * 3. **deployments**: 배포 정보 조회
 * 4. **store**: 데이터 저장소 접근
 *
 * 보안 고려사항:
 * - 각 권한은 명시적으로 부여되어야 함
 * - 최소 권한 원칙 적용 (필요한 권한만 부여)
 * - 민감한 작업은 추가 인증 필요
 *
 * @constant {string[]}
 */
export const LANGGRAPH_USER_PERMISSIONS = [
  // 스레드 생성 권한
  "threads:create",

  // 스레드 실행 생성 권한 (에이전트 실행)
  "threads:create_run",

  // 스레드 읽기 권한
  "threads:read",

  // 스레드 삭제 권한
  "threads:delete",

  // 스레드 업데이트 권한
  "threads:update",

  // 스레드 검색 권한
  "threads:search",

  // 어시스턴트 생성 권한
  "assistants:create",

  // 어시스턴트 읽기 권한
  "assistants:read",

  // 어시스턴트 삭제 권한
  "assistants:delete",

  // 어시스턴트 업데이트 권한
  "assistants:update",

  // 어시스턴트 검색 권한
  "assistants:search",

  // 배포 정보 읽기 권한
  "deployments:read",

  // 배포 정보 검색 권한
  "deployments:search",

  // 데이터 저장소 접근 권한
  "store:access",
];

/**
 * 요청의 출처를 나타내는 열거형
 *
 * @description
 * Open SWE로 들어오는 요청이 어디서 발생했는지 식별하기 위한 열거형입니다.
 * 라우팅, 로깅, 분석 등에 사용됩니다.
 *
 * 사용 시나리오:
 * - GitHub 이슈 웹훅: 새 이슈 생성 또는 코멘트 추가 시
 * - GitHub PR 웹훅: PR 생성, 업데이트, 리뷰 요청 시
 *
 * @enum {string}
 */
export enum RequestSource {
  /**
   * GitHub 이슈 웹훅에서 발생한 요청
   * - 새 이슈 생성
   * - 이슈 코멘트 추가
   * - 이슈 라벨 변경
   */
  GITHUB_ISSUE_WEBHOOK = "github_issue_webhook",

  /**
   * GitHub Pull Request 웹훅에서 발생한 요청
   * - PR 생성
   * - PR 리뷰 요청
   * - PR 업데이트
   */
  GITHUB_PULL_REQUEST_WEBHOOK = "github_pull_request_webhook",
}
