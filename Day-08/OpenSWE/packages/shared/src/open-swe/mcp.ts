/**
 * @file mcp.ts
 * @description 이 파일은 MCP(Model Context Protocol) 서버 설정을 위한 Zod 스키마를 정의합니다.
 * Stdio 및 Streamable HTTP와 같은 다양한 전송 프로토콜에 대한 연결 설정을 검증하고
 * 타입을 지정하는 데 사용됩니다.
 */

import { z } from "zod";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

// OAuthClientProvider에 대한 Zod 커스텀 스키마입니다.
// 객체가 유효한 OAuth 클라이언트 제공자 인터페이스를 구현하는지 확인합니다.
export const oAuthClientProviderSchema = z.custom<OAuthClientProvider>(
  (val) => {
    if (!val || typeof val !== "object") return false;

    // 필수 속성 및 메서드가 존재하는지 확인합니다.
    const requiredMethods = [
      "redirectUrl",
      "clientMetadata",
      "clientInformation",
      "tokens",
      "saveTokens",
    ];

    if (!("redirectUrl" in val)) return false;
    if (!("clientMetadata" in val)) return false;

    for (const method of requiredMethods) {
      if (!(method in val)) return false;
    }

    return true;
  },
  {
    message:
      "유효한 OAuthClientProvider 구현이어야 하며, 필수 속성(redirectUrl, clientMetadata, clientInformation, tokens, saveTokens)을 포함해야 합니다.",
  },
);

/**
 * Stdio 전송 재시작 설정 스키마입니다.
 */
export const stdioRestartSchema = z
  .object({
    /**
     * 프로세스가 종료될 경우 자동으로 재시작할지 여부입니다.
     */
    enabled: z
      .boolean()
      .describe("프로세스가 종료될 경우 자동으로 재시작할지 여부")
      .optional(),
    /**
     * 최대 재시작 시도 횟수입니다.
     */
    maxAttempts: z
      .number()
      .describe("최대 재시작 시도 횟수")
      .optional(),
    /**
     * 재시작 시도 간의 지연 시간(밀리초)입니다.
     */
    delayMs: z
      .number()
      .describe("재시작 시도 간의 지연 시간(밀리초)")
      .optional(),
  })
  .describe("Stdio 전송 재시작 설정");

/**
 * Stdio 전송 연결 설정 스키마입니다.
 */
export const stdioConnectionSchema = z
  .object({
    transport: z.literal("stdio").optional(),
    type: z.literal("stdio").optional(),
    /**
     * 서버를 실행할 실행 파일입니다 (예: `node`, `npx` 등).
     */
    command: z.string().describe("서버를 실행할 실행 파일"),
    /**
     * 실행 파일에 전달할 명령줄 인자 배열입니다.
     */
    args: z
      .array(z.string())
      .describe("실행 파일에 전달할 명령줄 인자"),
    /**
     * 프로세스 생성 시 설정할 환경 변수입니다.
     */
    env: z
      .record(z.string())
      .describe("프로세스 생성 시 사용할 환경")
      .optional(),
    encoding: z
      .string()
      .describe("프로세스에서 읽을 때 사용할 인코딩")
      .optional(),
    /**
     * 자식 프로세스의 stderr 처리 방법입니다. Node의 `child_process.spawn` 의미 체계와 일치합니다.
     * 기본값은 "inherit"이며, stderr 메시지가 부모 프로세스의 stderr로 출력됩니다.
     * @default "inherit"
     */
    stderr: z
      .union([
        z.literal("overlapped"),
        z.literal("pipe"),
        z.literal("ignore"),
        z.literal("inherit"),
      ])
      .optional()
      .default("inherit"),
    cwd: z
      .string()
      .describe("프로세스 생성 시 사용할 작업 디렉토리")
      .optional(),
    restart: stdioRestartSchema.optional(),
  })
  .describe("Stdio 전송 연결 설정");

/**
 * Streamable HTTP 재연결 설정 스키마입니다.
 */
export const streamableHttpReconnectSchema = z
  .object({
    enabled: z
      .boolean()
      .describe("연결이 끊겼을 때 자동으로 재연결할지 여부")
      .optional(),
    maxAttempts: z
      .number()
      .describe("최대 재연결 시도 횟수")
      .optional(),
    delayMs: z
      .number()
      .describe("재연결 시도 간의 지연 시간(밀리초)")
      .optional(),
  })
  .describe("Streamable HTTP 전송 재연결 설정");

/**
 * Streamable HTTP 전송 연결 설정 스키마입니다.
 */
export const streamableHttpConnectionSchema = z
  .object({
    transport: z.union([z.literal("http"), z.literal("sse")]).optional(),
    type: z.union([z.literal("http"), z.literal("sse")]).optional(),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    authProvider: oAuthClientProviderSchema.optional(),
    reconnect: streamableHttpReconnectSchema.optional(),
    /**
     * Streamable HTTP를 사용할 수 없거나 지원되지 않을 경우 자동으로 SSE로 대체할지 여부입니다.
     * @default true
     */
    automaticSSEFallback: z.boolean().optional().default(true),
  })
  .describe("Streamable HTTP 전송 연결 설정");

// MCP 서버 설정을 위한 통합 스키마입니다.
export const McpServerConfigSchema = z.union([
  stdioConnectionSchema,
  streamableHttpConnectionSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export type McpServers = {
  /**
   * 서버 이름을 설정 객체에 매핑합니다.
   */
  [serverName: string]: McpServerConfig;
};