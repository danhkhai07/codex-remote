import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from './api'
import type { PendingRequest } from './types'

type Question = { id: string; question?: string; header?: string; isSecret?: boolean; options?: { label: string; description?: string }[] | null }
type Draft = { choice?: number | 'custom'; text?: string; skipped?: boolean }
type Answers = { answers: Record<string, { answers: string[] }> }

function answer(question: Question, draft: Draft = {}): string {
  return !question.options?.length || draft.choice === 'custom'
    ? (draft.text ?? '').trim() : typeof draft.choice === 'number' ? question.options[draft.choice]?.label ?? '' : ''
}

export function QuestionRequest({ request, csrf, onResolved }: {
  request: PendingRequest; csrf: string; onResolved: (key: string) => void
}) {
  const questions = (Array.isArray(request.params.questions) ? request.params.questions : []) as Question[]
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; body: Answers } | null>(null)
  const submitting = useRef(false)
  const composing = useRef(false)
  const panel = useRef<HTMLFieldSetElement>(null)
  const focusNext = useRef(false)
  const question = questions[index]
  const draft = drafts[question?.id] ?? {}
  const options = question?.options ?? []
  const title = question?.question ?? question?.header ?? 'Your answer'
  const titleId = `question-${request.key}-${index}`
  const last = index === questions.length - 1

  useLayoutEffect(() => {
    if (!focusNext.current) return
    focusNext.current = false
    const target = panel.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      ?? panel.current?.querySelector<HTMLElement>('[role="radio"], input')
    target?.focus()
  }, [index])

  function change(next: Partial<Draft>) {
    if (submitting.current) return
    setDrafts(current => ({ ...current, [question.id]: { ...current[question.id], ...next, skipped: false } }))
    setFailure(null)
  }

  function navigate(next: number) {
    if (submitting.current) return
    focusNext.current = Boolean(panel.current?.contains(document.activeElement))
    setFailure(null)
    setIndex(next)
  }

  async function send(body: Answers) {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setFailure(null)
    try {
      await api.respond(request.key, body, csrf)
      onResolved(request.key)
    } catch (error) {
      setFailure({ message: error instanceof Error ? error.message : 'Unable to send answers', body })
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function advance(skip = false) {
    if (!question) { if (skip) void send({ answers: {} }); return }
    if (submitting.current || (!skip && !answer(question, draft))) return
    const next = { ...drafts, [question.id]: { ...draft, skipped: skip } }
    setDrafts(next)
    if (!last) { navigate(index + 1); return }
    void send({ answers: Object.fromEntries(questions.flatMap(item => {
      const value = answer(item, next[item.id])
      return next[item.id]?.skipped || !value ? [] : [[item.id, { answers: [value] }]]
    })) })
  }

  function keyboard(event: KeyboardEvent, choice?: number | 'custom') {
    if (submitting.current || composing.current || event.nativeEvent.isComposing || event.keyCode === 229
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (choice !== undefined && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const position = choice === 'custom' ? options.length : choice
      const next = (position + (event.key === 'ArrowDown' ? 1 : -1) + options.length + 1) % (options.length + 1)
      change({ choice: next === options.length ? 'custom' : next })
      panel.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (choice !== undefined && draft.choice !== choice) change({ choice })
      else if (choice === 'custom') panel.current?.querySelector('input')?.focus()
      else advance()
    }
  }

  return <fieldset ref={panel} className="plan-question" disabled={busy} aria-labelledby={titleId} aria-busy={busy}
    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
    <div className="plan-question-body" key={index}>
      <div className="plan-question-heading">
        <span id={titleId}>{title}</span>
        <span className="plan-question-count" aria-label={`Question ${index + 1} of ${questions.length}`}>{index + 1}/{questions.length}</span>
      </div>
      {options.length > 0 && <div role="radiogroup" aria-labelledby={titleId} className="plan-question-options">
        {[...options, { label: 'Other answer…' }].map((option, optionIndex) => {
          const choice = optionIndex === options.length ? 'custom' : optionIndex
          const selected = draft.choice === choice
          return <div key={optionIndex}>
            <button type="button" role="radio" aria-checked={selected}
              aria-describedby={selected && option.description ? `${titleId}-option-${optionIndex}` : undefined}
              tabIndex={selected || (draft.choice === undefined && optionIndex === 0) ? 0 : -1}
              className="plan-question-choice" onClick={() => change({ choice })} onKeyDown={event => keyboard(event, choice)}>
              <span className="plan-question-number" aria-hidden="true">{optionIndex + 1}.</span><span>{option.label}</span>
            </button>
            {selected && option.description && <p id={`${titleId}-option-${optionIndex}`} className="plan-question-description">{option.description}</p>}
          </div>
        })}
      </div>}
      {(!options.length || draft.choice === 'custom') && <input aria-label={options.length ? `Other answer: ${title}` : title}
        type={question?.isSecret ? 'password' : 'text'} value={draft.text ?? ''} placeholder="Your answer…"
        onChange={event => change({ text: event.target.value })} onKeyDown={event => keyboard(event)} />}
    </div>
    {failure && <div className="plan-question-error" role="alert">{failure.message}
      <button type="button" className="quiet-button" onClick={() => void send(failure.body)}>Retry</button>
    </div>}
    <div className="plan-question-actions">
      {index > 0 && <button type="button" className="quiet-button" onClick={() => navigate(index - 1)}>Back</button>}
      <button type="button" className="quiet-button" onClick={() => advance(true)}>Skip</button>
      <button type="button" className="primary-button" disabled={!question || !answer(question, draft)} onClick={() => advance()}>
        {busy ? 'Sending…' : last ? 'Send' : 'Next'}
      </button>
    </div>
  </fieldset>
}
