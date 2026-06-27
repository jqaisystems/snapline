// Integration test of the REAL filing pipeline (store + storageFs.saveCaptureBuffer),
// run inside an Electron process against a throwaway userData + storage folder so it
// never touches live data. Proves: active project -> capture files into that project's folder.
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapline-test-'))
app.setPath('userData', path.join(tmp, 'userData'))

async function main(): Promise<void> {
  const { getStore } = await import('../src/main/store')
  const { ensureRoot, saveCaptureBuffer, projectDir, uniqueFolderName } = await import('../src/main/storageFs')

  const root = path.join(tmp, 'storage')
  fs.mkdirSync(root, { recursive: true })

  const store = getStore()
  store.updateSettings({ storageRoot: root, onboarded: true })
  ensureRoot()

  // Create "Test1" and make it active (the two actions the user does in the UI).
  const folderName = uniqueFolderName(root, 'Test1')
  const project = store.createProject({ name: 'Test1', folderName })
  projectDir(project)
  store.updateSettings({ activeProjectId: project.id })

  const buf = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png'))
  const settings = store.getSettings()

  // Capture with the active project (this is exactly what performCapture calls).
  const active = store.getProject(store.getSettings().activeProjectId)
  const shot = saveCaptureBuffer(buf, { mode: 'region', project: active ?? null }, settings)

  const projDir = path.join(root, project.folderName)
  const filedInProject = !!shot && path.dirname(shot.filePath) === projDir && fs.existsSync(shot.filePath)
  if (shot) store.addScreenshot(shot)

  // Capture with no active project -> should go to _Unfiled.
  const shot2 = saveCaptureBuffer(buf, { mode: 'region', project: null }, settings)
  const filedUnfiled = !!shot2 && path.basename(path.dirname(shot2.filePath)) === '_Unfiled' && fs.existsSync(shot2.filePath)

  const pass = filedInProject && filedUnfiled && shot!.width === 256 && !!shot!.thumbPath

  console.log('--- SNAPLINE FILING TEST ---')
  console.log('active project set:        ', store.getSettings().activeProjectId === project.id)
  console.log('active capture in Test1/:  ', filedInProject, '->', shot?.filePath)
  console.log('dims read from image:      ', `${shot?.width}x${shot?.height}`)
  console.log('thumbnail generated:       ', !!shot?.thumbPath)
  console.log('unfiled capture in _Unfiled:', filedUnfiled, '->', shot2?.filePath)
  console.log('RESULT:', pass ? 'PASS ✓' : 'FAIL ✗')

  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(main).catch((e) => {
  console.error('TEST ERROR', e)
  app.exit(2)
})
