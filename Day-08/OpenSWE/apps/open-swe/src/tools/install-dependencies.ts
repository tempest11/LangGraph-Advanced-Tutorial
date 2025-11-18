/**
 * @file 의존성 설치 도구
 * @description
 * 프로젝트의 의존성을 설치하는 도구입니다. npm, yarn, pnpm 등 다양한 패키지 매니저를 지원합니다.
 *
 * 주요 기능:
 * - 패키지 매니저 명령 실행 (yarn install, npm install 등)
 * - 확장된 타임아웃 (2.5분, 일반 명령의 2.5배)
 * - 작업 디렉토리 지정 가능
 * - 로컬/샌드박스 모드 모두 지원
 * - corepack 프롬프트 비활성화
 *
 * 사용 예시:
 * - Yarn: ["yarn", "install"]
 * - npm: ["npm", "install"]
 * - pnpm: ["pnpm", "install"]
 * - 특정 패키지: ["yarn", "add", "lodash"]
 *
 * 타임아웃 설정:
 * - 기본: TIMEOUT_SEC * 2.5 (150초, 약 2.5분)
 * - 일반 명령(60초)보다 2.5배 길게 설정
 * - 의존성 설치는 시간이 오래 걸릴 수 있음
 *
 * 중요 사항:
 * - 종료 코드 0이 아니면 오류로 처리
 * - corepack 다운로드 프롬프트 비활성화
 * - 샌드박스 모드에서는 샌드박스 세션 필요
 */

// === LangChain Core ===
import { tool } from "@langchain/core/tools"; // 도구 생성 헬퍼

// === 타입 정의 ===
import { GraphState, GraphConfig } from "@openswe/shared/open-swe/types"; // 그래프 상태/설정

// === 유틸리티 ===
import { getSandboxErrorFields } from "../utils/sandbox-error-fields.js"; // 샌드박스 에러 필드 추출
import { createShellExecutor } from "../utils/shell-executor/index.js"; // Shell 실행기
import { getSandboxSessionOrThrow } from "./utils/get-sandbox-id.js"; // 샌드박스 세션 가져오기

// === 로깅 ===
import { createLogger, LogLevel } from "../utils/logger.js"; // 구조화된 로거

// === 상수 ===
import { TIMEOUT_SEC } from "@openswe/shared/constants"; // 기본 타임아웃 (60초)

// === 도구 필드 ===
import { createInstallDependenciesToolFields } from "@openswe/shared/open-swe/tools"; // 의존성 설치 도구 스키마

// === Git 유틸리티 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로

// === 로컬 모드 ===
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 여부 확인

/**
 * 로거 인스턴스
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "InstallDependenciesTool");

/**
 * 기본 환경 변수
 *
 * @description
 * 의존성 설치 명령 실행 시 기본으로 설정되는 환경 변수들입니다.
 *
 * COREPACK_ENABLE_DOWNLOAD_PROMPT="0":
 * - corepack이 패키지 매니저를 다운로드할 때 프롬프트를 표시하지 않도록 설정
 * - 프롬프트가 표시되면 명령이 중단되고 타임아웃이 발생할 수 있음
 * - CI/CD 환경이나 비대화형 실행에서 필수적
 *
 * @constant {Object}
 */
const DEFAULT_ENV = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
};

