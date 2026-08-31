import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

/**
 * 局势研判文案的 en / zh-CN 全量核对：
 * - 两 locale 的键集合（复数后缀归一化后）完全一致，无缺键；
 * - 每个键的 i18next 插值变量名（{{var}}）完全一致，无插值错误；
 * - 研判文案不经 TranslationComponent 手工插槽，禁止出现未配对的单花括号占位符
 *   （单花括号不会被 i18next 替换，会原样显示）。
 */

const PLURAL_SUFFIX_PATTERN = /_(zero|one|two|few|many|other)$/
const INTERPOLATION_PATTERN = /\{\{\s*(\w+)\s*\}\}/g
const UNPAIRED_SINGLE_BRACE_PATTERN = /(?<!\{)\{(\w+)\}(?!\})/g

function loadSituationReadTree(locale: 'en' | 'zh-CN'): Record<string, unknown> {
  const parsed = YAML.parse(
    fs.readFileSync(`src/shared/i18n/${locale}/renderer/ongoing-game.yaml`, 'utf-8')
  )

  return parsed.ongoingGame.situationRead
}

/** 扁平化为「复数后缀归一化键 → 叶子值列表」，供跨 locale 比较 */
function flattenKeys(node: unknown, prefix = ''): Map<string, string[]> {
  const flattened = new Map<string, string[]>()

  for (const [rawKey, value] of Object.entries(node ?? {})) {
    const key = prefix ? `${prefix}.${rawKey}` : rawKey
    const normalizedKey = key.replace(PLURAL_SUFFIX_PATTERN, '')

    if (value !== null && typeof value === 'object') {
      for (const [childKey, childValues] of flattenKeys(value, normalizedKey)) {
        flattened.set(childKey, [...(flattened.get(childKey) ?? []), ...childValues])
      }
      continue
    }

    flattened.set(normalizedKey, [...(flattened.get(normalizedKey) ?? []), String(value)])
  }

  return flattened
}

function getInterpolationNames(text: string): string[] {
  return [...text.matchAll(INTERPOLATION_PATTERN)].map((match) => match[1]).sort()
}

describe('situation read i18n en / zh-CN parity', () => {
  const enTree = flattenKeys(loadSituationReadTree('en'))
  const zhTree = flattenKeys(loadSituationReadTree('zh-CN'))

  it('has the same key set in both locales', () => {
    expect([...zhTree.keys()].sort()).toEqual([...enTree.keys()].sort())
  })

  it.each([...enTree.keys()].sort())('uses the same interpolation names for %s', (key) => {
    const enNames = enTree.get(key)!.flatMap(getInterpolationNames)
    const zhNames = zhTree.get(key)!.flatMap(getInterpolationNames)

    expect(zhNames).toEqual(enNames)
  })

  it('does not use unpaired single-brace placeholders that i18next would not render', () => {
    const offenders: { locale: string; key: string; text: string }[] = []

    for (const [locale, tree] of [
      ['en', enTree],
      ['zh-CN', zhTree]
    ] as const) {
      for (const [key, values] of tree) {
        for (const text of values) {
          if ([...text.matchAll(UNPAIRED_SINGLE_BRACE_PATTERN)].length > 0) {
            offenders.push({ locale, key, text })
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
