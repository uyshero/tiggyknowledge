import { Navigate, useParams } from 'react-router-dom'
import { DocNav } from '../components/DocNav'
import { MarkdownDoc } from '../components/Markdown'
import { DEFAULT_DOC_SLUG, findDoc } from '../docs'

export function DocsIndexPage(): JSX.Element {
  return <Navigate replace to={`/docs/${DEFAULT_DOC_SLUG}`} />
}

export function DocsPage(): JSX.Element {
  const { slug } = useParams()
  const page = findDoc(slug)

  if (page === undefined) {
    return (
      <div className="docs-shell">
        <DocNav />
        <div className="docs-missing">
          <h1>没有这篇文档</h1>
          <p>请从左侧目录选择一页，或回到快速开始。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="docs-shell">
      <DocNav />
      <MarkdownDoc markdown={page.markdown} />
    </div>
  )
}
