import { describe, expect, it } from 'vitest'
import { trackerStepFor } from './SetupStepTracker'

describe('trackerStepFor', () => {
  it('maps token to the token tracker row', () => {
    expect(trackerStepFor('token')).toBe('token')
  })

  it('maps both pin and polling to the link tracker row', () => {
    expect(trackerStepFor('pin')).toBe('link')
    expect(trackerStepFor('polling')).toBe('link')
  })

  it('maps both servers and sections to the library tracker row', () => {
    expect(trackerStepFor('servers')).toBe('library')
    expect(trackerStepFor('sections')).toBe('library')
  })

  it('maps done to the sync tracker row', () => {
    expect(trackerStepFor('done')).toBe('sync')
  })
})
