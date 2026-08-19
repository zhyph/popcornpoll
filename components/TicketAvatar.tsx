// components/TicketAvatar.tsx
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import type { ParticipantView } from '../server/ws/protocol'

// `lobbyStatus`: the Lobby screen's participant strip shows a HOST/READY/AWAY
// tag per the design instead of the deck screen's away/done pair — HOST takes
// priority over connection status since the host being "away" still reads as
// HOST first. Omit the prop (or leave it false) for the deck's own usage,
// which keeps its existing away/done badges unchanged.
export function TicketAvatar({
  participant,
  lobbyStatus = false,
}: {
  participant: ParticipantView
  lobbyStatus?: boolean
}) {
  const t = useTranslations('ticketAvatar')
  const initials = participant.displayName.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2.5 border border-brass/40 bg-velvet/60 px-3 py-2">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-marquee font-mono text-xs text-ink">{initials}</AvatarFallback>
      </Avatar>
      <span className="font-mono text-sm text-ticket">{participant.displayName}</span>
      {lobbyStatus ? (
        participant.isHost ? (
          <Badge className="bg-marquee text-ink">{t('host')}</Badge>
        ) : participant.connectionStatus === 'disconnected' ? (
          <Badge variant="outline" className="border-exit-red text-exit-red">{t('away')}</Badge>
        ) : (
          <Badge variant="outline" className="border-admit-teal text-admit-teal">{t('ready')}</Badge>
        )
      ) : (
        <>
          {participant.connectionStatus === 'disconnected' && (
            <Badge variant="outline" className="border-exit-red text-exit-red">{t('away')}</Badge>
          )}
          {participant.finished && <Badge className="bg-marquee text-ink">{t('done')}</Badge>}
        </>
      )}
    </div>
  )
}
