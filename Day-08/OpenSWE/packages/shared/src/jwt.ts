/**
 * @file jwt.ts
 * @description GitHub 앱 인증을 위한 JSON Web Token(JWT) 생성 유틸리티를 제공합니다.
 */

import jsonwebtoken from "jsonwebtoken";

/**
 * GitHub 앱 인증을 위한 JWT를 생성합니다.
 * @param appId - GitHub 앱의 ID입니다.
 * @param privateKey - GitHub 앱의 비공개 키입니다.
 * @returns {string} 생성된 JWT 문자열.
 */
export function generateJWT(appId: string, privateKey: string): string {
  // 현재 시간을 Unix 타임스탬프(초)로 가져옵니다.
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iat: now, // 발행 시간 (issued at)
    exp: now + 10 * 60, // 만료 시간 (expiration time), 10분 후
    iss: appId, // 발행자 (issuer), 앱 ID
  };

  // RS256 알고리즘으로 페이로드에 서명하여 JWT를 생성합니다.
  return jsonwebtoken.sign(payload, privateKey, { algorithm: "RS256" });
}