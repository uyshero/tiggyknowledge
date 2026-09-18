import type { Context } from '@deepseek-ai/cordis'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useState, useSyncExternalStore, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type {} from '@tiggyknowledge/client-runtime'
import brandIcon from './brand-icon.png'
import './styles.css'

export const inject = ['clientApp']

export function apply(ctx: Context): void {
  function App(): JSX.Element {
    const snapshot = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [collapsed, setCollapsed] = useState(false)
    const selected = snapshot.pages.find(page => page.id === snapshot.selectedPageId)
    const primary = snapshot.pages.filter(page => page.section === 'primary')
    const tags = snapshot.pages.filter(page => page.section === 'tags')
    const secondary = snapshot.pages.filter(page => page.section === 'secondary')
    const Page = selected?.component

    return (
      <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="app-sidebar">
          <div className="brand-row">
            <img className="brand-mark" src={brandIcon} alt="" />
            {!collapsed && <strong>小虎AI知识库</strong>}
            <button className="sidebar-toggle" type="button" title={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(value => !value)}>
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          <nav className="main-navigation" aria-label="主导航">
            {primary.map(page => {
              const Icon = page.icon
              return <button className={snapshot.selectedPageId === page.id ? 'active' : ''} key={page.id} type="button" title={page.label} onClick={() => ctx.clientApp.selectPage(page.id)}><Icon size={18} /><span>{page.label}</span></button>
            })}
            {tags.length > 0 && !collapsed && <div className="nav-section-label">标签</div>}
            {tags.map(page => {
              const Icon = page.icon
              return <button className={snapshot.selectedPageId === page.id ? 'active' : ''} key={page.id} type="button" title={page.label} onClick={() => ctx.clientApp.selectPage(page.id)}><Icon size={18} /><span>{page.label}</span></button>
            })}
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
        {snapshot.appOverlays.map(overlay => {
          const Overlay = overlay.component
          return <Overlay key={overlay.id} />
        })}
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
