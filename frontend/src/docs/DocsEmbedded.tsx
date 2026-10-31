import { Route, Routes } from 'react-router-dom'
import { DocsApp } from './DocsApp'

/**
 * Dokumente in Pontis und MSS: dort gibt es bereits einen Router für die
 * App-Hülle. Routes ohne verschachtelten MemoryRouter stellen sicher, dass
 * die Dokument-Routen (/dokumente und /dokumente/:uid) innerhalb des
 * bestehenden Router-Kontexts sauber aufgelöst werden, ohne die React-Router-
 * Ausnahme ("You cannot render a <Router> inside another <Router>") auszulösen.
 */
export function DocsEmbedded() {
  return (
    <Routes>
      <Route path="/dokumente" element={<DocsApp />} />
      <Route path="/dokumente/:uid" element={<DocsApp />} />
      <Route path="*" element={<DocsApp />} />
    </Routes>
  )
}
