import { describe, expect, it } from 'vitest'
import { isLocalhostUrl, parseLocalhostAddress } from './localhostAddress'

describe('localhost preview addresses', () => {
  it.each(['3000', ' localhost:3000 ', 'http://localhost:3000', '127.0.0.1:3000', 'http://[::1]:3000'])('accepts explicit loopback or port: %s', value => {
    expect(parseLocalhostAddress(value)).toEqual({ port: 3000, path: '/' })
  })
  it('preserves encoded paths, query strings, and fragments', () => {
    expect(parseLocalhostAddress('http://localhost:5173/folder/a%20b?q=hello%20world#demo')).toEqual({ port: 5173, path: '/folder/a%20b?q=hello%20world#demo' })
    expect(parseLocalhostAddress('localhost:5173?mode=demo')).toEqual({ port: 5173, path: '/?mode=demo' })
    expect(parseLocalhostAddress('127.0.0.1:5173/demo')).toEqual({ port: 5173, path: '/demo' })
  })
  it.each(['1024', '65535'])('accepts unprivileged port boundary %s', value => {
    expect(parseLocalhostAddress(value)?.port).toBe(Number(value))
  })
  it.each([
    '', '0', '80', '1023', '65536', '3000.5', '3e3', '-3000', 'NaN',
    'https://localhost:3000', 'ftp://localhost:3000', 'http://localhost',
    'http://user:password@localhost:3000', 'http://localhost:3000@evil.test',
    'http://evil.test:3000', 'http://localhost.evil.test:3000', 'http://10.0.0.1:3000',
    'http://2130706433:3000', 'http://127.1:3000', 'http://0x7f000001:3000',
    'http://localhost.:3000', 'http://[::ffff:127.0.0.1]:3000', '//localhost:3000',
    'localhost:3000/hello world', 'localhost:3000/hello\nworld', 'localhost:3000\\evil',
    'localhost:3000foo', '3000/path', 'http://localhost:3000\u007f',
  ])('rejects unsupported or ambiguous address: %j', value => {
    expect(parseLocalhostAddress(value)).toBeNull()
  })
  it('only intercepts explicit supported web links', () => {
    expect(isLocalhostUrl('http://localhost:3000/demo')).toBe(true)
    expect(isLocalhostUrl('http://[::1]:5173')).toBe(true)
    expect(isLocalhostUrl('3000')).toBe(false)
    expect(isLocalhostUrl('localhost:3000')).toBe(false)
    expect(isLocalhostUrl('https://example.com')).toBe(false)
  })
})
