import { Github } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import brandIcon from '../brand-icon.png'
import { GITHUB_URL, PRODUCT_NAME } from '../constants'

export function Header(): JSX.Element {
  return (
    <header className="site-header">
      <a className="skip-link" href="#content">跳到正文</a>
      <div className="site-header-inner">
        <NavLink className="brand" end to="/">
          <img src={brandIcon} alt="" width={30} height={30} />
          <strong>{PRODUCT_NAME}</strong>
        </NavLink>
        <nav aria-label="主导航">
          <NavLink to="/docs">文档</NavLink>
          <NavLink to="/docs/roadmap">规划</NavLink>
          <NavLink to="/download">下载</NavLink>
          <a className="github-link" href={GITHUB_URL} rel="noreferrer" target="_blank">
            <Github size={16} />
            GitHub
          </a>
        </nav>
      </div>
    </header>
  )
}
