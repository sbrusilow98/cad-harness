import { describe, it, expect } from 'vitest'
import { sanitizeToolName, buildExposedName, uniqueName, ToolNameRegistry } from './naming'

describe('sanitizeToolName', () => {
  it('replaces invalid characters with underscores and trims them', () => {
    expect(sanitizeToolName('My Server (local)')).toBe('My_Server_local')
    expect(sanitizeToolName('  ok-name_1 ')).toBe('ok-name_1')
  })
  it('falls back to "tool" when nothing is left', () => {
    expect(sanitizeToolName('***')).toBe('tool')
  })
})

describe('buildExposedName', () => {
  it('joins prefix and tool with a double underscore', () => {
    expect(buildExposedName('freecad', 'create_object')).toBe('freecad__create_object')
  })
  it('trims the prefix to fit the length limit but keeps the tool name', () => {
    const name = buildExposedName('a'.repeat(80), 'execute_code')
    expect(name.length).toBe(64)
    expect(name.endsWith('__execute_code')).toBe(true)
  })
  it('truncates the tool name when even that is too long', () => {
    const name = buildExposedName('p', 'x'.repeat(100))
    expect(name.length).toBe(64)
  })
})

describe('uniqueName', () => {
  it('returns the base when free', () => {
    expect(uniqueName('handoff', () => false)).toBe('handoff')
  })
  it('appends numeric suffixes on collision', () => {
    const taken = new Set(['a', 'a_2'])
    expect(uniqueName('a', (n) => taken.has(n))).toBe('a_3')
  })
  it('keeps suffixed names within the limit', () => {
    const base = 'b'.repeat(64)
    const name = uniqueName(base, (n) => n === base)
    expect(name.length).toBe(64)
    expect(name.endsWith('_2')).toBe(true)
  })
  it('caps an untaken base at the limit', () => {
    const name = uniqueName('c'.repeat(80), () => false)
    expect(name.length).toBe(64)
    expect(name).toBe('c'.repeat(64))
  })
})

describe('ToolNameRegistry', () => {
  it('registers, dedupes, and resolves names', () => {
    const reg = new ToolNameRegistry()
    const a = reg.register('FreeCAD', { serverId: 's1', toolName: 'run' })
    const again = reg.register('FreeCAD', { serverId: 's1', toolName: 'run' })
    const b = reg.register('FreeCAD', { serverId: 's2', toolName: 'run' })
    expect(a).toBe('FreeCAD__run')
    expect(again).toBe(a)
    expect(b).toBe('FreeCAD__run_2')
    expect(reg.resolve(a)).toEqual({ serverId: 's1', toolName: 'run' })
    expect(reg.resolve(b)).toEqual({ serverId: 's2', toolName: 'run' })
    expect(reg.resolve('nope')).toBeUndefined()
  })
})
