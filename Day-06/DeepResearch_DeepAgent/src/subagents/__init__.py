"""딥 리서치 에이전트를 위한 서브에이전트 설정입니다."""

from subagents.compressor import create_compressor_subagent
from subagents.critic import create_critic_subagent
from subagents.researcher import create_researcher_subagent

__all__ = [
    "create_researcher_subagent",
    "create_compressor_subagent",
    "create_critic_subagent",
]
