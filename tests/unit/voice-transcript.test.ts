import { describe, expect, it } from 'vitest'
import { appendTranscript } from '@/lib/voice/transcript'

describe('appendTranscript', () => {
  it('fills an empty field', () => {
    expect(appendTranscript('', 'Make it wider.')).toEqual({
      value: 'Make it wider.',
      cut: false,
    })
  })

  it('adds a space after a word', () => {
    expect(appendTranscript('Fix this', 'and that.')).toEqual({
      value: 'Fix this and that.',
      cut: false,
    })
  })

  it('adds no space after whitespace or a line break', () => {
    expect(appendTranscript('Fix this ', 'now').value).toBe('Fix this now')
    expect(appendTranscript('Line\n', 'next').value).toBe('Line\nnext')
  })

  it('adds no space before punctuation', () => {
    expect(appendTranscript('Make it wider', ', please').value).toBe('Make it wider, please')
  })

  it('adds no space after an opening bracket or quote', () => {
    expect(appendTranscript('Say (', 'hello').value).toBe('Say (hello')
    expect(appendTranscript('Use [', 'x').value).toBe('Use [x')
    expect(appendTranscript('Use {', 'x').value).toBe('Use {x')
    expect(appendTranscript('He said "', 'wow').value).toBe('He said "wow')
    expect(appendTranscript('"', 'wow').value).toBe('"wow')
    expect(appendTranscript('Sie sagte „', 'gut').value).toBe('Sie sagte „gut')
    expect(appendTranscript("it's '", 'odd').value).toBe("it's 'odd")
    // A quote after a word closes it, guillemets too (German »…«, French «…»).
    expect(appendTranscript('a "word"', 'next').value).toBe('a "word" next')
    expect(appendTranscript('»gut«', 'und').value).toBe('»gut« und')
    expect(appendTranscript('le «mot»', 'et').value).toBe('le «mot» et')
    expect(appendTranscript('Er sagte «', 'ja').value).toBe('Er sagte «ja')
  })

  it('appends to a short comment', () => {
    expect(appendTranscript('Fix', 'it').value).toBe('Fix it')
  })

  it('cuts what does not fit the comment limit and says so', () => {
    const typed = 'x'.repeat(4990)
    const result = appendTranscript(typed, 'this text is too long to fit', 5000)
    expect(result.cut).toBe(true)
    expect(result.value).toBe(`${typed} this text`)
    expect([...result.value].length).toBeLessThanOrEqual(5000)
  })

  it('counts characters, not UTF-16 units, against the limit', () => {
    const typed = '😀'.repeat(4995)
    const result = appendTranscript(typed, '😀😀😀 four', 5000)
    expect(result.value).toBe(`${typed} 😀😀😀`)
    expect(result.value.isWellFormed()).toBe(true)
    expect(result.cut).toBe(true)
  })

  it('leaves a full field alone', () => {
    const full = 'x'.repeat(5000)
    expect(appendTranscript(full, 'more', 5000)).toEqual({
      value: full,
      cut: true,
    })
  })
})
