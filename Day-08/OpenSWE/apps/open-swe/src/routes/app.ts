import { Hono } from "hono";
import { unifiedWebhookHandler } from "./github/unified-webhook.js";

/**
 * Hono 애플리케이션 인스턴스입니다.
 * 이 앱은 GitHub 웹훅을 처리하는 라우트를 등록합니다.
 */
export const app = new Hono();

/**
 * GitHub 웹훅을 처리하는 POST 라우트입니다.
 * `/webhooks/github` 경로로 들어오는 POST 요청을 `unifiedWebhookHandler`로 전달합니다.
 */
app.post("/webhooks/github", unifiedWebhookHandler);
