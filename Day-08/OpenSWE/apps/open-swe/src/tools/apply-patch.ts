/**
 * @file Patch 적용 3단계 폴백 도구
 * @description
 * Git diff 패치를 파일에 적용하는 LangChain 도구.
 * Git CLI → diff 라이브러리 → diff 수정 재시도의 3단계 폴백 전략으로 최고의 성공률 보장.
 *
 * 주요 기능:
 * 1. Git CLI 우선 적용 (git apply --verbose) - 가장 정확
 * 2. Git 실패 시 diff 라이브러리로 폴백 - 형식 유연성
 * 3. diff 형식 자동 수정 (fixGitPatch) - 형식 오류 복구
 * 4. 로컬/샌드박스 듀얼 모드 - 환경 통합
 *
 * 3단계 폴백 전략:
 * - 1차: Git CLI (git apply --verbose)
 *   - 장점: 가장 정확하고 상세한 오류 메시지
 *   - 단점: 엄격한 diff 형식 요구
 *
 * - 2차: diff 라이브러리 (applyPatch)
 *   - 장점: 형식 유연성, JavaScript 기반
 *   - 단점: 오류 메시지 부족
 *
 * - 3차: diff 수정 후 재시도 (fixGitPatch + applyPatch)
 *   - 장점: 형식 오류 자동 복구
 *   - 단점: 완벽한 복구 보장 불가
 *
 * 사용 시나리오:
 * - Programmer: 코드 변경사항 적용
 * - 여러 파일에 걸친 대규모 수정
 * - 충돌 감지 및 상세 오류 보고
 *
 * 임시 파일 관리:
 * - 생성: /tmp/patch_{uuid}.diff
 * - 정리: finally 블록에서 자동 삭제
 */

// LangChain 도구 생성 함수
import { tool } from "@langchain/core/tools";

// diff 라이브러리 (패치 적용)
import { applyPatch } from "diff";

// GraphState, GraphConfig 타입
import { GraphState, GraphConfig } from "@openswe/shared/open-swe/types";

// 파일 읽기/쓰기 유틸리티
import { readFile, writeFile } from "../utils/read-write.js";

// Git diff 형식 수정 유틸리티
import { fixGitPatch } from "../utils/diff.js";

// 로거 생성 유틸리티
import { createLogger, LogLevel } from "../utils/logger.js";

// Patch 도구 필드 정의 (도구 메타데이터)
import { createApplyPatchToolFields } from "@openswe/shared/open-swe/tools";

// Git 레포지토리 절대 경로 가져오기
import { getRepoAbsolutePath } from "@openswe/shared/git";

// 샌드박스 세션 ID 추출 유틸리티
import { getSandboxSessionOrThrow } from "./utils/get-sandbox-id.js";

// Daytona SDK 샌드박스 타입
import { Sandbox } from "@daytonaio/sdk";

// 로컬 모드 유틸리티
import {
  isLocalMode, // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리 경로
} from "@openswe/shared/open-swe/local-mode";

// Shell 명령 실행기
import { createShellExecutor } from "../utils/shell-executor/shell-executor.js";

// Node.js path 모듈 (경로 조합)
import { join } from "path";

// UUID 생성 라이브러리 (임시 파일명)
import { v4 as uuidv4 } from "uuid";

/**
 * 파일 작업 결과 타입
 * @typedef {Object} FileOperationResult
 * @property {boolean} success - 작업 성공 여부
 * @property {string} output - 결과 메시지 또는 오류 내용
 */
type FileOperationResult = {
  success: boolean;
  output: string;
};

