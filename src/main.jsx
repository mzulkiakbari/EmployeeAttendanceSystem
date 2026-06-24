import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AlkaysanOAuthProvider } from '@noonor/alkaysan-one';
import VConsole from 'vconsole';

// Initialize vConsole
// if (import.meta.env.MODE === 'development' || window.location.search.includes('debug=true')) {
//   new VConsole();
// }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AlkaysanOAuthProvider
      clientId={import.meta.env.VITE_ALKAYSAN_SSO_CLIENT_ID}
      clientSecret={import.meta.env.VITE_ALKAYSAN_SSO_CLIENT_SECRET}
      redirectURI={import.meta.env.VITE_ALKAYSAN_SSO_REDIRECT_URI}
      responseType="code"
    >
      <App />
    </AlkaysanOAuthProvider>
  </StrictMode>,
)
