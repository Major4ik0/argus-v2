import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { WebSocketProvider } from './context/WebSocketContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)