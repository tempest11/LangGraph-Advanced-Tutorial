import { HTTPException } from "@langchain/langgraph-sdk/auth";
import { Webhooks } from "@octokit/webhooks";
import { createLogger, LogLevel } from "../utils/logger.js";
import { LANGGRAPH_USER_PERMISSIONS } from "../constants.js";

const logger = createLogger(LogLevel.INFO, "GitHubWebhookAuth");

/**
 * GitHub 웹훅 요청의 유효성을 검사합니다.
 * 유효하지 않은 경우 오류를 발생시킵니다.
 * @param request - 들어오는 요청 객체.
 * @returns 유효한 경우, GitHub 봇의 인증 정보를 반환합니다.
 * @throws {Error} GITHUB_WEBHOOK_SECRET 환경 변수가 없을 경우.
 * @throws {HTTPException} 웹훅 헤더가 없거나 서명이 유효하지 않은 경우.
 */
export async function verifyGitHubWebhookOrThrow(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("GITHUB_WEBHOOK_SECRET 환경 변수가 필요합니다.");
  }
  const webhooks = new Webhooks({
    secret,
  });

  const requestClone = request.clone();

  const githubDeliveryHeader = requestClone.headers.get("x-github-delivery");
  const githubEventHeader = requestClone.headers.get("x-github-event");
  const githubSignatureHeader = requestClone.headers.get("x-hub-signature-256");
  if (!githubDeliveryHeader || !githubEventHeader || !githubSignatureHeader) {
    throw new HTTPException(401, {
      message: "GitHub 웹훅 헤더가 없습니다.",
    });
  }

  const payload = await requestClone.text();
  const signature = await webhooks.sign(payload);
  const isValid = await webhooks.verify(payload, signature);
  if (!isValid) {
    logger.error("GitHub 웹훅 확인에 실패했습니다.");
    throw new HTTPException(401, {
      message: "잘못된 GitHub 웹훅 서명입니다.",
    });
  }

  return {
    identity: "x-internal-github-bot",
    is_authenticated: true,
    display_name: "GitHub 봇",
    metadata: {
      installation_name: "n/a",
    },
    permissions: LANGGRAPH_USER_PERMISSIONS,
  };
}
