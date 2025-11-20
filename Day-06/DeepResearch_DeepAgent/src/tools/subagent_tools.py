"""Tools for spawning and managing sub-agents."""

from typing import List, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from skills.registry import registry
from subagents.dynamic import create_dynamic_subagent


class SpawnSubAgentInput(BaseModel):
    """Input for SpawnSubAgent tool."""

    name: str = Field(
        description="Name of the sub-agent to spawn (e.g., 'python_analyst', 'web_researcher')"
    )
    goal: str = Field(description="Specific goal for the sub-agent to achieve.")
    skills: List[str] = Field(
        description="List of skills required for this sub-agent (e.g., ['web_research', 'data_analysis'])"
    )


class SpawnSubAgent(BaseTool):
    """Tool to spawn a dynamic sub-agent to handle a complex sub-task."""

    name: str = "spawn_subagent"
    description: str = (
        "Spawns a specialized sub-agent to handle a specific goal. "
        "Use this when you need to delegate a complex task that requires specific skills "
        "or when you want to isolate a part of the research. "
        "The sub-agent will work autonomously and return a summary of its results."
    )
    args_schema: Type[BaseModel] = SpawnSubAgentInput

    def _run(self, name: str, goal: str, skills: List[str]) -> str:
        """Execute the sub-agent spawning process."""

        # 1. Gather tools based on requested skills
        tools = []
        for skill in skills:
            skill_tools = registry.get_tools_for_skill(skill)
            if not skill_tools:
                # Warn but continue? Or fail?
                # For now, let's include a note in the tool output if a skill has no tools
                pass
            tools.extend(skill_tools)

        if not tools:
            return f"Error: No tools found for the requested skills: {skills}. Available skills: {registry.get_all_skills()}"

        # 2. Create the dynamic sub-agent
        try:
            subagent = create_dynamic_subagent(name=name, goal=goal, tools=tools)
        except Exception as e:
            return f"Error creating sub-agent '{name}': {str(e)}"

        # 3. Run the sub-agent
        # We need to construct the initial state for the sub-agent
        # Since it's a DeepAgent, it expects a list of messages
        initial_state = {"messages": [{"role": "user", "content": goal}]}

        try:
            # Run the sub-agent synchronously (or async if we were in an async context, but _run is sync)
            # Note: BaseTool._run is sync. If we need async, we should implement _arun.
            # However, for this environment, we might be running in an async loop already.
            # Let's implement _arun as well.

            from loguru import logger

            logger.info(f"Spawning sub-agent '{name}' with goal: {goal}")

            # For sync execution (if called synchronously)
            result = subagent.invoke(initial_state)

            # Extract the final response
            # The result structure depends on the DeepAgent state
            messages = result.get("messages", [])
            if messages:
                last_message = messages[-1]
                content = last_message.content
                logger.info(f"Sub-agent '{name}' finished successfully.")
                return f"Sub-agent '{name}' finished.\n\nResult:\n{content}"
            else:
                logger.warning(f"Sub-agent '{name}' finished but returned no messages.")
                return f"Sub-agent '{name}' finished but returned no messages."

        except Exception as e:
            logger.error(f"Error running sub-agent '{name}': {str(e)}")
            return f"Error running sub-agent '{name}': {str(e)}"

    async def _arun(self, name: str, goal: str, skills: List[str]) -> str:
        """Async execution of the sub-agent spawning process."""

        # 1. Gather tools
        tools = []
        for skill in skills:
            skill_tools = registry.get_tools_for_skill(skill)
            tools.extend(skill_tools)

        if not tools:
            return f"Error: No tools found for the requested skills: {skills}. Available skills: {registry.get_all_skills()}"

        # 2. Create sub-agent
        try:
            subagent = create_dynamic_subagent(name=name, goal=goal, tools=tools)
        except Exception as e:
            return f"Error creating sub-agent '{name}': {str(e)}"

        # 3. Run sub-agent
        initial_state = {"messages": [{"role": "user", "content": goal}]}

        try:
            from loguru import logger

            logger.info(f"Spawning sub-agent '{name}' (async) with goal: {goal}")

            result = await subagent.ainvoke(initial_state)

            messages = result.get("messages", [])
            if messages:
                last_message = messages[-1]
                content = last_message.content
                logger.info(f"Sub-agent '{name}' (async) finished successfully.")
                return f"Sub-agent '{name}' finished.\n\nResult:\n{content}"
            else:
                logger.warning(
                    f"Sub-agent '{name}' (async) finished but returned no messages."
                )
                return f"Sub-agent '{name}' finished but returned no messages."

        except Exception as e:
            logger.error(f"Error running sub-agent '{name}' (async): {str(e)}")
            return f"Error running sub-agent '{name}': {str(e)}"
