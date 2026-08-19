// components/TicketAvatar.tsx
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import type { ParticipantView } from '../server/ws/protocol'

export function TicketAvatar({ participant }: { participant: ParticipantView }) {
  const t = useTranslations('ticketAvatar')
  const initials = participant.displayName.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2.5 border border-brass/40 bg-velvet/60 px-3 py-2">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-marquee font-mono text-xs text-ink">{initials}</AvatarFallback>
      </Avatar>
      <span className="font-mono text-sm text-ticket">{participant.displayName}</span>
      {participant.connectionStatus === 'disconnected' && (
        <Badge variant="outline" className="border-exit-red text-exit-red">{t('away')}</Badge>
      )}
      {participant.finished && <Badge className="bg-marquee text-ink">{t('done')}</Badge>}
    </div>
  )
}
