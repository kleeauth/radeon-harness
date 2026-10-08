import { StrictMode } from 'react'

// lets CSS adapt to the window frame: Windows draws its buttons over the top bar, Linux has a system title bar
document.documentElement.dataset.platform = window.opencodeApp?.platform ?? 'browser'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
