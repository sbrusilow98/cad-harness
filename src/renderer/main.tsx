import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { platform } from './lib/platform'

// The top bar leaves room for the window controls, which sit on the left on macOS and the right on
// Windows. CSS reads this to decide which side.
document.documentElement.dataset['platform'] = platform

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
