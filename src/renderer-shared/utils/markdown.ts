import MarkdownIt from 'markdown-it'

export const markdownIt = new MarkdownIt({
  html: true
})

/** 渲染不可信内容（如外部 LLM 输出）时使用：不启用内联 HTML，Markdown 语法照常 */
export const markdownItSandboxed = new MarkdownIt({
  html: false
})

const defaultRender =
  markdownIt.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

const applyExternalLinkTarget = (instance: typeof markdownIt) => {
  instance.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const hrefIdx = tokens[idx].attrIndex('href')
    const href = hrefIdx >= 0 ? String(tokens[idx].attrs![hrefIdx][1]) : ''

    if (!href.startsWith('akari://')) {
      tokens[idx].attrSet('target', '_blank')
    }

    return defaultRender(tokens, idx, options, env, self)
  }
}

applyExternalLinkTarget(markdownIt)
applyExternalLinkTarget(markdownItSandboxed)
