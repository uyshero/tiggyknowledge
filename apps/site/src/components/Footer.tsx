import { NavLink } from 'react-router-dom'
import { GITHUB_URL, PRODUCT_ENGLISH_NAME, PRODUCT_NAME } from '../constants'

export function Footer(): JSX.Element {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>
          {PRODUCT_NAME}
          <span> · {PRODUCT_ENGLISH_NAME}</span>
        </p>
        <nav aria-label="页脚">
          <NavLink to="/docs">文档</NavLink>
          <NavLink to="/docs/plugins">插件</NavLink>
          <NavLink to="/docs/roadmap">规划</NavLink>
          <NavLink to="/download">下载</NavLink>
          <a href={GITHUB_URL} rel="noreferrer" target="_blank">GitHub</a>
        </nav>
      </div>
    </footer>
  )
}
