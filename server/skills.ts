export type SkillSelection = { name: string; path: string }
export type SkillOption = SkillSelection & { description: string; scope: string; enabled: boolean }
export type SkillList = { skills: SkillOption[]; errors: string[] }

export function normalizeSkills(value: unknown, cwd: string): SkillList {
  const rows = (value as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) throw new Error('Invalid skills response from Codex')
  const result: SkillList = { skills: [], errors: [] }
  const seen = new Set<string>()
  for (const row of rows) {
    if (row?.cwd !== cwd) continue
    for (const skill of Array.isArray(row.skills) ? row.skills : []) {
      if (typeof skill?.name !== 'string' || typeof skill.path !== 'string' || seen.has(skill.path)) continue
      seen.add(skill.path)
      result.skills.push({ name: skill.name, path: skill.path,
        description: skill.interface?.shortDescription || skill.shortDescription || skill.description || '',
        scope: typeof skill.scope === 'string' ? skill.scope : '', enabled: skill.enabled === true })
    }
    for (const error of Array.isArray(row.errors) ? row.errors : []) {
      if (typeof error?.message === 'string') result.errors.push(error.message)
    }
  }
  return result
}

export function validateSkills(value: unknown, available: SkillOption[]): SkillSelection[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid skill selection')
  const selected = new Map<string, SkillSelection>()
  for (const skill of value) {
    if (!skill || typeof skill.name !== 'string' || typeof skill.path !== 'string') throw new Error('Invalid skill selection')
    const match = available.find(entry => entry.name === skill.name && entry.path === skill.path && entry.enabled)
    if (!match) throw new Error(`Skill is unavailable or disabled: ${skill.name}`)
    selected.set(match.path, { name: match.name, path: match.path })
  }
  return [...selected.values()]
}
