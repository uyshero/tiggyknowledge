import type { Context } from '@deepseek-ai/cordis'
import { PanelLeftClose, PanelLeftOpen, Tag } from 'lucide-react'
import { useState, useSyncExternalStore, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type {} from '@tiggyknowledge/client-runtime'
import './styles.css'

export const inject = ['clientApp']

export function apply(ctx: Context): void {
  function App(): JSX.Element {
    const snapshot = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [collapsed, setCollapsed] = useState(false)
    const selected = snapshot.pages.find(page => page.id === snapshot.selectedPageId)
    const primary = snapshot.pages.filter(page => page.section === 'primary')
    const secondary = snapshot.pages.filter(page => page.section === 'secondary')
    const Page = selected?.component

    return (
      <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="app-sidebar">
          <div className="brand-row">
            <div className="brand-mark">T</div>
            {!collapsed && <strong>tiggyknowledge</strong>}
            <button className="sidebar-toggle" type="button" title={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(value => !value)}>
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          <nav className="main-navigation" aria-label="主导航">
            {primary.map(page => {
              const Icon = page.icon
              return <button className={snapshot.selectedPageId === page.id ? 'active' : ''} key={page.id} type="button" title={page.label} onClick={() => ctx.clientApp.selectPage(page.id)}><Icon size={18} /><span>{page.label}</span></button>
            })}
            {!collapsed && <div className="nav-section-label">标签</div>}
            <button className={snapshot.selectedPageId === 'tags' ? 'active' : ''} type="button" title="标签" onClick={() => ctx.clientApp.selectPage('tags')}><Tag size={17} /><span>全部标签</span></button>
          </nav>
          <nav className="secondary-navigation" aria-label="辅助导航">
            {secondary.map(page => {
              const Icon = page.icon
              return <button className={snapshot.selectedPageId === page.id ? 'active' : ''} key={page.id} type="button" title={page.label} onClick={() => ctx.clientApp.selectPage(page.id)}><Icon size={18} /><span>{page.label}</span></button>
            })}
            <div className="connection-state"><i />{!collapsed && <span>本地服务</span>}</div>
          </nav>
        </aside>
        <main className="app-main">{Page === undefined ? <div className="boot-state">正在装配插件...</div> : <Page />}</main>
      </div>
    )
  }

  ctx.effect(() => {
    const element = document.querySelector<HTMLElement>('#root')
    if (element === null) throw new Error('ui-layout: #root mount element is missing')
    const root = createRoot(element)
    root.render(<App />)
    return () => root.unmount()
  }, 'ui-layout: react root')
}
