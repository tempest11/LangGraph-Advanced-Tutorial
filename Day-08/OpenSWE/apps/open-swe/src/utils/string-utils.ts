/**
 * @file string-utils.ts
 * @description
 * 문자열 처리 유틸리티 함수들을 제공합니다.
 * 정규표현식 이스케이프 등 안전한 문자열 조작에 사용됩니다.
 */

/**
 * 정규표현식 메타문자를 이스케이프하여 리터럴 문자로 취급되도록 변환합니다.
 *
 * @description
 * 사용자 입력을 정규표현식 패턴으로 안전하게 변환할 때 유용합니다.
 * 모든 정규표현식 특수 문자(`.`, `*`, `+`, `?`, `^`, `$`, `{`, `}`, `(`, `)`, `|`, `[`, `]`, `\\`)를
 * 백슬래시로 이스케이프하여 문자 그대로 매칭되도록 합니다.
 *
 * @param string - 이스케이프할 문자열
 * @returns RegExp 생성자에서 안전하게 사용할 수 있도록 이스케이프된 문자열
 *
 * @example
 * escapeRegExp("hello.world")  // "hello\\.world"
 * escapeRegExp("test*file")    // "test\\*file"
 * escapeRegExp("path[0]")      // "path\\[0\\]"
 *
 * // 사용 예: 사용자 입력을 정규표현식에 안전하게 사용
 * const userInput = "file.txt";
 * const pattern = new RegExp(escapeRegExp(userInput));
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
