/**
 * @file crypto.ts
 * @description AES-256-GCM 알고리즘을 사용하여 GitHub 토큰과 같은 비밀 정보를 안전하게
 * 암호화하고 복호화하는 유틸리티 모듈입니다. 인증된 암호화를 통해 데이터의 기밀성과
 * 무결성을 보장합니다.
 */

import * as crypto from "node:crypto";

// 암호화에 사용될 알고리즘 및 관련 상수 정의
const ALGORITHM = "aes-256-gcm"; // 인증된 암호화를 제공하는 AES-256-GCM
const IV_LENGTH = 12; // 96비트 (GCM 표준)
const TAG_LENGTH = 16; // 128비트 (인증 태그 길이)

/**
 * 제공된 암호화 키 문자열로부터 256비트 키를 파생시킵니다.
 * SHA-256 해시 함수를 사용하여 일관된 길이의 키를 보장합니다.
 * @param encryptionKey - 키 파생에 사용될 원본 문자열입니다.
 * @returns {Buffer} 256비트(32바이트) 길이의 파생된 키 버퍼.
 */
function deriveKey(encryptionKey: string): Buffer {
  return crypto.createHash("sha256").update(encryptionKey).digest();
}

/**
 * AES-256-GCM을 사용하여 비밀 정보를 암호화합니다.
 *
 * @param secret - 암호화할 비밀 정보 문자열입니다.
 * @param encryptionKey - 암호화에 사용될 키 문자열입니다 (256비트로 해시됨).
 * @returns {string} IV, 암호화된 데이터, 인증 태그가 포함된 Base64 인코딩된 문자열을 반환합니다.
 * @throws {Error} 암호화에 실패하거나 입력값이 유효하지 않을 경우 에러를 발생시킵니다.
 */
export function encryptSecret(secret: string, encryptionKey: string): string {
  if (!secret || typeof secret !== "string") {
    throw new Error("비밀 정보는 비어 있지 않은 문자열이어야 합니다.");
  }

  if (!encryptionKey || typeof encryptionKey !== "string") {
    throw new Error("암호화 키는 비어 있지 않은 문자열이어야 합니다.");
  }

  try {
    // 각 암호화마다 무작위 IV(초기화 벡터)를 생성합니다 (GCM의 경우 12바이트).
    const iv = crypto.randomBytes(IV_LENGTH);

    // 암호화 키를 파생시킵니다.
    const key = deriveKey(encryptionKey);

    // 암호화 객체를 생성합니다.
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // 비밀 정보를 암호화합니다.
    const encryptedBuffer = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);

    // 인증 태그를 가져옵니다.
    const tag = cipher.getAuthTag();

    // IV, 암호화된 데이터, 태그를 하나의 Base64 문자열로 결합합니다.
    // 포맷: IV (12바이트) + 암호화된 데이터 + 인증 태그 (16바이트)
    const combined = Buffer.concat([iv, encryptedBuffer, tag]);
    return combined.toString("base64");
  } catch (error) {
    throw new Error(
      `비밀 정보 암호화 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    );
  }
}

/**
 * AES-256-GCM을 사용하여 비밀 정보를 복호화합니다.
 *
 * @param encryptedSecret - `encryptSecret` 함수로부터 받은 Base64 인코딩된 암호문입니다.
 * @param encryptionKey - 암호화에 사용되었던 키 문자열입니다.
 * @returns {string} 복호화된 원본 비밀 정보를 반환합니다.
 * @throws {Error} 복호화에 실패하거나 입력값이 유효하지 않을 경우 에러를 발생시킵니다.
 */
export function decryptSecret(
  encryptedSecret: string,
  encryptionKey: string,
): string {
  if (!encryptedSecret || typeof encryptedSecret !== "string") {
    throw new Error("암호화된 비밀 정보는 비어 있지 않은 문자열이어야 합니다.");
  }

  if (!encryptionKey || typeof encryptionKey !== "string") {
    throw new Error("암호화 키는 비어 있지 않은 문자열이어야 합니다.");
  }

  try {
    // 결합된 데이터를 디코딩합니다.
    const combined = Buffer.from(encryptedSecret, "base64");

    // 최소 길이 검사: IV + 인증 태그 + 최소 1바이트 데이터
    if (combined.length < IV_LENGTH + TAG_LENGTH + 1) {
      throw new Error(
        "유효하지 않은 암호문 형식: 너무 짧거나 손상되었습니다.",
      );
    }

    // IV, 암호화된 데이터, 인증 태그를 추출합니다.
    const iv = combined.subarray(0, IV_LENGTH);
    const tag = combined.subarray(combined.length - TAG_LENGTH);
    const encrypted = combined.subarray(
      IV_LENGTH,
      combined.length - TAG_LENGTH,
    );

    // 암호화 키를 파생시킵니다.
    const key = deriveKey(encryptionKey);

    // 복호화 객체를 생성하고 인증 태그를 설정합니다.
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // 토큰을 복호화합니다.
    const decryptedBuffer = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decryptedBuffer.toString("utf8");
  } catch (error) {
    throw new Error(
      `비밀 정보 복호화 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    );
  }
}