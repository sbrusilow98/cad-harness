import { describe, it, expect } from 'vitest'
import { parseLines, parsePairs, formatPairs } from './kv'

describe('kv helpers', () => {
  it('splits lines and trims blanks', () => {
    expect(parseLines(' a \n\n b\n')).toEqual(['a', 'b'])
  })

  it('parses key/value pairs on the first separator only', () => {
    expect(parsePairs('A=1\nB = x=y\nbroken\n=nokey', '=')).toEqual({ A: '1', B: 'x=y' })
    expect(parsePairs('Authorization: Bearer a:b', ':')).toEqual({ Authorization: 'Bearer a:b' })
  })

  it('formats pairs back and round-trips', () => {
    const map = { A: '1', B: 'two' }
    expect(formatPairs(map, '=')).toBe('A=1\nB=two')
    expect(parsePairs(formatPairs(map, ': '), ':')).toEqual(map)
    expect(formatPairs(undefined, '=')).toBe('')
  })
})
