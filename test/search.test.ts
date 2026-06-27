// Runs the REAL search index (src/main/search.ts) over the live snapline-data.json
// and reports matches. This is the same code path the app's search box uses
// (api.search -> runSearch -> getSearch().search). Pure JS, no Electron needed.
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSearch } from '../src/main/search'

const dataPath =
  process.env.SNAP_DATA || path.join(os.homedir(), 'AppData', 'Roaming', 'snapline', 'snapline-data.json')

const db = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
const search = getSearch()
search.rebuild(db.screenshots, db.projects, db.tags)

console.log('--- SNAPLINE SEARCH TEST ---')
console.log(`indexed ${db.screenshots.length} screenshots from ${dataPath}\n`)

for (const q of ['Google Ads', 'Aurora', 'website webapp', 'zzz-no-such-text']) {
  const ids: string[] = search.search(q)
  console.log(`query "${q}"  ->  ${ids.length} match(es)`)
  for (const id of ids) {
    const s = db.screenshots.find((x: any) => x.id === id)
    const snippet = (s?.ocrText ?? '').replace(/\s+/g, ' ').slice(0, 70)
    console.log(`   • ${s?.fileName}   "${snippet}…"`)
  }
  console.log('')
}
