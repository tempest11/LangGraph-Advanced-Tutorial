/**
 * @file diff.ts
 * @description
 * Git diff 패치를 파싱하고 수정하는 유틸리티 함수를 제공합니다.
 * LLM이 생성한 잘못된 diff를 실제 파일 내용과 비교하여 자동으로 수정합니다.
 */

import { createLogger, LogLevel } from "./logger.js";

const logger = createLogger(LogLevel.INFO, "DiffUtil");

/**
 * diff의 hunk(변경 사항 덩어리)를 나타내는 인터페이스입니다.
 */
interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  context: string;
  lines: string[];
}

/**
 * diff의 파일 정보를 나타내는 인터페이스입니다.
 */
interface PatchFile {
  oldFile: string;
  newFile: string | null;
  hunks: Hunk[];
}

/**
 * 파싱된 diff 정보를 나타내는 인터페이스입니다.
 */
interface ParsedPatch {
  files: PatchFile[];
}

/**
 * 파일 내용을 담는 객체의 타입입니다.
 */
interface FileContents {
  [filename: string]: string;
}

/**
 * 잘못된 Git diff 패치를 수정합니다.
 *
 * @description
 * LLM이 생성한 diff는 종종 잘못된 줄 번호나 컨텍스트를 가질 수 있습니다.
 * 이 함수는 diff를 파싱하고, 실제 파일 내용과 비교하여 줄 번호와 컨텍스트를 수정합니다.
 *
 * @param patchString - 수정할 diff 문자열
 * @param fileContents - 관련 파일의 내용을 담은 객체
 * @returns 수정된 diff 문자열
 */
