/**
 * @file 기본 TypeScript 설정 파일 생성 도구
 * @description
 * 프로젝트에 권장 tsconfig.json 파일을 자동으로 생성하는 LangChain 도구.
 *
 * 주요 기능:
 * 1. 엄격한 TypeScript 설정이 포함된 기본 tsconfig.json 정의
 * 2. 지정된 디렉토리에 설정 파일 자동 작성
 * 3. 에러 처리 및 상태 반환 (success/error)
 *
 * 사용 시나리오:
 * - TypeScript 프로젝트 초기화
 * - 기존 프로젝트의 설정 표준화
 * - CI/CD에서 일관된 빌드 환경 구성
 *
 * 설정 특징:
 * - ES2021 타겟, NodeNext 모듈 시스템
 * - strict 모드 활성화
 * - 미사용 변수/파라미터 검사
 */

// Node.js path 모듈
import path from "path";

// LangChain 도구 생성 함수
import { tool } from "@langchain/core/tools";

// 도구 필드 정의 (도구 메타데이터)
import { createWriteDefaultTsConfigToolFields } from "@openswe/shared/open-swe/tools";

// GraphConfig, GraphState 타입
import { GraphConfig, GraphState } from "@openswe/shared/open-swe/types";

// Shell 명령 실행기
import { createShellExecutor } from "../utils/shell-executor/index.js";

// 타임아웃 상수
import { TIMEOUT_SEC } from "@openswe/shared/constants";

// 샌드박스 에러 필드 추출 유틸리티
import { getSandboxErrorFields } from "../utils/sandbox-error-fields.js";

/**
 * 기본 TypeScript 설정 객체
 *
 * @description
 * Open SWE에서 권장하는 TypeScript 컴파일러 옵션.
 * 엄격한 타입 검사와 최신 ECMAScript 기능을 지원.
 *
 * 주요 옵션:
 * - target: ES2021 (최신 JavaScript 기능)
 * - module: NodeNext (Node.js ESM 지원)
 * - strict: true (모든 엄격한 검사 활성화)
 * - noUnusedLocals/Parameters: true (미사용 코드 검사)
 * - declaration: true (타입 선언 파일 생성)
 *
 * @constant {Object}
 */
const DEFAULT_TS_CONFIG = {
  extends: "@tsconfig/recommended", // TSConfig 권장 베이스 설정
  compilerOptions: {
    target: "ES2021", // ECMAScript 2021 기능 사용
    module: "NodeNext", // Node.js ESM 모듈 시스템
    lib: ["ES2023"], // ES2023 표준 라이브러리
    moduleResolution: "nodenext", // Node.js 모듈 해석 전략
    esModuleInterop: true, // CommonJS/ESM 상호 운용성
    noImplicitReturns: true, // 모든 코드 경로에서 값 반환 강제
    declaration: true, // .d.ts 선언 파일 생성
    noFallthroughCasesInSwitch: true, // switch문 fall-through 방지
    noUnusedLocals: true, // 미사용 로컬 변수 에러
    noUnusedParameters: true, // 미사용 함수 파라미터 에러
    useDefineForClassFields: true, // 클래스 필드 표준 동작
    strictPropertyInitialization: false, // 속성 초기화 검사 비활성화
    allowJs: true, // JavaScript 파일 허용
    strict: true, // 모든 엄격한 타입 검사 활성화
    strictFunctionTypes: false, // 함수 타입 검사 완화
    outDir: "dist", // 컴파일 결과 디렉토리
    types: ["node"], // Node.js 타입 정의
    resolveJsonModule: true, // JSON 파일 import 허용
  },
  include: ["**/*.ts"], // 모든 .ts 파일 포함
  exclude: ["node_modules", "dist"], // 제외할 디렉토리
};

/**
 * 기본 tsconfig.json 생성 도구 팩토리
 *
 * @description
 * 지정된 디렉토리에 DEFAULT_TS_CONFIG를 작성하는 LangChain 도구를 생성.
 *
 * 처리 흐름:
 * 1. Shell executor 생성 (로컬/클라우드 샌드박스)
 * 2. echo 명령으로 JSON 파일 작성
 * 3. Exit code 검증 (0이 아니면 에러)
 * 4. 성공/실패 상태 반환
 *
 * 에러 처리:
 * - 샌드박스 에러: getSandboxErrorFields로 상세 정보 추출
 * - 일반 에러: Error 메시지 반환
 *
 * @param {Pick<GraphState, "sandboxSessionId" | "targetRepository">} state - 그래프 상태 (샌드박스 ID, 타겟 레포지토리)
 * @param {GraphConfig} config - 그래프 설정 (로컬/클라우드 모드)
 * @returns {Tool} tsconfig.json 작성 도구
 *
 * @example
 * // Programmer 그래프에서 사용
 * const tool = createWriteDefaultTsConfigTool(state, config);
 * const result = await tool.invoke({ workdir: "/workspace" });
 * // => { result: "Successfully wrote to tsconfig.json to /workspace/tsconfig.json", status: "success" }
 */
export function createWriteDefaultTsConfigTool(
  state: Pick<GraphState, "sandboxSessionId" | "targetRepository">,
  config: GraphConfig,
) {
  const writeDefaultTsConfigTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      const { workdir } = input;

      // === 1단계: Shell executor 생성 ===
      // 로컬 모드면 LocalShellExecutor, 클라우드면 ShellExecutor
      const executor = createShellExecutor(config);
      const tsConfigFileName = "tsconfig.json";

      try {
        // === 2단계: tsconfig.json 파일 작성 ===
        // echo 명령으로 JSON 문자열을 파일에 저장
        const response = await executor.executeCommand({
          command: `echo '${JSON.stringify(DEFAULT_TS_CONFIG)}' > ${tsConfigFileName}`,
          workdir,
          timeout: TIMEOUT_SEC,
        });

        // === 3단계: Exit code 검증 ===
        // 0이 아니면 실패
        if (response.exitCode !== 0) {
          throw new Error(
            `Failed to write default tsconfig.json. Exit code: ${response.exitCode}\nError: ${response.result}`,
          );
        }

        // === 4단계: 성공 결과 반환 ===
        const destinationPath = path.join(workdir, tsConfigFileName);
        return {
          result: `Successfully wrote to tsconfig.json to ${destinationPath}`,
          status: "success",
        };
      } catch (error) {
        // === 5단계: 에러 처리 ===
        // 샌드박스 특정 에러 필드 추출 시도
        const errorFields = getSandboxErrorFields(error);
        if (errorFields) {
          return {
            result: `Error: ${errorFields.result ?? errorFields.artifacts?.stdout}`,
            status: "error",
          };
        }

        // 일반 에러 메시지 반환
        const errorString =
          error instanceof Error ? error.message : String(error);
        return {
          result: `Error: ${errorString}`,
          status: "error",
        };
      }
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createWriteDefaultTsConfigToolFields(state.targetRepository),
  );

  return writeDefaultTsConfigTool;
}
