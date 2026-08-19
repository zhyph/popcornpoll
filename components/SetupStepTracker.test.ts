import { describe, expect, it } from 'vitest'
import { stateFor, trackerStepFor } from './SetupStepTracker'

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

  it('maps the already-linked probe and its landing state to the sync tracker row too', () => {
    expect(trackerStepFor('checking')).toBe('sync')
    expect(trackerStepFor('linked')).toBe('sync')
  })
})

describe('stateFor', () => {
  it('reproduces the mockup static example exactly: token done, link now, library/sync next', () => {
    expect(stateFor('token', 'link', 'pin')).toBe('done')
    expect(stateFor('link', 'link', 'pin')).toBe('now')
    expect(stateFor('library', 'link', 'pin')).toBe('next')
    expect(stateFor('sync', 'link', 'pin')).toBe('next')
  })

  it('marks every row done during the on-mount checking probe too, not just once linked/done', () => {
    expect(stateFor('token', 'sync', 'checking')).toBe('done')
    expect(stateFor('link', 'sync', 'checking')).toBe('done')
    expect(stateFor('library', 'sync', 'checking')).toBe('done')
    expect(stateFor('sync', 'sync', 'checking')).toBe('done')
  })

  it('marks every row done once the owner is already linked, even though the tracker key is sync', () => {
    expect(stateFor('token', 'sync', 'linked')).toBe('done')
    expect(stateFor('link', 'sync', 'linked')).toBe('done')
    expect(stateFor('library', 'sync', 'linked')).toBe('done')
    expect(stateFor('sync', 'sync', 'linked')).toBe('done')
  })

  it('marks every row done once setup finishes, not just the sync row', () => {
    expect(stateFor('token', 'sync', 'done')).toBe('done')
    expect(stateFor('library', 'sync', 'done')).toBe('done')
    expect(stateFor('sync', 'sync', 'done')).toBe('done')
  })

  it('marks the token row now and every other row next at the very start', () => {
    expect(stateFor('token', 'token', 'token')).toBe('now')
    expect(stateFor('link', 'token', 'token')).toBe('next')
    expect(stateFor('library', 'token', 'token')).toBe('next')
    expect(stateFor('sync', 'token', 'token')).toBe('next')
  })
})
