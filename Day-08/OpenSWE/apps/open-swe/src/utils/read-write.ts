/**
 * @file read-write.ts
 * @description
 * 파일 읽기/쓰기/생성/삭제 유틸리티 함수를 제공합니다.
 * 로컬 모드와 샌드박스 모드를 모두 지원합니다.
 */

import { Sandbox } from "@daytonaio/sdk";
import { createLogger, LogLevel } from "./logger.js";
import { getSandboxErrorFields } from "./sandbox-error-fields.js";
import { traceable } from "langsmith/traceable";
import {
  isLocalMode,
  getLocalWorkingDirectory,
} from "@openswe/shared/open-swe/local-mode";
import { promises as fs } from "fs";
import { join, isAbsolute } from "path";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import { createShellExecutor } from "./shell-executor/shell-executor.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger(LogLevel.INFO, "ReadWriteUtil");

/**
 * 파일을 생성합니다. 로컬 모드와 샌드박스 모드를 모두 지원합니다.
 * @param sandbox - 샌드박스 인스턴스 (로컬 모드에서는 null).
 * @param filePath - 생성할 파일 경로.
 * @param config - 그래프 설정.
 * @param args - 추가 인수 (작업 디렉토리).
 * @returns 실행 결과.
 */
async function handleCreateFile(
  sandbox: Sandbox | null,
  filePath: string,
  config: GraphConfig,
  args?: {
    workDir?: string;
  },
) {
  if (isLocalMode(config)) {
    return handleCreateFileLocal(filePath, args?.workDir);
  }

  try {
    const executor = createShellExecutor(config);
    const touchOutput = await executor.executeCommand({
      command: `touch "${filePath}"`,
      workdir: args?.workDir,
      sandbox: sandbox ?? undefined,
    });
    return touchOutput;
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    if (errorFields) {
      return errorFields;
    }
    return {
      exitCode: 1,
      error: e instanceof Error ? e.message : String(e),
      stdout: "",
      stderr: "",
    };
  }
}

/**
 * 파일을 읽는 내부 함수입니다.
 * @param inputs - 파일 읽기 입력.
 * @returns 파일 읽기 결과.
 */
async function readFileFunc(inputs: {
  sandbox: Sandbox | null;
  filePath: string;
  workDir?: string;
  config: GraphConfig;
}): Promise<{
  success: boolean;
  output: string;
}> {
  const { sandbox, filePath, workDir, config } = inputs;

  if (isLocalMode(config)) {
    return readFileLocal(filePath, workDir);
  }

  const executor = createShellExecutor(config);

  try {
    const readOutput = await executor.executeCommand({
      command: `cat "${filePath}"`,
      workdir: workDir,
      sandbox: sandbox ?? undefined,
    });

    if (readOutput.exitCode !== 0) {
      const errorResult = readOutput.result ?? readOutput.artifacts?.stdout;
      return {
        success: false,
        output: `샌드박스에서 파일 읽기 실패 '${filePath}'. 종료 코드: ${readOutput.exitCode}.\n결과: ${errorResult}`,
      };
    }

    return {
      success: true,
      output: readOutput.result,
    };
  } catch (e: any) {
    if (e instanceof Error && e.message.includes("No such file or directory")) {
      let createOutput;
      if (config && isLocalMode(config)) {
        // 로컬 모드: handleCreateFileLocal 사용
        createOutput = await handleCreateFileLocal(filePath, workDir);
      } else {
        // 샌드박스 모드: handleCreateFile 사용
        createOutput = await handleCreateFile(sandbox, filePath, config, {
          workDir,
        });
      }
      if (createOutput.exitCode !== 0) {
        return {
          success: false,
          output: `${config && isLocalMode(config) ? "로컬" : "샌드박스"} '${filePath}'에 대한 읽기 명령 실행 실패. 오류: ${(e as Error).message || String(e)}`,
        };
      } else {
        // 파일이 성공적으로 생성되면 다시 읽기를 시도합니다.
        return readFile(inputs);
      }
    }

    logger.error(
      `cat을 통해 샌드박스에서 파일 '${filePath}'을 읽는 중 예외 발생:`,
      {
        ...(e instanceof Error
          ? { name: e.name, message: e.message, stack: e.stack }
          : { error: e }),
      },
    );
    let outputMessage = `샌드박스 '${filePath}'에 대한 읽기 명령 실행 실패.`;
    const errorFields = getSandboxErrorFields(e);
    if (errorFields) {
      const errorResult = errorFields.result ?? errorFields.artifacts?.stdout;

      outputMessage += `\n종료 코드: ${errorFields.exitCode}\n결과: ${errorResult}`;
    } else {
      outputMessage += ` 오류: ${(e as Error).message || String(e)}`;
    }

    if (outputMessage.includes("No such file or directory")) {
      outputMessage += `\n\`workdir\` 및 \`file_path\`에 전달한 파일 경로가 유효하고, 결합했을 때 샌드박스의 유효한 파일을 가리키는지 확인하십시오.`;
    }

    return {
      success: false,
      output: outputMessage,
    };
  }
}

/**
 * 추적 가능한 파일 읽기 함수입니다.
 */
export const readFile = traceable(readFileFunc, {
  name: "read_file",
  processInputs: (inputs) => {
    const { sandbox: _sandbox, config: _config, ...rest } = inputs;
    return rest;
  },
});

/**
 * 파일에 쓰는 내부 함수입니다.
 * @param inputs - 파일 쓰기 입력.
 * @returns 파일 쓰기 결과.
 */
