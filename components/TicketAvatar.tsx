// components/TicketAvatar.tsx
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import type { ParticipantView } from '../server/ws/protocol'

export function TicketAvatar({ participant }: { participant: ParticipantView }) {
  const initials = participant.displayName.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2 rounded border border-brass/50 bg-velvet px-3 py-1.5">
      <Avatar className="h-6 w-6">
        <AvatarFallback className="bg-marquee text-xs text-ink">{initials}</AvatarFallback>
      </Avatar>
      <span className="font-mono text-sm text-ticket">{participant.displayName}</span>
      {participant.connectionStatus === 'disconnected' && (
        <Badge variant="outline" className="border-exit-red text-exit-red">away</Badge>
      )}
      {participant.finished && <Badge className="bg-marquee text-ink">done</Badge>}
    </div>
  )
}
