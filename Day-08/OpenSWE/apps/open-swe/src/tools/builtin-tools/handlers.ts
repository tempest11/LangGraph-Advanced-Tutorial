/**
 * @file 빌트인 도구 명령 핸들러
 * @description
 * Text Editor 도구의 핵심 명령(view, str_replace, create, insert) 처리 로직.
 * 샌드박스 환경에서 안전한 파일 조작을 제공.
 *
 * 주요 기능:
 * 1. view: 파일 내용 보기 (줄 번호, 범위 지정, 디렉토리 목록)
 * 2. str_replace: 문자열 교체 (정확히 1개 매칭 필수)
 * 3. create: 새 파일 생성 (이미 있으면 에러)
 * 4. insert: 특정 줄에 텍스트 삽입
 *
 * 안전성 보장:
 * - 정확한 매칭 강제 (0개 또는 2개 이상 매칭 시 에러)
 * - 파일 덮어쓰기 방지 (create 시 존재 확인)
 * - 샌드박스 에러 필드 처리
 */

// Daytona SDK 샌드박스 타입
import { Sandbox } from "@daytonaio/sdk";

// 파일 읽기/쓰기 유틸리티
import { readFile, writeFile } from "../../utils/read-write.js";

// 샌드박스 에러 필드 추출 유틸리티
import { getSandboxErrorFields } from "../../utils/sandbox-error-fields.js";

// GraphConfig 타입
import { GraphConfig } from "@openswe/shared/open-swe/types";

// Shell 명령 실행기
import { createShellExecutor } from "../../utils/shell-executor/index.js";

/**
 * View 명령 입력 인터페이스
 *
 * @description
 * handleViewCommand에 전달되는 파라미터 타입.
 *
 * @interface ViewCommandInputs
 * @property {string} path - 파일 또는 디렉토리 경로
 * @property {string} workDir - 작업 디렉토리 경로
 * @property {[number, number]} [viewRange] - 선택적 줄 범위 [시작, 끝] (1-indexed)
 */
interface ViewCommandInputs {
  path: string; // 파일 또는 디렉토리 경로
  workDir: string; // 작업 디렉토리
  viewRange?: [number, number]; // 선택적 줄 범위 [시작, 끝]
}

/**
 * 파일 보기 또는 디렉토리 목록 조회 핸들러
 *
 * @description
 * 파일의 내용을 줄 번호와 함께 표시하거나, 디렉토리 목록을 반환.
 *
 * 처리 흐름:
 * 1. stat 명령으로 경로 타입 확인 (파일 vs 디렉토리)
 * 2. 디렉토리인 경우:
 *    - ls -la로 목록 조회
 * 3. 파일인 경우:
 *    - readFile로 내용 읽기
 *    - viewRange 지정 시 해당 줄만 추출
 *    - 줄 번호 추가 (1-indexed)
 * 4. 에러 처리 (샌드박스 에러 필드 포함)
 *
 * viewRange 처리:
 * - [10, 20]: 10-20줄 표시
 * - [1, -1]: 전체 파일 (끝까지)
 * - undefined: 전체 파일 표시
 *
 * @param {Sandbox} sandbox - Daytona 샌드박스 객체
 * @param {GraphConfig} config - 그래프 설정
 * @param {ViewCommandInputs} inputs - 명령 입력 (path, workDir, viewRange)
 * @returns {Promise<string>} 줄 번호가 포함된 파일 내용 또는 디렉토리 목록
 * @throws {Error} 파일 읽기 실패 또는 디렉토리 목록 조회 실패 시
 *
 * @example
 * // 파일 전체 보기
 * const output = await handleViewCommand(sandbox, config, {
 *   path: "/workspace/src/index.ts",
 *   workDir: "/workspace",
 * });
 * // => "1: import { tool } from '@langchain/core/tools';\n2: ..."
 *
 * @example
 * // 특정 줄 범위 보기 (10-20줄)
 * const output = await handleViewCommand(sandbox, config, {
 *   path: "/workspace/src/index.ts",
 *   workDir: "/workspace",
 *   viewRange: [10, 20],
 * });
 */
