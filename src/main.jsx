import { StrictMode } from 'react'
import './index.css'
import App, { AuraBar } from './App.jsx'
import { createRoot } from 'react-dom/client'

const isBar = window.location.hash === '#aurabar' ||
              window.location.pathname.includes('bar') ||
              new URLSearchParams(window.location.search).get('aurabar') === '1';

createRoot(document.getElementById('root')).render(
  isBar ? <AuraBar /> : (
    <StrictMode>
      <App />
    </StrictMode>
  )
);