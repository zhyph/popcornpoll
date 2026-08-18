import { describe, expect, it } from 'vitest'
import { slatGroups } from './CodeSlats'

describe('slatGroups', () => {
  it('splits a WORD-WORD-### code into per-hyphen groups of individual letters', () => {
    expect(slatGroups('BLUE-WOLF-042')).toEqual([
      [
        { letter: 'B', delay: '0.00' },
        { letter: 'L', delay: '0.09' },
        { letter: 'U', delay: '0.18' },
        { letter: 'E', delay: '0.27' },
      ],
      [
        { letter: 'W', delay: '0.36' },
        { letter: 'O', delay: '0.45' },
        { letter: 'L', delay: '0.54' },
        { letter: 'F', delay: '0.63' },
      ],
      [
        { letter: '0', delay: '0.72' },
        { letter: '4', delay: '0.81' },
        { letter: '2', delay: '0.90' },
      ],
    ])
  })

  it('staggers the delay across the whole code, not reset per group', () => {
    const groups = slatGroups('AB-CD')
    expect(groups[1][0].delay).toBe('0.18')
  })
})
