import { describe, expect, it } from 'vitest'
import { paginateContent } from '../src/index.ts'

describe('TiggyKnowledge read pagination', () => {
  it('returns exact continuation offsets across a long document', () => {
    expect(paginateContent('abcdefghij', 0, 4, false)).toEqual({
      content: 'abcd',
      offset: 0,
      returnedCharacters: 4,
      totalCharacters: 10,
      hasMore: true,
      nextOffset: 4,
      sourceTruncated: false,
      truncated: true,
    })
    expect(paginateContent('abcdefghij', 4, 4, false)).toMatchObject({
      content: 'efgh',
      offset: 4,
      nextOffset: 8,
      hasMore: true,
    })
    expect(paginateContent('abcdefghij', 8, 4, false)).toEqual({
      content: 'ij',
      offset: 8,
      returnedCharacters: 2,
      totalCharacters: 10,
      hasMore: false,
      sourceTruncated: false,
      truncated: false,
    })
  })

  it('returns an empty terminal page when offset is past the end', () => {
    expect(paginateContent('abc', 10, 4, false)).toMatchObject({
      content: '',
      offset: 10,
      returnedCharacters: 0,
      totalCharacters: 3,
      hasMore: false,
      truncated: false,
    })
  })

  it('preserves source extraction truncation independently of pagination', () => {
    expect(paginateContent('abc', 0, 10, true)).toMatchObject({
      content: 'abc',
      hasMore: false,
      sourceTruncated: true,
      truncated: true,
    })
  })
})