export async function handleViewCommand(
  sandbox: Sandbox,
  config: GraphConfig,
  inputs: ViewCommandInputs,
): Promise<string> {
  const { path, workDir, viewRange } = inputs;

  try {
    // === 1단계: 경로 타입 확인 (파일 vs 디렉토리) ===
    const executor = createShellExecutor(config);
    const statOutput = await executor.executeCommand({
      command: `stat -c %F "${path}"`, // %F: 파일 타입 출력
      workdir: workDir,
      sandbox,
    });

    // === 2단계: 디렉토리인 경우 목록 조회 ===
    if (statOutput.exitCode === 0 && statOutput.result?.includes("directory")) {
      // ls -la로 디렉토리 목록 조회
      const lsOutput = await executor.executeCommand({
        command: `ls -la "${path}"`,
        workdir: workDir,
        sandbox,
      });

      if (lsOutput.exitCode !== 0) {
        throw new Error(`Failed to list directory: ${lsOutput.result}`);
      }

      return `Directory listing for ${path}:\n${lsOutput.result}`;
    }

    // === 3단계: 파일 내용 읽기 ===
    const { success, output } = await readFile({
      sandbox,
      filePath: path,
      workDir,
      config,
    });

    if (!success) {
      throw new Error(output);
    }

    // === 4단계: viewRange 처리 (특정 줄 범위 추출) ===
    if (viewRange) {
      const lines = output.split("\n");
      const [start, end] = viewRange;

      // 1-indexed → 0-indexed 변환
      const startIndex = Math.max(0, start - 1);
      const endIndex = end === -1 ? lines.length : Math.min(lines.length, end);

      // 범위 추출 및 줄 번호 추가
      const selectedLines = lines.slice(startIndex, endIndex);
      const numberedLines = selectedLines.map(
        (line, index) => `${startIndex + index + 1}: ${line}`,
      );

      return numberedLines.join("\n");
    }

    // === 5단계: 전체 파일 내용 반환 (줄 번호 포함) ===
    const lines = output.split("\n");
    const numberedLines = lines.map((line, index) => `${index + 1}: ${line}`);
    return numberedLines.join("\n");
  } catch (e) {
    // === 6단계: 에러 처리 (샌드박스 에러 필드 포함) ===
    const errorFields = getSandboxErrorFields(e);
    if (errorFields) {
      throw new Error(`Failed to view ${path}: ${errorFields.result}`);
    }
    throw new Error(
      `Failed to view ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Str Replace 명령 입력 인터페이스
 *
 * @description
 * handleStrReplaceCommand에 전달되는 파라미터 타입.
 *
 * @interface StrReplaceCommandInputs
 * @property {string} path - 파일 경로
 * @property {string} workDir - 작업 디렉토리
 * @property {string} oldStr - 교체할 문자열 (정확히 1개 매칭 필수)
 * @property {string} newStr - 새 문자열
 */
interface StrReplaceCommandInputs {
  path: string; // 파일 경로
  workDir: string; // 작업 디렉토리
  oldStr: string; // 교체할 문자열
  newStr: string; // 새 문자열
}

/**
 * 문자열 교체 핸들러 (정확히 1개 매칭 필수)
 *
 * @description
 * 파일에서 oldStr을 newStr로 교체. 안전성을 위해 정확히 1개 매칭만 허용.
 *
 * 처리 흐름:
 * 1. 파일 내용 읽기 (readFile)
 * 2. oldStr 발생 횟수 카운트 (정규식)
 * 3. 매칭 개수 검증:
 *    - 0개: 에러 (매칭 없음, 더 많은 컨텍스트 필요)
 *    - 1개: 교체 진행 ✅
 *    - 2개 이상: 에러 (모호함, 더 많은 컨텍스트 필요)
 * 4. 문자열 교체 수행
 * 5. 파일 쓰기 (writeFile)
 *
 * 안전성 보장:
 * - 정확히 1개 매칭 강제 (실수로 여러 곳 수정 방지)
 * - 에러 메시지에 매칭 개수 포함 (디버깅 용이)
 *
 * @param {Sandbox} sandbox - Daytona 샌드박스 객체
 * @param {GraphConfig} config - 그래프 설정
 * @param {StrReplaceCommandInputs} inputs - 명령 입력 (path, workDir, oldStr, newStr)
 * @returns {Promise<string>} 성공 메시지
 * @throws {Error} 파일 읽기/쓰기 실패, 매칭 0개, 매칭 2개 이상 시
 *
 * @example
 * // 성공 케이스 (정확히 1개 매칭)
 * const result = await handleStrReplaceCommand(sandbox, config, {
 *   path: "/workspace/src/index.ts",
 *   workDir: "/workspace",
 *   oldStr: "const x = 10;",
 *   newStr: "const x = 20;"
 * });
 * // => "Successfully replaced text in /workspace/src/index.ts at exactly one location."
 *
 * @example
 * // 에러 케이스 (매칭 2개)
 * // Error: Found 2 matches for replacement text in /workspace/src/index.ts.
 * //        Please provide more context to make a unique match.
 */
export async function handleStrReplaceCommand(
  sandbox: Sandbox,
  config: GraphConfig,
  inputs: StrReplaceCommandInputs,
): Promise<string> {
  const { path, workDir, oldStr, newStr } = inputs;

  // === 1단계: 파일 내용 읽기 ===
  const { success: readSuccess, output: fileContent } = await readFile({
    sandbox,
    filePath: path,
    workDir,
    config,
  });

  if (!readSuccess) {
    throw new Error(`Failed to read file ${path}: ${fileContent}`);
  }

  // === 2단계: oldStr 발생 횟수 카운트 ===
  // 정규식 특수 문자 이스케이프 처리
  const occurrences = (
    fileContent.match(
      new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    ) || []
  ).length;

  // === 3단계: 매칭 개수 검증 ===
  // 0개: 매칭 없음 에러
  if (occurrences === 0) {
    throw new Error(
      `No match found for replacement text in ${path}. Please check your text and try again.`,
    );
  }

  // 2개 이상: 모호함 에러
  if (occurrences > 1) {
    throw new Error(
      `Found ${occurrences} matches for replacement text in ${path}. Please provide more context to make a unique match.`,
    );
  }

  // === 4단계: 문자열 교체 수행 ===
  const newContent = fileContent.replace(oldStr, newStr);

  // === 5단계: 파일 쓰기 ===
  const { success: writeSuccess, output: writeOutput } = await writeFile({
    sandbox,
    filePath: path,
    content: newContent,
    workDir,
  });

  if (!writeSuccess) {
    throw new Error(`Failed to write file ${path}: ${writeOutput}`);
  }

  return `Successfully replaced text in ${path} at exactly one location.`;
}

/**
 * Create 명령 입력 인터페이스
 *
 * @description
 * handleCreateCommand에 전달되는 파라미터 타입.
 *
 * @interface CreateCommandInputs
 * @property {string} path - 생성할 파일 경로
 * @property {string} workDir - 작업 디렉토리
 * @property {string} fileText - 파일 내용
 */
interface CreateCommandInputs {
  path: string; // 생성할 파일 경로
  workDir: string; // 작업 디렉토리
  fileText: string; // 파일 내용
}

/**
 * 새 파일 생성 핸들러 (이미 있으면 에러)
 *
 * @description
 * 새 파일을 생성. 기존 파일 덮어쓰기 방지를 위해 존재 여부 확인.
 *
 * 처리 흐름:
 * 1. 파일 존재 여부 확인 (readFile)
 * 2. 이미 존재하면 에러 (str_replace 사용 안내)
 * 3. 파일 쓰기 (writeFile)
 * 4. 성공 메시지 반환
 *
 * 안전성 보장:
 * - 기존 파일 덮어쓰기 방지
 * - 에러 메시지에 대안 제시 (str_replace)
 *
 * @param {Sandbox} sandbox - Daytona 샌드박스 객체
 * @param {GraphConfig} config - 그래프 설정
 * @param {CreateCommandInputs} inputs - 명령 입력 (path, workDir, fileText)
 * @returns {Promise<string>} 성공 메시지
 * @throws {Error} 파일이 이미 존재하거나 쓰기 실패 시
 *
 * @example
 * // 새 파일 생성
 * const result = await handleCreateCommand(sandbox, config, {
 *   path: "/workspace/src/newFile.ts",
 *   workDir: "/workspace",
 *   fileText: "export const newFunction = () => {};"
 * });
 * // => "Successfully created file /workspace/src/newFile.ts."
 *
 * @example
 * // 에러 케이스 (파일 이미 존재)
 * // Error: File /workspace/src/newFile.ts already exists.
 * //        Use str_replace to modify existing files.
 */
export async function handleCreateCommand(
  sandbox: Sandbox,
  config: GraphConfig,
  inputs: CreateCommandInputs,
): Promise<string> {
  const { path, workDir, fileText } = inputs;

  // === 1단계: 파일 존재 여부 확인 ===
  const { success: readSuccess } = await readFile({
    sandbox,
    filePath: path,
    workDir,
    config,
  });

  // === 2단계: 이미 존재하면 에러 ===
  if (readSuccess) {
    throw new Error(
      `File ${path} already exists. Use str_replace to modify existing files.`,
    );
  }

  // === 3단계: 파일 쓰기 ===
  const { success: writeSuccess, output: writeOutput } = await writeFile({
    sandbox,
    filePath: path,
    content: fileText,
    workDir,
  });

  if (!writeSuccess) {
    throw new Error(`Failed to create file ${path}: ${writeOutput}`);
  }

  // === 4단계: 성공 메시지 반환 ===
  return `Successfully created file ${path}.`;
}

/**
 * Insert 명령 입력 인터페이스
 *
 * @description
 * handleInsertCommand에 전달되는 파라미터 타입.
 *
 * @interface InsertCommandInputs
 * @property {string} path - 파일 경로
 * @property {string} workDir - 작업 디렉토리
 * @property {number} insertLine - 삽입할 줄 번호 (0 = 맨 처음, 1 = 첫 줄 다음)
 * @property {string} newStr - 삽입할 문자열
 */
interface InsertCommandInputs {
  path: string; // 파일 경로
  workDir: string; // 작업 디렉토리
  insertLine: number; // 삽입할 줄 번호
  newStr: string; // 삽입할 문자열
}

/**
 * 특정 줄에 텍스트 삽입 핸들러
 *
 * @description
 * 파일의 특정 줄 위치에 새 텍스트를 삽입.
 *
 * 처리 흐름:
 * 1. 파일 내용 읽기 (readFile)
 * 2. 줄 단위로 분할
 * 3. insertLine 위치에 newStr 삽입
 * 4. 줄 결합
 * 5. 파일 쓰기 (writeFile)
 *
 * insertLine 의미:
 * - 0: 파일 맨 처음에 삽입
 * - 1: 첫 번째 줄 다음에 삽입
 * - n: n번째 줄 다음에 삽입
 *
 * @param {Sandbox} sandbox - Daytona 샌드박스 객체
 * @param {GraphConfig} config - 그래프 설정
 * @param {InsertCommandInputs} inputs - 명령 입력 (path, workDir, insertLine, newStr)
 * @returns {Promise<string>} 성공 메시지
 * @throws {Error} 파일 읽기/쓰기 실패 시
 *
 * @example
 * // 파일 맨 처음에 import 문 삽입
 * const result = await handleInsertCommand(sandbox, config, {
 *   path: "/workspace/src/index.ts",
 *   workDir: "/workspace",
 *   insertLine: 0,
 *   newStr: "import { tool } from '@langchain/core/tools';"
 * });
 * // => "Successfully inserted text in /workspace/src/index.ts at line 0."
 *
 * @example
 * // 10번째 줄 다음에 새 함수 삽입
 * const result = await handleInsertCommand(sandbox, config, {
 *   path: "/workspace/src/index.ts",
 *   workDir: "/workspace",
 *   insertLine: 10,
 *   newStr: "export function newFunction() {}"
 * });
 */
export async function handleInsertCommand(
  sandbox: Sandbox,
  config: GraphConfig,
  inputs: InsertCommandInputs,
): Promise<string> {
  const { path, workDir, insertLine, newStr } = inputs;

  // === 1단계: 파일 내용 읽기 ===
  const { success: readSuccess, output: fileContent } = await readFile({
    sandbox,
    filePath: path,
    workDir,
    config,
  });

  if (!readSuccess) {
    throw new Error(`Failed to read file ${path}: ${fileContent}`);
  }

  // === 2단계: 줄 단위로 분할 ===
  const lines = fileContent.split("\n");

  // === 3단계: insertLine 위치에 newStr 삽입 ===
  // 0 = 맨 처음, 1 = 첫 줄 다음, ...
  const insertIndex = Math.max(0, Math.min(lines.length, insertLine));
  lines.splice(insertIndex, 0, newStr);

  // === 4단계: 줄 결합 ===
  const newContent = lines.join("\n");

  // === 5단계: 파일 쓰기 ===
  const { success: writeSuccess, output: writeOutput } = await writeFile({
    sandbox,
    filePath: path,
    content: newContent,
    workDir,
  });

  if (!writeSuccess) {
    throw new Error(`Failed to write file ${path}: ${writeOutput}`);
  }

  // === 6단계: 성공 메시지 반환 ===
  return `Successfully inserted text in ${path} at line ${insertLine}.`;
}
