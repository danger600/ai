"""10-agent orchestrator with intent routing and central SecurityGatekeeper enforcement."""
from __future__ import annotations

from dataclasses import dataclass

from backend.core.security import SecurityGatekeeper


@dataclass(frozen=True)
class AgentProfile:
    id: str
    name: str
    role: str
    system_prompt: str
    keywords: tuple[str, ...]
    required_scopes: tuple[str, ...] = ()


AGENTS: list[AgentProfile] = [
    AgentProfile(
        id="main",
        name="Main Assistant Agent",
        role="Primary Orchestrator",
        system_prompt="You are REMY THE GRIVER PRO, personal AI assistant of Remy Nsanzimana. Be accurate and concise.",
        keywords=("hello", "help", "explain", "summarize"),
    ),
    AgentProfile(
        id="engineering",
        name="Software Engineering Agent",
        role="Code & Database Specialist",
        system_prompt="Provide clean Python, JavaScript, React, Node.js, SQL, debugging, and unit test solutions.",
        keywords=("python", "javascript", "react", "node", "sql", "bug", "debug", "refactor", "test", "code", "api"),
        required_scopes=("studio.sandbox_exec",),
    ),
    AgentProfile(
        id="research",
        name="Research Agent",
        role="Verified Web Synthesis",
        system_prompt="Separate verified source facts from analytical conclusions. Never fabricate URLs.",
        keywords=("research", "search", "web", "source", "citation", "news"),
        required_scopes=("research.web_search",),
    ),
    AgentProfile(
        id="documents",
        name="Document Analysis Agent",
        role="Local RAG Specialist",
        system_prompt="Answer strictly from indexed document excerpts and cite filename + page/row.",
        keywords=("document", "pdf", "docx", "xlsx", "csv", "file", "extract"),
    ),
    AgentProfile(
        id="career",
        name="Career & CV Agent",
        role="Private Career Strategist",
        system_prompt="Never fabricate jobs, internship duties, certificates, or awards. Only use verified CV facts.",
        keywords=("cv", "resume", "career", "job", "interview", "cover letter", "internship"),
        required_scopes=("cv.external_ai",),
    ),
    AgentProfile(
        id="productivity",
        name="Productivity Agent",
        role="Planning & Task Execution",
        system_prompt="Organize tasks, notes, reminders, and weekly reports clearly.",
        keywords=("task", "todo", "note", "reminder", "plan", "schedule"),
    ),
    AgentProfile(
        id="system",
        name="System Assistant Agent",
        role="Telemetry & Diagnostics",
        system_prompt="Diagnose CPU, RAM, disk, SQLite integrity, and AI provider availability.",
        keywords=("cpu", "ram", "disk", "battery", "system", "health", "ollama"),
    ),
    AgentProfile(
        id="education",
        name="Learning & Education Agent",
        role="Structured Tutor",
        system_prompt="Teach software engineering fundamentals, databases, and blockchain concepts step by step.",
        keywords=("learn", "study", "teach", "tutorial", "fundamentals", "blockchain"),
    ),
    AgentProfile(
        id="security",
        name="Security Review Agent",
        role="AppSec & Policy Auditor",
        system_prompt="Audit permissions, path traversal, input validation, and secret masking.",
        keywords=("security", "audit", "traversal", "vulnerability", "permission", "secret"),
    ),
    AgentProfile(
        id="planning",
        name="Project Planning Agent",
        role="Architecture & Milestones",
        system_prompt="Decompose initiatives into milestones, database schemas, and verification tests.",
        keywords=("architecture", "roadmap", "milestone", "phase", "schema"),
    ),
]


class AgentOrchestrator:
    def __init__(self, gatekeeper: SecurityGatekeeper) -> None:
        self.gatekeeper = gatekeeper

    def route(self, prompt: str, explicit_agent_id: str | None = None) -> tuple[AgentProfile, str]:
        if explicit_agent_id and explicit_agent_id != "auto":
            for agent in AGENTS:
                if agent.id == explicit_agent_id:
                    return agent, f"Explicitly selected: {agent.name}"

        lower = prompt.lower()
        best = AGENTS[0]
        best_score = 0
        matched_kw = ""
        for agent in AGENTS[1:]:
            score = sum(1 for kw in agent.keywords if kw in lower)
            if score > best_score:
                best_score = score
                best = agent
                matched_kw = next((kw for kw in agent.keywords if kw in lower), "")

        reason = f"Intent matched '{matched_kw}' -> {best.name}" if best_score > 0 else "Defaulted to Main Assistant Agent"
        return best, reason

    def verify_agent_permissions(self, agent: AgentProfile, action_target: str) -> None:
        """No agent may bypass the central SecurityGatekeeper."""
        for scope in agent.required_scopes:
            self.gatekeeper.require_permission(scope, actor=f"agent:{agent.id}", target=action_target)
