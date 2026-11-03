import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('project version source of truth', () => {
  it('matches generated copies to package.json', () => {
    const output = execFileSync('python3', ['scripts/check_version_sot.py'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
    })
    expect(output).toMatch(/version-sot: ok/)
  })
})