/**
 * Patch 적용 로거
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "ApplyPatchTool");

/**
 * Git CLI로 패치를 적용합니다.
 *
 * @description
 * `git apply --verbose` 명령을 사용하여 패치를 적용합니다.
 * diff 라이브러리보다 정확하고 상세한 오류 메시지를 제공합니다.
 *
 * 처리 흐름:
 * 1. 임시 패치 파일 생성 (/tmp/patch_<uuid>.diff)
 * 2. cat > 명령으로 diff 내용 파일에 저장
 * 3. git apply --verbose로 패치 적용
 * 4. Exit code 검증 (0이 아니면 실패)
 * 5. finally 블록에서 임시 파일 정리 (rm -f)
 *
 * 임시 파일 경로:
 * - 로컬 모드: {workDir}/patch_{uuid}.diff
 * - 샌드박스 모드: /tmp/patch_{uuid}.diff
 *
 * @param {Sandbox | null} sandbox - 샌드박스 세션 (로컬 모드: null)
 * @param {string} workDir - 작업 디렉토리 (레포지토리 루트)
 * @param {string} diffContent - Git diff 형식의 패치 내용
 * @param {GraphConfig} config - 그래프 설정 (로컬 모드 여부 확인)
 * @returns {Promise<FileOperationResult>} 성공 여부와 결과 메시지
 *
 * @example
 * const result = await applyPatchWithGit(sandbox, "/workspace", diffContent, config);
 * if (result.success) {
 *   console.log("패치 적용 성공!");
 * } else {
 *   console.error("Git 오류:", result.output);
 * }
 */
async function applyPatchWithGit(
  sandbox: Sandbox | null,
  workDir: string,
  diffContent: string,
  config: GraphConfig,
): Promise<FileOperationResult> {
  // === 1단계: 임시 패치 파일 경로 생성 ===
  // UUID로 고유한 파일명 생성 (동시 실행 시 충돌 방지)
  const tempPatchFile = isLocalMode(config)
    ? join(workDir, `patch_${uuidv4()}.diff`) // 로컬: workDir 내 생성
    : `/tmp/patch_${uuidv4()}.diff`; // 샌드박스: /tmp에 생성

  try {
    // === 2단계: 패치 파일 생성 (cat > heredoc) ===
    const executor = createShellExecutor(config);
    const createFileResponse = await executor.executeCommand({
      command: `cat > "${tempPatchFile}" << 'EOF'\n${diffContent}\nEOF`,
      workdir: workDir,
      timeout: 10, // 파일 생성 타임아웃 10초
      sandbox: sandbox || undefined,
    });

    if (createFileResponse.exitCode !== 0) {
      return {
        success: false,
        output: `패치 파일 생성 실패: ${createFileResponse.result || "알 수 없는 오류"}`,
      };
    }

    // === 3단계: git apply --verbose 실행 ===
    // --verbose 옵션으로 상세한 오류 메시지 확보
    const response = await executor.executeCommand({
      command: `git apply --verbose "${tempPatchFile}"`,
      workdir: workDir,
      timeout: 30, // 적용 타임아웃 30초
      sandbox: sandbox || undefined,
    });

    // === 4단계: Exit code 검증 ===
    if (response.exitCode !== 0) {
      return {
        success: false,
        output: `Git apply가 종료 코드 ${response.exitCode}로 실패했습니다:\n${response.result || response.artifacts?.stdout || "오류 출력 없음"}`,
      };
    }

    // === 5단계: 성공 결과 반환 ===
    return {
      success: true,
      output: response.result || "패치가 성공적으로 적용되었습니다.",
    };
  } catch (error) {
    // === 6단계: 에러 처리 ===
    return {
      success: false,
      output:
        error instanceof Error
          ? error.message
          : "git으로 패치 적용 중 알 수 없는 오류 발생",
    };
  } finally {
    // === 7단계: 임시 파일 정리 (cleanup) ===
    // 성공/실패 무관하게 항상 정리
    try {
      const executor = createShellExecutor(config);
      await executor.executeCommand({
        command: `rm -f "${tempPatchFile}"`,
        workdir: workDir,
        timeout: 5, // 정리 타임아웃 5초
        sandbox: sandbox || undefined,
      });
    } catch (cleanupError) {
      logger.warn(`임시 패치 파일 정리 실패: ${tempPatchFile}`, {
        cleanupError,
      });
    }
  }
}

