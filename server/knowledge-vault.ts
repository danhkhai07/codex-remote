/** User-maintained knowledge notes. Existing notes/settings are never replaced by these defaults. */
export const KNOWLEDGE_SECTIONS = {
  Profile: 'Facts, preferences, constraints, and ways the user wants to work.',
  Patterns: 'Reusable ways of working, recurring needs, and lessons with evidence and scope.',
  Projects: 'Goals, domain context, requirements, and current understanding of ongoing projects.',
  Ideas: 'Ideas and possible directions, including their motivation and open questions.',
  Decisions: 'Choices the user has made, their rationale, and what they supersede.',
  References: 'Useful concepts, domain information, and pointers to authoritative documents.',
  Inbox: 'Unclassified knowledge and observations that still need clarification or consolidation.',
} as const

export const KNOWLEDGE_CAPTURE = [
  'Use this Obsidian vault as the user’s living knowledge base: preserve useful facts, preferences, patterns, ideas, project understanding, and decisions across tasks.',
  'At task start, use the knowledge map to find and read relevant existing notes. Follow links as needed; conversation transcripts are source evidence, not the primary knowledge base.',
  'When the user asks you to remember something, or a substantive task establishes reusable knowledge, update the relevant note before the final response. Ordinary acknowledgements and temporary progress do not need new notes.',
  'Read before editing and merge small changes. Prefer one coherent note per subject, reuse an existing note, link related subjects, and preserve contributions from other conversations. If a concurrent edit occurs, reread and merge it.',
  'Use the knowledge CLI/API revision check when writing maintained notes. Keep a draft, read the current revision, and save against that revision. On a conflict, reread and merge; never replace the newer note blindly. Version history observes direct file edits periodically but cannot recover every intermediate unobserved write.',
  'Use English hyphenated filenames. Notes can be in the user’s language. Use Obsidian internal links and YAML properties: type, status, scope, updated, sources, and related. The Templates folder provides examples.',
  'Distinguish confirmed user statements and decisions from observed patterns and proposed ideas. Record scope (global, a group, or a project), date, rationale, and a link to the source conversation. Never turn an assistant suggestion or a one-off preference into a confirmed global fact.',
  'When corrected, update the current note and mark conflicting old knowledge superseded. If unsure, keep the observation in Inbox with an explicit open question. Do not infer personal traits, copy entire transcripts into topic notes, or store secrets.',
  'Keep Shared/Context.md a short orientation with essential preferences and links. Put detailed knowledge in Profile, Patterns, Projects, Ideas, Decisions, or References. Group Context.md links the relevant topic notes; conversation Context.md is only a short task handoff.',
  'Keep the newest active goal, current status, applicable decisions, next steps and source links at the top of the conversation handoff. Move completed delivery logs to an archived reference note; do not append an ever-growing work log to the injected handoff.',
  'The app regenerates Index.md, Sources.md, category Index.md files, group/conversation indexes, transcripts, and .state. Do not edit these generated files. Topic notes, 00_Home.md, and Context.md files are user/agent maintained.',
].join('\n\n')

export const KNOWLEDGE_SCAFFOLD: Record<string, string> = {
  '.obsidian/app.json': '{}\n',
  '.obsidian/appearance.json': '{}\n',
  'AGENTS.md': '# Shared Knowledge Vault\n\nRead 00_Home.md, Index.md, and Knowledge-Workflow.md. Preserve useful user information, patterns, ideas, project understanding, and decisions in topic notes. Read before editing, cite sources, preserve scope, distinguish confirmed facts from observations and proposals, and merge other conversations’ contributions. Update reusable knowledge before completing a substantive task when appropriate. Never store secrets or infer personal traits.\n\nThe app manages Index.md, Sources.md, category and conversation indexes, transcript exports, and .state. Topic notes, 00_Home.md, and Context.md are user/agent maintained. Follow parent AGENTS.md naming rules.\n',

  'Profile/Context.md': `---
type: profile
status: confirmed
scope: global
sources: []
related: []
tags: [knowledge/profile]
---

# Profile and Preferences

Keep a short summary of explicit, stable user preferences here, with source links. This note is read at the start of each turn. Record detailed or project-specific knowledge in separate topic notes.
`,
  '00_Home.md': `---
type: home
tags: [knowledge]
---

# Codex Knowledge

A living map of the user's information, ideas, decisions, and ways of working.

## Explore

- [[Profile/Index|Profile and preferences]]
- [[Patterns/Index|Patterns and lessons]]
- [[Projects/Index|Projects]]
- [[Ideas/Index|Ideas]]
- [[Decisions/Index|Decisions]]
- [[References/Index|References]]
- [[Inbox/Index|Inbox and open questions]]
- [[Index|All knowledge and conversation groups]]

## Working with this vault

Start with [[Shared/Context|Shared context]]. Read [[Knowledge-Workflow|Knowledge workflow]] when adding or updating notes. Use [[Templates/Knowledge-Note|the knowledge note template]], [[Templates/Pattern|pattern]], [[Templates/Idea|idea]], or [[Templates/Decision|decision]] as appropriate.

Conversation exports in [[Sources|Sources]] provide evidence and provenance. Topic notes capture the reusable understanding, with links back to their sources.
`,
  'Knowledge-Workflow.md': `---
type: guide
tags: [knowledge/workflow]
---

# Knowledge Workflow

${KNOWLEDGE_CAPTURE}

## Placement

${Object.entries(KNOWLEDGE_SECTIONS).map(([folder, description]) => `- [[${folder}/Index|${folder}]]: ${description}`).join('\n')}

## Status and provenance

- **confirmed**: an explicit user statement, constraint, or decision; cite its source.
- **observed**: a recurring pattern supported by examples; record limitations and scope.
- **proposed**: an idea or suggestion awaiting a decision.
- **superseded**: outdated knowledge; link to the current decision.

Use a source conversation or turn link and a brief paraphrase of the supporting statement. A task-specific request stays scoped to that project unless the user says it applies more broadly. A request to remember an idea preserves the idea as an idea.

Open this folder as a vault in Obsidian. Internal links create backlinks and graph connections. No community plugin is required. [[00_Home|Home]] · [[Sources|Source conversations]]
`,
  'Templates/Knowledge-Note.md': `---
type: reference
status: proposed
scope: global
updated: {{date}}
sources: []
related: []
tags: [knowledge/reference]
---

# Subject

## Knowledge

Concise facts or understanding, with scope and limitations.

## Evidence

Link to the source conversation or turn and describe what the user said. Replace template properties with real values; quote internal links in YAML lists.

## Related

Link related topic notes. Put uncertain claims and unresolved conflicts under Open questions.
`,
  'Templates/Pattern.md': `---
type: pattern
status: observed
scope: project
updated: {{date}}
sources: []
related: []
tags: [knowledge/pattern]
---

# Pattern

## When it applies

## Preferred approach

## Evidence and examples

## Exceptions and open questions
`,
  'Templates/Idea.md': `---
type: idea
status: proposed
scope: project
updated: {{date}}
sources: []
related: []
tags: [knowledge/idea]
---

# Idea

## Intent

## Possible approach

## Open questions

## Origin and related notes
`,
  'Templates/Decision.md': `---
type: decision
status: confirmed
scope: project
updated: {{date}}
sources: []
related: []
tags: [knowledge/decision]
---

# Decision

## Choice

## Reason and context

## Consequences

## Supersedes

## Evidence
`,
}
