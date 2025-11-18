/**
 * @file constants.ts
 * @description 이 파일은 Open SWE 모노레포 전반에서 사용되는 공유 상수들을 정의합니다.
 * 타임아웃, 디렉토리 경로, 쿠키 이름, 헤더 이름 등 하드코딩을 피하고 일관성을 유지하기 위해
 * 필요한 값들을 중앙에서 관리합니다.
 */

// 일반 상수
export const TIMEOUT_SEC = 60; // 타임아웃 시간 (1분)
export const SANDBOX_ROOT_DIR = "/home/daytona"; // 샌드박스 루트 디렉토리
export const DAYTONA_IMAGE_NAME = "daytonaio/langchain-open-swe:0.1.0"; // Daytona 환경 이미지 이름
export const DAYTONA_SNAPSHOT_NAME = "open-swe-vcpu2-mem4-disk5"; // Daytona 스냅샷 이름
export const PLAN_INTERRUPT_DELIMITER = ":::"; // 계획 중단 구분자
export const PLAN_INTERRUPT_ACTION_TITLE = "Approve/Edit Plan"; // 계획 승인/편집 액션 제목

// 쿠키 및 헤더 이름 상수
// 접두사 `x-`는 LangGraph 서버로의 요청에 해당 값이 포함되도록 하기 위함입니다.
export const GITHUB_TOKEN_COOKIE = "x-github-access-token";
export const GITHUB_INSTALLATION_TOKEN_COOKIE = "x-github-installation-token";
export const GITHUB_INSTALLATION_NAME = "x-github-installation-name";
export const GITHUB_PAT = "x-github-pat";
export const GITHUB_INSTALLATION_ID = "x-github-installation-id";
export const LOCAL_MODE_HEADER = "x-local-mode"; // 로컬 모드 식별 헤더
export const DO_NOT_RENDER_ID_PREFIX = "do-not-render-"; // 렌더링하지 않을 ID 접두사
export const GITHUB_AUTH_STATE_COOKIE = "github_auth_state";
export const GITHUB_INSTALLATION_ID_COOKIE = "github_installation_id";
export const GITHUB_TOKEN_TYPE_COOKIE = "github_token_type";

// 그래프 ID 상수
export const OPEN_SWE_V2_GRAPH_ID = "open-swe-v2";
export const MANAGER_GRAPH_ID = "manager";
export const PLANNER_GRAPH_ID = "planner";
export const PROGRAMMER_GRAPH_ID = "programmer";

// GitHub 사용자 정보 헤더
export const GITHUB_USER_ID_HEADER = "x-github-user-id";
export const GITHUB_USER_LOGIN_HEADER = "x-github-user-login";

// 기본 MCP 서버 설정
export const DEFAULT_MCP_SERVERS = {
  "langgraph-docs-mcp": {
    command: "uvx",
    args: [
      "--from",
      "mcpdoc",
      "mcpdoc",
      "--urls",
      "LangGraphPY:https://langchain-ai.github.io/langgraph/llms.txt LangGraphJS:https://langchain-ai.github.io/langgraphjs/llms.txt",
      "--transport",
      "stdio",
    ],
    stderr: "inherit" as const,
  },
};

// API 키 필요 메시지
export const API_KEY_REQUIRED_MESSAGE =
  "Unknown users must provide API keys to use the Open SWE demo application";

// 스트림 모드 종류
export const OPEN_SWE_STREAM_MODE = [
  "values",
  "updates",
  "messages",
  "messages-tuple",
  "custom",
];