/**
 * Patch 적용 도구를 생성합니다.
 *
 * @description
 * Git diff 형식의 패치를 파일에 적용하는 LangChain 도구를 생성합니다.
 * 3단계 폴백 전략으로 최대한의 성공률을 보장합니다.
 *
 * 처리 흐름:
 * 1. 파일 읽기 (readFile)
 * 2. Git CLI로 패치 적용 시도 (applyPatchWithGit)
 * 3. Git 성공:
 *    - 업데이트된 파일 읽기
 *    - 성공 메시지 반환
 * 4. Git 실패:
 *    - diff 라이브러리로 폴백
 *    - applyPatch(content, diff) 호출
 * 5. diff 라이브러리 실패:
 *    - fixGitPatch로 diff 수정
 *    - 수정된 diff로 재시도
 * 6. 모든 시도 실패:
 *    - Git + diff 오류 모두 포함한 상세 에러
 *
 * 폴백 전략:
 * - 1차: Git CLI (가장 신뢰할 수 있음)
 * - 2차: diff 라이브러리 (Git 실패 시)
 * - 3차: diff 수정 + 재시도 (형식 오류 시)
 *
 * 입력 파라미터:
 * - diff: Git diff 형식의 패치 (unified diff)
 * - file_path: 패치를 적용할 파일 경로
 *
 * 출력:
 * - result: 성공/실패 메시지 (Git 오류 정보 포함)
 * - status: "success" | "error"
 *
 * @param {GraphState} state - 그래프 상태 (targetRepository)
 * @param {GraphConfig} config - 그래프 설정 (로컬/샌드박스 모드)
 * @returns {Tool} 생성된 apply_patch 도구
 *
 * @example
 * // Programmer 그래프에서 사용
 * const tool = createApplyPatchTool(state, config);
 * const result = await tool.invoke({
 *   diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@...",
 *   file_path: "src/file.ts"
 * });
 */
