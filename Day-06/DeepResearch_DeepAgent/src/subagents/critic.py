"""비평가 스킬 서브에이전트 설정입니다."""

from deepagents import SubAgent
from prompts.critic import CRITIC_SYSTEM_PROMPT


def create_critic_subagent(date: str) -> SubAgent:
    """DeepAgent를 위한 비평가 SubAgent 생성합니다.

    Args:
        date: 프롬프트 포맷팅을 위한 현재 날짜 문자열

    Returns:
        DeepAgent용 SubAgent
    """

    return SubAgent(
        **{
            "name": "critic",
            "description": (
                "연구 보고서를 검토하고 구조화된 실행 가능한 피드백을 제공하는 품질 보증 전문가입니다. "
                "최종화 전에 초안 보고서의 품질을 검증하고 싶을 때 이 에이전트를 사용하세요. "
                "비평가는 /research_brief.md와 /final_report.md를 읽고, "
                "완전성, 정확성, 구조, 인용, 깊이를 평가한 후 상세한 "
                "피드백을 /feedback.md에 작성합니다. "
                "최적 용도: 품질 검증, 격차 식별, 인용 품질 보장, "
                "최종 제출 전 구조적 문제 포착."
            ),
            "system_prompt": CRITIC_SYSTEM_PROMPT.format(date=date),
            "tools": [],
        }
    )
