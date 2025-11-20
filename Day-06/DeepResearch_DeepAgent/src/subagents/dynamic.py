"""Dynamic Sub-Agent Factory.

This module provides functionality to create sub-agents dynamically at runtime.
These sub-agents are configured with specific tools and goals.
"""

from deepagents import create_deep_agent
from deepagents.backends import StateBackend


def create_dynamic_subagent(
    name: str,
    goal: str,
    tools: List[Any],
    model: str = "openai:gpt-4.1",
) -> Any:
    """Create a dynamic sub-agent with specific tools and goal.

    Args:
        name: Name of the sub-agent
        goal: The specific goal this sub-agent should achieve
        tools: List of tools available to this sub-agent
        model: LLM model to use

    Returns:
        CompiledStateGraph: The executable sub-agent
    """

    # Create a specialized system prompt for the sub-agent
    system_prompt = f"""You are a specialized sub-agent named '{name}'.
Your specific goal is: {goal}

You have access to the following tools:
{", ".join([t.name for t in tools])}

IMPORTANT:
1. You are part of a larger Deep Research system.
2. You MUST use the file system to store your detailed findings.
3. Do not return massive amounts of text in your final response. Instead, write detailed reports to files in your workspace directory and return a summary and the file path.
4. Your workspace directory is: workspace/{name}/
5. Use the 'write_file' tool (if available) or similar to save your work.

Work autonomously to achieve your goal. When finished, provide a concise summary of what you did and where the results are stored.
"""

    # Create the agent using the deepagents framework
    # We use a simpler configuration for sub-agents than the main orchestrator
    agent = create_deep_agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        backend=lambda rt: StateBackend(rt),
        name=name,
        debug=True,
    )

    return agent
