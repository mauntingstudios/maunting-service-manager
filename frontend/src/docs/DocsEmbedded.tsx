import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DocsApp } from './DocsApp'

/**
 * Dokumente in Pontis und MSS: dort gibt es bereits einen Router fuer die
 * App-Huelle. Ein eigener MemoryRouter haelt die Dokument-Route aus dem
 * aeusseren Baum heraus, damit ein Wechsel im Editor nicht die App-Huelle
 * umschaltet.
 */
export function DocsEmbedded() {
  return (
    <MemoryRouter initialEntries={['/dokumente']}>
      <Routes>
        <Route path="/dokumente" element={<DocsApp />} />
        <Route path="/dokumente/:uid" element={<DocsApp />} />
      </Routes>
    </MemoryRouter>
  )
}
