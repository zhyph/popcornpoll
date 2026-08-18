// components/chrome/PictureBoothFooter.tsx
export function PictureBoothFooter() {
  return (
    <footer className="relative z-10 flex flex-wrap items-center justify-center gap-3.5 border-t border-brass/25 px-5 py-5 font-mono text-[9.5px] uppercase tracking-widest text-brass/75">
      <span>Self-hosted · your library, your rules</span>
      <span className="opacity-50">·</span>
      <span>This product uses the TMDB API but is not endorsed or certified by TMDB</span>
    </footer>
  )
}