/**
 * 의존성 설치 도구를 생성합니다.
 *
 * @description
 * npm, yarn, pnpm 등의 패키지 매니저를 사용하여 의존성을 설치하는 도구를 생성합니다.
 * 일반 명령보다 2.5배 긴 타임아웃(150초)을 사용합니다.
 *
 * 처리 흐름:
 * 1. 리포지토리 루트 경로 가져오기
 * 2. 명령 문자열 조합 (command.join(" "))
 * 3. 작업 디렉토리 결정 (기본: 리포지토리 루트)
 * 4. Shell 실행기 생성
 * 5. 샌드박스 모드 확인:
 *    - 로컬 모드: sandbox undefined
 *    - 샌드박스 모드: getSandboxSessionOrThrow로 세션 가져오기
 * 6. 명령 실행 (타임아웃: TIMEOUT_SEC * 2.5)
 * 7. 종료 코드 확인:
 *    - 0: 성공
 *    - 0이 아닌 값: 실패 (오류 throw)
 * 8. 결과 반환
 *
 * 타임아웃 설정:
 * - TIMEOUT_SEC * 2.5 = 60 * 2.5 = 150초 (약 2.5분)
 * - 의존성 설치는 시간이 오래 걸릴 수 있어 길게 설정
 * - 특히 대량 의존성이나 느린 네트워크에서 필수적
 *
 * 입력 파라미터:
 * - command (string[]): 실행할 명령 배열
 *   - 예: ["yarn", "install"]
 *   - 예: ["npm", "install", "--legacy-peer-deps"]
 *   - 예: ["pnpm", "add", "lodash"]
 * - workdir (string, optional): 작업 디렉토리 (기본: 리포지토리 루트)
 *
 * 출력 형식:
 * - result (string): 명령 출력 (stdout + stderr)
 * - status ("success" | "error"): 실행 결과
 *
 * 오류 처리:
 * - 종료 코드 오류: 종료 코드 + 출력 포함
 * - 샌드박스 오류: 샌드박스 에러 필드 추출
 * - 기타 오류: 원본 오류 다시 throw
 *
 * @param {Pick<GraphState, "sandboxSessionId" | "targetRepository">} state - 그래프 상태
 *   - sandboxSessionId: 샌드박스 세션 ID
 *   - targetRepository: 타겟 저장소
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.localMode: 로컬 모드 여부
 *
 * @returns {Tool} 생성된 install_dependencies 도구
 *
 * @example
 * // Yarn 의존성 설치
 * const tool = createInstallDependenciesTool(state, config);
 * await tool.invoke({ command: ["yarn", "install"] });
 *
 * @example
 * // npm으로 특정 패키지 설치
 * await tool.invoke({
 *   command: ["npm", "install", "lodash", "--save"],
 *   workdir: "/path/to/project"
 * });
 *
 * @example
 * // pnpm 사용
 * await tool.invoke({ command: ["pnpm", "install", "--frozen-lockfile"] });
 */
export function createInstallDependenciesTool(
  state: Pick<GraphState, "sandboxSessionId" | "targetRepository">,
  config: GraphConfig,
) {
  const installDependenciesTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      try {
        // === 1단계: 리포지토리 루트 및 명령 준비 ===
        const repoRoot = getRepoAbsolutePath(state.targetRepository);
        const command = input.command.join(" "); // ["yarn", "install"] → "yarn install"
        const workdir = input.workdir || repoRoot; // 기본: 리포지토리 루트

        logger.info("의존성 설치 명령 실행 중", {
          command,
          workdir,
        });

        // === 2단계: Shell 실행기 생성 ===
        // 로컬 모드면 LocalShellExecutor, 샌드박스 모드면 ShellExecutor
        const executor = createShellExecutor(config);

        // === 3단계: 샌드박스 세션 결정 ===
        // 로컬 모드: undefined (로컬 파일시스템 사용)
        // 샌드박스 모드: getSandboxSessionOrThrow로 세션 가져오기
        const sandbox = isLocalMode(config)
          ? undefined
          : await getSandboxSessionOrThrow(input);

        // === 4단계: 명령 실행 (확장된 타임아웃) ===
        const response = await executor.executeCommand({
          command,
          workdir: workdir,
          env: DEFAULT_ENV, // corepack 프롬프트 비활성화
          timeout: TIMEOUT_SEC * 2.5, // 150초 (2.5분) - 의존성 설치는 오래 걸림
          sandbox,
        });

        // === 5단계: 종료 코드 검증 ===
        // 0이 아니면 실패
        if (response.exitCode !== 0) {
          const errorResult = response.result ?? response.artifacts?.stdout;
          throw new Error(
            `의존성 설치 실패. 종료 코드: ${response.exitCode}\n오류: ${errorResult}`,
          );
        }

        // === 6단계: 성공 결과 반환 ===
        return {
          result: response.result,
          status: "success",
        };
      } catch (e) {
        // === 7단계: 에러 처리 ===
        // 샌드박스 에러 필드 추출 시도
        const errorFields = getSandboxErrorFields(e);
        if (errorFields) {
          const errorResult =
            errorFields.result ?? errorFields.artifacts?.stdout;
          throw new Error(
            `의존성 설치 실패. 종료 코드: ${errorFields.exitCode}\n오류: ${errorResult}`,
          );
        }

        // 기타 에러는 그대로 throw
        throw e;
      }
    },
    createInstallDependenciesToolFields(state.targetRepository),
  );

  return installDependenciesTool;
}
