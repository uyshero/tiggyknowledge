import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { DocsIndexPage, DocsPage } from './pages/Docs'
import { DownloadPage } from './pages/Download'
import { HomePage } from './pages/Home'

function ScrollToTop(): null {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export function App(): JSX.Element {
  return (
    <div className="site">
      <ScrollToTop />
      <Header />
      <main id="content">
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<DownloadPage />} path="/download" />
          <Route element={<DocsIndexPage />} path="/docs" />
          <Route element={<DocsPage />} path="/docs/:slug" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
