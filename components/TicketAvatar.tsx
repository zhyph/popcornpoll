import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import type { ParticipantView } from '../server/ws/protocol'

// `lobbyStatus`: the Lobby screen's participant strip is a vertical
// 132px-wide card (badge, name, HOST/READY/AWAY tag) per the design's own
// `frameStyle`/`badgeStyle`/`statusStyle`, not the deck screen's compact
// horizontal away/done chip. The design's badge/tag styling only branches
// on away-vs-not — HOST and READY share the same gold badge / brass-bordered
// tag, differing only in the label text, so don't invent a distinct color
// for HOST here even though it reads as the "important" one.
export function TicketAvatar({
  participant,
  lobbyStatus = false,
  onRemove,
}: {
  participant: ParticipantView
  lobbyStatus?: boolean
  onRemove?: () => void
}) {
  const t = useTranslations('ticketAvatar')
  const initials = participant.displayName.slice(0, 2).toUpperCase()

  if (lobbyStatus) {
    const isAway = participant.connectionStatus === 'disconnected'
    const status = participant.isHost ? t('host') : isAway ? t('away') : t('ready')
    return (
      <div
        className="relative flex w-[132px] flex-none flex-col items-center gap-2 border border-brass/35 bg-[#1D1613] p-3.5"
        style={{ animation: 'revealUp .6s ease-out both' }}
      >
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('remove')}
            className="absolute right-1.5 top-1.5 leading-none text-exit-red/60 hover:text-exit-red"
          >
            ×
          </button>
        )}
        <span
          className={
            isAway
              ? 'flex h-11 w-11 items-center justify-center rounded-full bg-exit-red/20 font-display text-base tracking-wide text-exit-red'
              : 'flex h-11 w-11 items-center justify-center rounded-full bg-marquee font-display text-base tracking-wide text-ink'
          }
        >
          {initials}
        </span>
        <span className="font-mono text-xs tracking-wide text-ticket">{participant.displayName}</span>
        <span
          className={
            isAway
              ? 'border border-exit-red/70 px-1.5 py-1 font-mono text-[8.5px] uppercase tracking-[.2em] text-exit-red'
              : 'border border-brass/50 px-1.5 py-1 font-mono text-[8.5px] uppercase tracking-[.2em] text-brass'
          }
        >
          {status}
        </span>
      </div>
    )
  }

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
