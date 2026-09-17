import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './styles.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '')
const root = document.querySelector('#root')
if (root === null) throw new Error('site: #root is missing')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={basename === '' ? '/' : basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
