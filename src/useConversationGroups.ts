import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { GroupSnapshot } from './conversationGroups'

export function useConversationGroups(enabled: boolean, csrf?: string) {
  const [snapshot, setSnapshot] = useState<GroupSnapshot | null>(null)
  const [error, setError] = useState('')
  const [leaderSaving, setLeaderSaving] = useState(false)
  const [leaderError, setLeaderError] = useState('')
  const leaderLock = useRef(false)
  const access = useRef({ enabled, csrf })
  access.current = { enabled, csrf }
  const generation = useRef(0)
  const apply = useCallback((next: GroupSnapshot) => {
    setSnapshot(current => current && current.revision > next.revision ? current : next)
    setError('')
    setLeaderError('')
  }, [])
  const refresh = useCallback(async () => {
    if (!access.current.enabled) return
    const epoch = generation.current
    try {
      const next = await api.conversationGroups()
      if (epoch === generation.current && access.current.enabled) apply(next)
    } catch (reason) {
      if (epoch === generation.current) setError(reason instanceof Error ? reason.message : 'Could not load folders')
    }
  }, [apply])
  useEffect(() => {
    generation.current++
    if (!enabled) return
    void refresh()
    const interval = setInterval(() => void refresh(), 15_000)
    return () => { generation.current++; clearInterval(interval) }
  }, [enabled, csrf, refresh])
  const mutate = useCallback(async (operation: (token: string) => Promise<GroupSnapshot>) => {
    const token = access.current.csrf
    if (!token || !access.current.enabled) throw new Error('Reconnect to change conversation folders')
    const epoch = generation.current
    const next = await operation(token)
    if (epoch === generation.current && token === access.current.csrf) apply(next)
  }, [apply])
  const clear = useCallback(() => {
    generation.current++
    setSnapshot(null)
    setError('')
  }, [])
  return {
    snapshot, error, refresh, clear, leaderSaving, leaderError,
    leader: async (groupId: string, threadId: string | null) => {
      if (leaderLock.current) return
      leaderLock.current = true; setLeaderSaving(true); setLeaderError('')
      try { await mutate(token => api.setLeader(groupId, threadId, token)) }
      catch (reason) { setLeaderError(reason instanceof Error ? reason.message : 'Could not change leader') }
      finally { leaderLock.current = false; setLeaderSaving(false) }
    },
    create: (name: string) => mutate(token => api.createConversationGroup(name, token)),
    rename: (id: string, name: string) => mutate(token => api.renameConversationGroup(id, name, token)),
    remove: (id: string) => mutate(token => api.deleteConversationGroup(id, token)),
    move: (threadId: string, groupId: string | null) => mutate(token => api.moveConversation(threadId, groupId, token)),
  }
}
