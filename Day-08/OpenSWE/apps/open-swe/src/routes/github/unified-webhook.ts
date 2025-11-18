import { Context } from "hono";
import { BlankEnv, BlankInput } from "hono/types";
import { createLogger, LogLevel } from "../../utils/logger.js";
import { Webhooks } from "@octokit/webhooks";
import { handleIssueLabeled } from "./issue-labeled.js";
import { handlePullRequestComment } from "./pull-request-comment.js";
import { handlePullRequestReview } from "./pull-request-review.js";
import { handlePullRequestReviewComment } from "./pull-request-review-comment.js";

const logger = createLogger(LogLevel.INFO, "GitHubUnifiedWebhook");

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

const webhooks = new Webhooks({
  secret: GITHUB_WEBHOOK_SECRET,
});

/**
 * 요청 본문에서 페이로드를 추출합니다.
 * @param body - 요청 본문 문자열.
 * @returns 파싱된 페이로드 객체 또는 null.
 */
const getPayload = (body: string): Record<string, any> | null => {
  try {
    const payload = JSON.parse(body);
    return payload;
  } catch {
    return null;
  }
};

/**
 * 요청 헤더에서 웹훅 관련 정보를 추출합니다.
 * @param c - Hono 컨텍스트.
 * @returns 웹훅 관련 헤더 정보 객체 또는 null.
 */
const getHeaders = (
  c: Context,
): {
  id: string;
  name: string;
  installationId: string;
  targetType: string;
} | null => {
  const headers = c.req.header();
  const webhookId = headers["x-github-delivery"] || "";
  const webhookEvent = headers["x-github-event"] || "";
  const installationId = headers["x-github-hook-installation-target-id"] || "";
  const targetType = headers["x-github-hook-installation-target-type"] || "";
  if (!webhookId || !webhookEvent || !installationId || !targetType) {
    return null;
  }
  return { id: webhookId, name: webhookEvent, installationId, targetType };
};

// 이슈 라벨링 이벤트 핸들러 등록
webhooks.on("issues.labeled", async ({ payload }) => {
  await handleIssueLabeled(payload);
});

// PR 일반 댓글 이벤트 핸들러 등록 (토론 영역)
webhooks.on("issue_comment.created", async ({ payload }) => {
  await handlePullRequestComment(payload);
});

// PR 리뷰 이벤트 핸들러 등록 (승인/변경 요청/댓글)
webhooks.on("pull_request_review.submitted", async ({ payload }) => {
  await handlePullRequestReview(payload);
});

// PR 리뷰 댓글 이벤트 핸들러 등록 (인라인 코드 댓글)
webhooks.on("pull_request_review_comment.created", async ({ payload }) => {
  await handlePullRequestReviewComment(payload);
});

/**
 * 통합 GitHub 웹훅 핸들러입니다.
 * 들어오는 웹훅 요청을 검증하고, 이벤트를 파싱하여 적절한 핸들러로 전달합니다.
 * @param c - Hono 컨텍스트.
 * @returns 응답 객체.
 */
export async function unifiedWebhookHandler(
  c: Context<BlankEnv, "/webhooks/github", BlankInput>,
) {
  const payload = getPayload(await c.req.text());
  if (!payload) {
    logger.error("페이로드가 없습니다.");
    return c.json({ error: "페이로드가 없습니다." }, { status: 400 });
  }

  const eventHeaders = getHeaders(c);
  if (!eventHeaders) {
    logger.error("웹훅 헤더가 없습니다.");
    return c.json({ error: "웹훅 헤더가 없습니다." }, { status: 400 });
  }

  try {
    await webhooks.receive({
      id: eventHeaders.id,
      name: eventHeaders.name as any,
      payload,
    });

    return c.json({ received: true });
  } catch (error) {
    logger.error("웹훅 오류:", error);
    return c.json({ error: "웹훅 처리 실패" }, { status: 400 });
  }
}
