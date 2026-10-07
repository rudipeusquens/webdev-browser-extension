import { describe, expect, it } from 'vitest'
import { insertTranscript } from '@/entrypoints/overlay.content/transcript'

describe('insertTranscript', () => {
  it('fills an empty field', () => {
    expect(insertTranscript('', 0, 0, 'Make it wider.')).toEqual({
      value: 'Make it wider.',
      caret: 14,
      cut: false,
    })
  })

  it('adds a space after a word at the caret', () => {
    expect(insertTranscript('Fix this', 8, 8, 'and that.')).toEqual({
      value: 'Fix this and that.',
      caret: 18,
      cut: false,
    })
  })

  it('adds no space after whitespace or a line break', () => {
    expect(insertTranscript('Fix this ', 9, 9, 'now').value).toBe('Fix this now')
    expect(insertTranscript('Line\n', 5, 5, 'next').value).toBe('Line\nnext')
  })

  it('adds a space before a word that follows the caret', () => {
    expect(insertTranscript('world', 0, 0, 'Hello')).toEqual({
      value: 'Hello world',
      caret: 5,
      cut: false,
    })
    expect(insertTranscript('ab cd', 2, 2, 'X')).toEqual({ value: 'ab X cd', caret: 4, cut: false })
  })

  it('adds no space before punctuation', () => {
    expect(insertTranscript('Make it .', 8, 8, 'wider')).toEqual({
      value: 'Make it wider.',
      caret: 13,
      cut: false,
    })
    expect(insertTranscript('Make it wider', 13, 13, ', please').value).toBe(
      'Make it wider, please',
    )
  })

  it('adds no space after an opening bracket or quote', () => {
    expect(insertTranscript('Say (', 5, 5, 'hello').value).toBe('Say (hello')
    expect(insertTranscript('Use [', 5, 5, 'x').value).toBe('Use [x')
    expect(insertTranscript('Use {', 5, 5, 'x').value).toBe('Use {x')
    expect(insertTranscript('He said "', 9, 9, 'wow').value).toBe('He said "wow')
    expect(insertTranscript('"', 1, 1, 'wow').value).toBe('"wow')
    expect(insertTranscript('Sie sagte „', 11, 11, 'gut').value).toBe('Sie sagte „gut')
    expect(insertTranscript("it's '", 6, 6, 'odd').value).toBe("it's 'odd")
    // A quote after a word closes it.
    expect(insertTranscript('a "word"', 8, 8, 'next').value).toBe('a "word" next')
  })

  it('replaces a selection', () => {
    expect(insertTranscript('Make it red please', 8, 11, 'blue')).toEqual({
      value: 'Make it blue please',
      caret: 12,
      cut: false,
    })
  })

  it('treats a caret beyond the text as its end', () => {
    expect(insertTranscript('Fix', 99, 99, 'it').value).toBe('Fix it')
  })

  it('cuts what does not fit the comment limit and says so', () => {
    const typed = 'x'.repeat(4990)
    const result = insertTranscript(typed, 4990, 4990, 'this text is too long to fit', 5000)
    expect(result.cut).toBe(true)
    expect(result.value).toBe(`${typed} this text`)
    expect(result.caret).toBe(result.value.length)
    expect([...result.value].length).toBeLessThanOrEqual(5000)
  })

  it('counts characters, not UTF-16 units, against the limit', () => {
    const typed = '😀'.repeat(4995)
    const result = insertTranscript(typed, typed.length, typed.length, '😀😀😀 four', 5000)
    expect(result.value).toBe(`${typed} 😀😀😀`)
    expect(result.value.isWellFormed()).toBe(true)
    expect(result.cut).toBe(true)
  })

  it('leaves a full field alone', () => {
    const full = 'x'.repeat(5000)
    expect(insertTranscript(full, 5000, 5000, 'more', 5000)).toEqual({
      value: full,
      caret: 5000,
      cut: true,
    })
  })
})
