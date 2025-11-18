import { WebhookHandlerBase } from "./webhook-handler-base.js";
import {
  getOpenSWEAutoAcceptLabel,
  getOpenSWELabel,
  getOpenSWEMaxLabel,
  getOpenSWEMaxAutoAcceptLabel,
} from "../../utils/github/label.js";
import { RequestSource } from "../../constants.js";
import { GraphConfig } from "@openswe/shared/open-swe/types";

/**
 * 이슈 관련 웹훅을 처리하는 클래스입니다.
 */
class IssueWebhookHandler extends WebhookHandlerBase {
  constructor() {
    super("GitHubIssueHandler");
  }

  /**
   * 이슈에 라벨이 추가되었을 때의 이벤트를 처리합니다.
   * 유효한 OpenSWE 라벨이 추가되면, 새로운 실행을 생성하고 관련 댓글을 답니다.
   * @param payload - 웹훅 페이로드.
   */
  async handleIssueLabeled(payload: any) {
    if (!process.env.SECRETS_ENCRYPTION_KEY) {
      throw new Error(
        "SECRETS_ENCRYPTION_KEY 환경 변수가 필요합니다.",
      );
    }

    const validOpenSWELabels = [
      getOpenSWELabel(),
      getOpenSWEAutoAcceptLabel(),
      getOpenSWEMaxLabel(),
      getOpenSWEMaxAutoAcceptLabel(),
    ];

    if (
      !payload.label?.name ||
      !validOpenSWELabels.some((l) => l === payload.label?.name)
    ) {
      return;
    }

    const isAutoAcceptLabel =
      payload.label.name === getOpenSWEAutoAcceptLabel() ||
      payload.label.name === getOpenSWEMaxAutoAcceptLabel();

    const isMaxLabel =
      payload.label.name === getOpenSWEMaxLabel() ||
      payload.label.name === getOpenSWEMaxAutoAcceptLabel();

    this.logger.info(
      `'${payload.label.name}' 라벨이 이슈 #${payload.issue.number}에 추가되었습니다.`,
      {
        isAutoAcceptLabel,
        isMaxLabel,
      },
    );

    try {
      const context = await this.setupWebhookContext(payload);
      if (!context) {
        return;
      }

      const issueData = {
        issueNumber: payload.issue.number,
        issueTitle: payload.issue.title,
        issueBody: payload.issue.body || "",
      };

      const runInput = {
        messages: [
          this.createHumanMessage(
            `**${issueData.issueTitle}**\n\n${issueData.issueBody}`,
            RequestSource.GITHUB_ISSUE_WEBHOOK,
            {
              isOriginalIssue: true,
              githubIssueId: issueData.issueNumber,
            },
          ),
        ],
        githubIssueId: issueData.issueNumber,
        targetRepository: {
          owner: context.owner,
          repo: context.repo,
        },
        autoAcceptPlan: isAutoAcceptLabel,
      };

      // max 라벨을 위한 Claude Opus 4.1 모델 구성으로 config 객체 생성
      const configurable: Partial<GraphConfig["configurable"]> = isMaxLabel
        ? {
            plannerModelName: "anthropic:claude-opus-4-1",
            programmerModelName: "anthropic:claude-opus-4-1",
          }
        : {};

      const { runId, threadId } = await this.createRun(context, {
        runInput,
        configurable,
      });

      await this.createComment(
        context,
        {
          issueNumber: issueData.issueNumber,
          message:
            "🤖 이 이슈에 대해 Open SWE가 트리거되었습니다. 처리 중...",
        },
        runId,
        threadId,
      );
    } catch (error) {
      this.handleError(error, "이슈 웹훅");
    }
  }
}

const issueHandler = new IssueWebhookHandler();

/**
 * 이슈 라벨링 이벤트를 처리하는 외부 핸들러 함수입니다.
 * @param payload - 웹훅 페이로드.
 */
export async function handleIssueLabeled(payload: any) {
  return issueHandler.handleIssueLabeled(payload);
}
