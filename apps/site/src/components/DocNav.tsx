import { NavLink } from 'react-router-dom'
import { DOC_PAGES } from '../docs'

export function DocNav(): JSX.Element {
  return (
    <nav className="doc-nav" aria-label="文档目录">
      <p className="eyebrow">文档</p>
      {DOC_PAGES.map(page => (
        <NavLink key={page.slug} to={`/docs/${page.slug}`}>
          <strong>{page.title}</strong>
          <span>{page.description}</span>
        </NavLink>
      ))}
    </nav>
  )
}
