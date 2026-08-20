/**
 * The frame budget shared by the ambient WebGL layers behind every screen
 * (Aurora and LightRays, both mounted by components/chrome/AtmosphereLayer).
 *
 * Left alone, each runs its own requestAnimationFrame loop at whatever the
 * display refreshes at, redrawing a full-viewport fragment shader every tick.
 * On a 144Hz panel that measured as 719 renders per layer per 5 seconds —
 * 232ms of main-thread JS across the two, on an idle page, before any of the
 * GPU fill cost that a phone pays and a desktop hides.
 *
 * Neither layer conveys information or responds to input: Aurora drifts at
 * speed 0.3 and LightRays sways at 0.6. At those speeds the difference
 * between 30 and 144 renders a second is not visible, while the work is 4-5x.
 * So both loops stay on rAF — which keeps them correctly paused for hidden
 * tabs and synced to the compositor — and simply skip the ticks that arrive
 * sooner than this interval.
 *
 * This is the one knob for both, so they cannot drift apart.
 */
export const AMBIENT_TARGET_FPS = 30

export const AMBIENT_FRAME_INTERVAL_MS = 1000 / AMBIENT_TARGET_FPS

/**
 * Returns a gate that answers "should this ambient frame be drawn?".
 *
 * Call it once per rAF tick with the timestamp rAF supplies. It returns true
 * at most every AMBIENT_FRAME_INTERVAL_MS, and the caller must keep
 * requesting frames either way — skipping a draw is not the same as stopping
 * the loop, which is what unmounting the layer is for.
 */
export function createAmbientFrameGate(): (timestampMs: number) => boolean {
  let lastDrawnAt = Number.NEGATIVE_INFINITY
  return (timestampMs: number) => {
    if (timestampMs - lastDrawnAt < AMBIENT_FRAME_INTERVAL_MS) return false
    lastDrawnAt = timestampMs
    return true
  }
}
