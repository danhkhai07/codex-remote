import { useEffect, useState } from 'react'
import { api } from './api'
import type { SkillList, SkillSelection } from '../server/skills'

export function SkillsPicker({ threadId, selected, onChange, onClose, disabled }: {
  threadId: string; selected: SkillSelection[]; onChange: (skills: SkillSelection[]) => void; onClose: () => void; disabled: boolean
}) {
  const [result, setResult] = useState<SkillList | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setResult(null); setError('')
    void api.skills(threadId, attempt > 0, controller.signal).then(setResult).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được skills')
    })
    return () => controller.abort()
  }, [threadId, attempt])
  const matches = result?.skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? []
  return <section className="skills-picker" aria-label="Available skills">
    <div className="skills-picker-heading"><strong>Skills</strong><button type="button" className="quiet-button" onClick={() => setAttempt(value => value + 1)}>Làm mới</button><button type="button" className="icon-button" onClick={onClose} aria-label="Close skills">×</button></div>
    <input type="search" aria-label="Search skills" placeholder="Tìm skill…" value={query} onChange={event => setQuery(event.target.value)} />
    <p>Chọn skill cho tin nhắn tiếp theo. Viết yêu cầu rồi nhấn gửi.</p>
    {!result && !error && <p role="status">Đang tải skills…</p>}
    {error && <p role="alert">{error}</p>}
    {result?.errors.map((message, index) => <p role="alert" key={index}>{message}</p>)}
    {result && !matches.length && <p>Không tìm thấy skill.</p>}
    <div className="skills-picker-list">{matches.map(skill => {
      const chosen = selected.some(item => item.path === skill.path)
      return <button key={skill.path} type="button" className="skill-option" aria-pressed={chosen}
        disabled={disabled || !skill.enabled || (!chosen && selected.length >= 20)}
        onClick={() => onChange(chosen ? selected.filter(item => item.path !== skill.path) : [...selected, { name: skill.name, path: skill.path }])}>
        <strong>{chosen ? '✓ ' : ''}{skill.name}</strong><small>{skill.description}</small><span>{skill.scope}{!skill.enabled ? ' · Đang tắt' : ''}</span>
      </button>
    })}</div>
  </section>
}