async function writeFileFunc(inputs: {
  sandbox: Sandbox | null;
  filePath: string;
  content: string;
  workDir?: string;
  config?: GraphConfig;
}): Promise<{
  success: boolean;
  output: string;
}> {
  const { sandbox, filePath, content, workDir, config } = inputs;

  // 로컬 모드인지 확인
  if (config && isLocalMode(config)) {
    return writeFileLocal(filePath, content, workDir);
  }

  if (!sandbox) {
    throw new Error("로컬 모드가 아닐 때는 샌드박스가 필요합니다.");
  }

  try {
    const delimiter = `EOF_${uuidv4()}`;
    const writeCommand = `cat > "${filePath}" << '${delimiter}'
${content}
${delimiter}`;
    const executor = createShellExecutor(config);
    const writeOutput = await executor.executeCommand({
      command: writeCommand,
      workdir: workDir,
      sandbox: sandbox ?? undefined,
    });

    if (writeOutput.exitCode !== 0) {
      const errorResult = writeOutput.result ?? writeOutput.artifacts?.stdout;
      return {
        success: false,
        output: `샌드박스에 파일 쓰기 실패 '${filePath}'. 종료 코드: ${writeOutput.exitCode}\n결과: ${errorResult}`,
      };
    }
    return {
      success: true,
      output: `cat을 통해 샌드박스에 파일 '${filePath}'을 성공적으로 썼습니다.`,
    };
  } catch (e: any) {
    logger.error(
      `cat을 통해 샌드박스에 파일 '${filePath}'을 쓰는 중 예외 발생:`,
      {
        ...(e instanceof Error
          ? { name: e.name, message: e.message, stack: e.stack }
          : { error: e }),
      },
    );

    let outputMessage = `샌드박스 '${filePath}'에 대한 쓰기 명령 실행 실패.`;
    const errorFields = getSandboxErrorFields(e);
    if (errorFields) {
      const errorResult = errorFields.result ?? errorFields.artifacts?.stdout;
      outputMessage += `\n종료 코드: ${errorFields.exitCode}\n결과: ${errorResult}`;
    } else {
      outputMessage += ` 오류: ${(e as Error).message || String(e)}`;
    }

    return {
      success: false,
      output: outputMessage,
    };
  }
}

/**
 * 추적 가능한 파일 쓰기 함수입니다.
 */
export const writeFile = traceable(writeFileFunc, {
  name: "write_file",
  processInputs: (inputs) => {
    const { sandbox: _sandbox, config: _config, ...rest } = inputs;
    return rest;
  },
});

/**
 * Node.js fs를 사용하는 로컬 버전의 readFile입니다.
 * @param filePath - 파일 경로.
 * @param workDir - 작업 디렉토리.
 * @returns 파일 읽기 결과.
 */
async function readFileLocal(
  filePath: string,
  workDir?: string,
): Promise<{
  success: boolean;
  output: string;
}> {
  try {
    const workingDirectory = workDir || getLocalWorkingDirectory();
    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(workingDirectory, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return {
      success: true,
      output: content,
    };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // 파일이 존재하지 않으면 생성합니다.
      try {
        const workingDirectory = workDir || getLocalWorkingDirectory();
        const fullPath = isAbsolute(filePath)
          ? filePath
          : join(workingDirectory, filePath);
        await fs.writeFile(fullPath, "", "utf-8");
        return {
          success: true,
          output: "",
        };
      } catch (createError: any) {
        return {
          success: false,
          output: `파일 읽기 오류 코드 ${error.code} 발생 후 파일 '${filePath}' 자동 생성 실패. 오류: ${createError.message}`,
        };
      }
    }
    return {
      success: false,
      output: `파일 '${filePath}' 읽기 실패. 오류: ${error.message}`,
    };
  }
}

/**
 * Node.js fs를 사용하는 로컬 버전의 writeFile입니다.
 * @param filePath - 파일 경로.
 * @param content - 쓸 내용.
 * @param workDir - 작업 디렉토리.
 * @returns 파일 쓰기 결과.
 */
async function writeFileLocal(
  filePath: string,
  content: string,
  workDir?: string,
): Promise<{
  success: boolean;
  output: string;
}> {
  try {
    const workingDirectory = workDir || getLocalWorkingDirectory();
    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(workingDirectory, filePath);
    await fs.writeFile(fullPath, content, "utf-8");
    return {
      success: true,
      output: `로컬 파일 시스템에 파일 '${filePath}'을 성공적으로 썼습니다.`,
    };
  } catch (error: any) {
    return {
      success: false,
      output: `파일 '${filePath}' 쓰기 실패. 오류: ${error.message}`,
    };
  }
}

/**
 * Node.js fs를 사용하는 로컬 버전의 handleCreateFile입니다.
 * @param filePath - 파일 경로.
 * @param workDir - 작업 디렉토리.
 * @returns 파일 생성 결과.
 */
async function handleCreateFileLocal(
  filePath: string,
  workDir?: string,
): Promise<{
  exitCode: number;
  error?: string;
  stdout: string;
  stderr: string;
}> {
  try {
    const workingDirectory = workDir || getLocalWorkingDirectory();
    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(workingDirectory, filePath);
    await fs.writeFile(fullPath, "", "utf-8");
    return {
      exitCode: 0,
      stdout: `파일 '${filePath}' 생성됨`,
      stderr: "",
    };
  } catch (error: any) {
    return {
      exitCode: 1,
      error: error.message,
      stdout: "",
      stderr: error.message,
    };
  }
}
