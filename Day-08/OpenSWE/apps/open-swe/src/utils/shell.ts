/**
 * @file shell.ts
 * @description
 * 셸 명령어 분석 유틸리티 함수를 제공합니다.
 * 명령어가 쓰기 작업인지 판별합니다.
 */

/**
 * 주어진 명령어가 파일 쓰기 작업인지 확인합니다.
 *
 * @param command - 검사할 명령어 배열
 * @returns 쓰기 명령어이면 true
 */
export function isWriteCommand(command: string[]): boolean {
  const writeCommands = [
    "cat",
    "echo",
    "printf",
    "tee",
    "cp",
    "mv",
    "ln",
    "install",
    "rsync",
  ];

  return writeCommands.includes(command[0]);
}