export function fixGitPatch(
  patchString: string,
  fileContents: FileContents,
): string {
  // 먼저 패치 문자열을 정규화합니다. 필요한 경우 리터럴 \n을 실제 줄 바꿈으로 변환합니다.
  const normalizedPatch: string = patchString.includes("\\n")
    ? patchString.replace(/\\n/g, "\n")
    : patchString;

  /**
   * diff 문자열을 구조화된 형식으로 파싱합니다.
   * @param patch - 파싱할 diff 문자열.
   * @returns 파싱된 diff 객체.
   */
  function parsePatch(patch: string): ParsedPatch {
    const lines: string[] = patch
      .split("\n")
      .filter((line): line is string => line !== undefined);
    const result: ParsedPatch = {
      files: [],
    };

    let currentFile: PatchFile | null = null;
    let currentHunk: Hunk | null = null;
    let i: number = 0;

    while (i < lines.length) {
      const line: string = lines[i];

      // 파일 사이의 빈 줄 건너뛰기
      if (!line && !currentHunk) {
        i++;
        continue;
      }

      // 파일 헤더
      if (line.startsWith("--- ")) {
        if (currentFile && currentFile.hunks.length > 0) {
          result.files.push(currentFile);
        }
        // --- a/file 및 --- file 형식 모두 처리
        const filename: string = line.startsWith("--- a/")
          ? line.substring(6)
          : line.substring(4);
        currentFile = {
          oldFile: filename,
          newFile: null,
          hunks: [],
        };
        currentHunk = null;
        i++;
        continue;
      }

      if (line.startsWith("+++ ") && currentFile) {
        // +++ b/file 및 +++ file 형식 모두 처리
        currentFile.newFile = line.startsWith("+++ b/")
          ? line.substring(6)
          : line.substring(4);
        i++;
        continue;
      }

      // Hunk 헤더
      if (line.startsWith("@@")) {
        const match: RegExpMatchArray | null = line.match(
          /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/,
        );
        if (match) {
          currentHunk = {
            oldStart: parseInt(match[1]),
            oldLines: parseInt(match[2] || "1"),
            newStart: parseInt(match[3]),
            newLines: parseInt(match[4] || "1"),
            context: match[5] || "",
            lines: [],
          };
          if (currentFile) {
            currentFile.hunks.push(currentHunk);
          }
        }
        i++;
        continue;
      }

      // Hunk 내용
      if (currentHunk) {
        // diff 내용의 경우, diff의 일부인 모든 줄을 포함합니다.
        if (
          line.startsWith(" ") ||
          line.startsWith("+") ||
          line.startsWith("-")
        ) {
          currentHunk.lines.push(line);
        }
      }

      i++;
    }

    if (currentFile && currentFile.hunks.length > 0) {
      result.files.push(currentFile);
    }

    return result;
  }

  /**
   * 파일 내용을 줄 배열로 가져옵니다.
   * @param filename - 파일 이름.
   * @param contents - 파일 내용을 담은 객체.
   * @returns 파일 내용의 줄 배열.
   */
  function getFileLines(filename: string, contents: FileContents): string[] {
    // 새 파일의 경우 /dev/null 처리
    if (filename === "/dev/null") {
      return [];
    }

    // 여러 파일 이름 변형 시도
    const variations: string[] = [
      filename,
      filename.replace(/^\.\//, ""),
      "./" + filename,
      filename.replace(/^\//, ""),
      filename.replace(/^a\//, ""),
      filename.replace(/^b\//, ""),
    ];

    for (const variant of variations) {
      if (variant in contents) {
        return contents[variant].split("\n");
      }
    }

    return [];
  }

  /**
   * 새 파일 생성인지 확인합니다.
   * @param hunk - 확인할 Hunk.
   * @returns 새 파일인 경우 true, 그렇지 않으면 false.
   */
  function isNewFile(hunk: Hunk): boolean {
    return hunk.oldStart === 0 && hunk.oldLines === 0;
  }

  /**
   * 파일 삭제인지 확인합니다.
   * @param hunk - 확인할 Hunk.
   * @returns 파일 삭제인 경우 true, 그렇지 않으면 false.
   */
  function isFileDeleted(hunk: Hunk): boolean {
    return hunk.newStart === 0 && hunk.newLines === 0;
  }

  /**
   * 단일 hunk를 수정합니다.
   * @param hunk - 수정할 Hunk.
   * @param fileLines - 파일 내용의 줄 배열.
   * @returns 수정된 Hunk.
   */
  function fixHunk(hunk: Hunk, fileLines: string[]): Hunk {
    // 새 파일의 경우 줄 수만 확인
    if (isNewFile(hunk)) {
      let newCount: number = 0;
      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          newCount++;
        }
      }

      return {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: newCount,
        context: hunk.context,
        lines: [...hunk.lines],
      };
    }

    // 파일 삭제의 경우
    if (isFileDeleted(hunk)) {
      let oldCount: number = 0;
      for (const line of hunk.lines) {
        if (line.startsWith("-")) {
          oldCount++;
        }
      }

      return {
        oldStart: hunk.oldStart,
        oldLines: oldCount,
        newStart: 0,
        newLines: 0,
        context: hunk.context,
        lines: [...hunk.lines],
      };
    }

    // 일반적인 수정의 경우
    // 일치를 위해 컨텍스트 및 제거된 줄 추출
    const matchLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.startsWith(" ") || line.startsWith("-")) {
        matchLines.push(line.substring(1));
      }
    }

    // 이 hunk가 실제로 속한 위치 찾기
    let actualStart: number = -1;
    if (matchLines.length > 0 && fileLines.length > 0) {
      actualStart = findBestMatch(fileLines, matchLines, hunk.oldStart);
    }

    // 실제 이전 및 새 줄 수 계산
    let oldCount: number = 0;
    let newCount: number = 0;

    for (const line of hunk.lines) {
      if (line.startsWith(" ")) {
        oldCount++;
        newCount++;
      } else if (line.startsWith("-")) {
        oldCount++;
      } else if (line.startsWith("+")) {
        newCount++;
      }
    }

    // 수정된 hunk 빌드
    return {
      oldStart: actualStart >= 0 ? actualStart + 1 : hunk.oldStart,
      oldLines: oldCount,
      newStart: actualStart >= 0 ? actualStart + 1 : hunk.newStart,
      newLines: newCount,
      context: hunk.context,
      lines: [...hunk.lines],
    };
  }

  /**
   * 파일에서 줄에 대한 최상의 일치 항목을 찾습니다.
   * @param fileLines - 파일 내용의 줄 배열.
   * @param searchLines - 검색할 줄 배열.
   * @param startHint - 검색을 시작할 힌트 위치.
   * @returns 최상의 일치 항목의 시작 인덱스 또는 -1.
   */
  function findBestMatch(
    fileLines: string[],
    searchLines: string[],
    startHint: number,
  ): number {
    if (searchLines.length === 0) {
      return startHint - 1;
    }

    // 먼저 정확한 위치 시도
    if (matchesAt(fileLines, searchLines, startHint - 1)) {
      return startHint - 1;
    }

    // 근처 줄 검색
    const searchRadius: number = Math.min(100, fileLines.length);
    for (let offset: number = 1; offset <= searchRadius; offset++) {
      // 이전 시도
      if (
        startHint - 1 - offset >= 0 &&
        matchesAt(fileLines, searchLines, startHint - 1 - offset)
      ) {
        return startHint - 1 - offset;
      }
      // 이후 시도
      if (
        startHint - 1 + offset < fileLines.length &&
        matchesAt(fileLines, searchLines, startHint - 1 + offset)
      ) {
        return startHint - 1 + offset;
      }
    }

    // 전체 파일 검색
    for (let i: number = 0; i <= fileLines.length - searchLines.length; i++) {
      if (matchesAt(fileLines, searchLines, i)) {
        return i;
      }
    }

    return -1;
  }

  /**
   * 지정된 위치에서 줄이 일치하는지 확인합니다.
   * @param fileLines - 파일 내용의 줄 배열.
   * @param searchLines - 검색할 줄 배열.
   * @param position - 확인할 위치.
   * @returns 일치하면 true, 그렇지 않으면 false.
   */
  function matchesAt(
    fileLines: string[],
    searchLines: string[],
    position: number,
  ): boolean {
    if (position < 0 || position + searchLines.length > fileLines.length) {
      return false;
    }

    for (let i: number = 0; i < searchLines.length; i++) {
      if (fileLines[position + i].trim() !== searchLines[i].trim()) {
        return false;
      }
    }
    return true;
  }

  /**
   * 파싱된 diff 데이터에서 diff 문자열을 다시 빌드합니다.
   * @param patchData - 파싱된 diff 데이터.
   * @returns 빌드된 diff 문자열.
   */
  function buildPatch(patchData: ParsedPatch): string {
    const result: string[] = [];

    for (const file of patchData.files) {
      // 원본 패치의 정확한 형식 사용
      if (file.oldFile.startsWith("./") || file.oldFile.includes("/")) {
        result.push(`--- a/${file.oldFile}`);
        result.push(`+++ b/${file.newFile}`);
      } else {
        result.push(`--- ${file.oldFile}`);
        result.push(`+++ ${file.newFile}`);
      }

      let cumulativeOffset: number = 0;

      for (const hunk of file.hunks) {
        // 새 파일의 경우 newStart를 1로 유지
        let adjustedNewStart: number = hunk.newStart;
        if (!isNewFile(hunk) && !isFileDeleted(hunk)) {
          adjustedNewStart = hunk.newStart + cumulativeOffset;
        }

        // Hunk 헤더 빌드
        let header: string = `@@ -${hunk.oldStart}`;
        if (hunk.oldLines !== 1 || hunk.oldStart === 0) {
          header += `,${hunk.oldLines}`;
        }
        header += ` +${adjustedNewStart}`;
        if (hunk.newLines !== 1 || adjustedNewStart === 0) {
          header += `,${hunk.newLines}`;
        }
        header += ` @@`;
        if (hunk.context) {
          header += hunk.context;
        }
        result.push(header);

        // Hunk 줄 추가
        for (const line of hunk.lines) {
          result.push(line);
        }

        // 누적 오프셋 업데이트
        if (!isNewFile(hunk) && !isFileDeleted(hunk)) {
          cumulativeOffset += hunk.newLines - hunk.oldLines;
        }
      }
    }

    return result.join("\n");
  }

  // 주 로직
  try {
    const parsed: ParsedPatch = parsePatch(normalizedPatch);

    if (parsed.files.length === 0) {
      return patchString;
    }

    for (const file of parsed.files) {
      const fileLines: string[] = getFileLines(file.oldFile, fileContents);
      const fixedHunks: Hunk[] = [];

      for (const hunk of file.hunks) {
        const fixedHunk: Hunk = fixHunk(hunk, fileLines);
        if (fixedHunk) {
          fixedHunks.push(fixedHunk);
        }
      }

      file.hunks = fixedHunks;
    }

    const result: string = buildPatch(parsed);

    // 리터럴 \n을 줄 구분 기호로 사용하는 패치에 대한 더 강력한 확인
    const usesLiteralNewlines =
      /^[^\\]*\\n/.test(patchString) && patchString.split("\n").length === 1;

    if (usesLiteralNewlines && !result.includes("\\n")) {
      return result.replace(/\n/g, "\\n");
    }

    return result;
  } catch (e) {
    logger.error(`패치 수정 오류:`, {
      ...(e instanceof Error
        ? { name: e.name, message: e.message, stack: e.stack }
        : { error: e }),
    });
    return patchString;
  }
}
