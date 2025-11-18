/**
 * @file auth.ts
 * @description GitHub 앱 인증과 관련된 함수를 제공합니다.
 * 주어진 설치 ID(installation ID)에 대한 접근 토큰을 생성하는 로직을 포함합니다.
 */

import { generateJWT } from "../jwt.js";

// 문자열에 포함된 `\n`을 실제 개행 문자로 변환하는 헬퍼 함수입니다.
const convertEscapedNewlinesToNewlines = (str: string) =>
  str.replace(/\\n/g, "\n");

/**
 * GitHub 앱 설치(installation)에 대한 접근 토큰을 가져옵니다.
 * @param installationId - GitHub 앱 설치 ID입니다.
 * @param appId - GitHub 앱의 ID입니다.
 * @param privateKey - GitHub 앱의 비공개 키입니다.
 * @returns {Promise<string>} 생성된 설치 접근 토큰을 반환하는 프로미스.
 * @throws {Error} 토큰 생성에 실패하면 에러를 발생시킵니다.
 */
export async function getInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
): Promise<string> {
  // 앱 인증을 위한 JWT를 생성합니다.
  const jwtToken = generateJWT(
    appId,
    convertEscapedNewlinesToNewlines(privateKey),
  );

  // GitHub API에 설치 접근 토큰을 요청합니다.
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "OpenSWE-Agent",
      },
    },
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `설치 토큰을 가져오는 데 실패했습니다: ${JSON.stringify(errorData)}`,
    );
  }

  const data = await response.json();
  if (typeof data !== "object" || !data || !("token" in data)) {
    throw new Error("설치 토큰을 가져온 후 반환된 토큰이 없습니다.");
  }
  return data.token as string;
}