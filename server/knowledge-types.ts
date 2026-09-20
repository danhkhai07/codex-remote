export type KnowledgeMeta = {
  type: string; status: string; scope: string; updated: string
  sources: string[]; related: string[]; aliases: string[]; repositories: string[]
  decisionKey: string; supersedes: string[]
}
export type KnowledgeNote = KnowledgeMeta & { path: string; title: string; revision: string; bytes: number; modifiedAt: string; issues: string[] }
export type NoteDocument = KnowledgeNote & { content: string }
export type NoteVersion = { id: string; revision: string; at: string; origin: 'baseline' | 'external' | 'edit' | 'restore'; actor: string; bytes: number; deleted?: boolean }
export type ContextSnippet = { path: string; title: string; revision: string; status: string; scope: string; reason: string[]; bytes: number; excerpt: string; omitted: boolean }
export type ContextTrace = {
  id: string; threadId: string; at: string; task: string; cwd: string; group: string
  budgetBytes: number; usedBytes: number; snippets: ContextSnippet[]; omitted: Array<{ path: string; reason: string }>
}
export type KnowledgeSnapshot = { notes: KnowledgeNote[]; issues: Array<{ path: string; message: string }>; observedAt: string }
