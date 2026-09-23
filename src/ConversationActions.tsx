import { ActionMenu } from './ActionMenu'

export function ConversationActions({ title, archiveDisabled, onRename, onArchive, onMove, onLeader, isLeader, leaderDisabled }: {
  title: string
  archiveDisabled: boolean
  onRename: () => void
  onArchive: () => void
  onMove?: () => void
  onLeader?: () => void
  isLeader?: boolean
  leaderDisabled?: boolean
}) {
  return <ActionMenu label={`Actions for ${title}`} title="Conversation actions">{choose => <>
      <button type="button" onClick={() => choose(onRename)}>Rename</button>
      {onMove && <button type="button" onClick={() => choose(onMove)}>Move to folder</button>}
      {onLeader && <button type="button" disabled={leaderDisabled} onClick={() => choose(onLeader)}>{isLeader ? '☆ Bỏ vai trò leader' : '★ Đặt làm leader'}</button>}
      <button type="button" disabled={archiveDisabled} onClick={() => choose(onArchive)}>Archive</button>
  </>}</ActionMenu>
}