export function createApplyPatchTool(state: GraphState, config: GraphConfig) {
  const applyPatchTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      const { diff, file_path } = input;

      // === 1단계: 작업 디렉토리 결정 ===
      const workDir = isLocalMode(config)
        ? getLocalWorkingDirectory()
        : getRepoAbsolutePath(state.targetRepository);

      // === 2단계: 샌드박스 세션 가져오기 (샌드박스 모드만) ===
      const sandbox = isLocalMode(config)
        ? null
        : await getSandboxSessionOrThrow(input);

      // === 3단계: 원본 파일 읽기 ===
      const readFileResult = await readFile({
        sandbox,
        filePath: file_path,
        workDir,
        config,
      });

      if (!readFileResult.success) {
        throw new Error(readFileResult.output);
      }

      // === 4단계: Git CLI로 패치 적용 시도 (1차 전략) ===
      logger.info(`Git CLI를 사용하여 ${file_path}에 패치 적용 시도 중`);
      const gitResult = await applyPatchWithGit(sandbox, workDir, diff, config);

      const readFileOutput = readFileResult.output;

      // === 5단계: Git 성공 시 업데이트된 파일 읽고 반환 ===
      if (gitResult.success) {
        const readUpdatedResult = await readFile({
          sandbox,
          filePath: file_path,
          workDir,
          config,
        });

        if (!readUpdatedResult.success) {
          throw new Error(
            `패치 적용 후 업데이트된 파일을 읽는 데 실패했습니다: ${readUpdatedResult.output}`,
          );
        }

        logger.info(`Git CLI를 사용하여 ${file_path}에 diff를 성공적으로 적용했습니다.`);
        return {
          result: `\`${file_path}\`에 diff를 성공적으로 적용하고 변경 사항을 저장했습니다.`,
          status: "success",
        };
      }

      // === 6단계: Git 실패 - diff 라이브러리로 폴백 (2차 전략) ===
      logger.warn(
        `Git CLI 패치 적용 실패: ${gitResult.output}. diff 라이브러리로 대체합니다.`,
      );

      let patchedContent: string | false;
      let fixedDiff: string | false = false;
      let errorApplyingPatchMessage: string | undefined;

      try {
        // === 6-1: diff 라이브러리로 패치 적용 ===
        logger.info(`diff 라이브러리를 사용하여 파일 ${file_path}에 패치 적용 중`);
        patchedContent = applyPatch(readFileOutput, diff);
      } catch (e) {
        // === 6-2: diff 라이브러리 실패 - diff 수정 후 재시도 (3차 전략) ===
        errorApplyingPatchMessage =
          e instanceof Error ? e.message : "알 수 없는 오류";
        try {
          logger.warn(
            "패치 적용 실패: 잘못된 diff. 수정을 시도합니다.",
            {
              ...(e instanceof Error
                ? { name: e.name, message: e.message, stack: e.stack }
                : { error: e }),
            },
          );

          // fixGitPatch로 diff 형식 수정
          const fixedDiff_ = fixGitPatch(diff, {
            [file_path]: readFileOutput,
          });

          // 수정된 diff로 재시도
          patchedContent = applyPatch(readFileOutput, fixedDiff_);
          if (patchedContent) {
            logger.info("diff를 성공적으로 수정하고 파일에 패치를 적용했습니다.", {
              file_path,
            });
            fixedDiff = fixedDiff_;
          }
        } catch (_) {
          // === 6-3: 모든 전략 실패 - Git + diff 오류 통합 반환 ===
          const diffErrMessage =
            e instanceof Error ? e.message : "알 수 없는 오류";
          throw new Error(
            `패치 적용 실패: diff를 파일 '${file_path}'에 적용할 수 없습니다.\n\n` +
              `Git 오류: ${gitResult.output}\n\n` +
              `Diff 라이브러리 오류: ${diffErrMessage}`,
          );
        }
      }

      // === 7단계: diff 라이브러리 결과 검증 ===
      if (patchedContent === false) {
        throw new Error(
          `패치 적용 실패: diff를 파일 '${file_path}'에 적용할 수 없습니다.\n\n` +
            `Git 오류: ${gitResult.output}\n\n` +
            `잘못된 diff 형식이거나 파일의 현재 내용과 충돌하는 변경 사항 때문일 수 있습니다. ` +
            `원본 내용 길이: ${readFileOutput.length}, Diff: ${diff.substring(0, 100)}...`,
        );
      }

      // === 8단계: 패치된 내용 파일에 쓰기 ===
      const writeFileResult = await writeFile({
        sandbox,
        filePath: file_path,
        content: patchedContent,
        workDir,
        config,
      });

      if (!writeFileResult.success) {
        throw new Error(writeFileResult.output);
      }

      // === 9단계: 성공 메시지 생성 ===
      let resultMessage = `\`${file_path}\`에 diff를 성공적으로 적용하고 변경 사항을 저장했습니다.`;
      logger.info(resultMessage);

      // diff 수정이 필요했던 경우 경고 포함
      if (fixedDiff) {
        resultMessage +=
          "\n\n참고: 생성된 diff의 형식이 올바르지 않아 수정해야 했습니다." +
          `\n생성된 diff가 적용되었을 때 발생한 오류는 다음과 같습니다:\n<apply-diff-error>\n${errorApplyingPatchMessage}\n</apply-diff-error>` +
          `\n적용된 diff는 다음과 같습니다:\n<fixed-diff>\n${fixedDiff}\n</fixed-diff>`;
      }

      // Git 오류도 컨텍스트로 포함 (LLM이 개선할 수 있도록)
      resultMessage += `\n\nGit apply 시도 실패 메시지:\n<git-error>\n${gitResult.output}\n</git-error>`;

      // === 10단계: 성공 결과 반환 ===
      return {
        result: resultMessage,
        status: "success",
      };
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createApplyPatchToolFields(state.targetRepository),
  );
  return applyPatchTool;
}
