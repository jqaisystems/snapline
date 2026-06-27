// Integration test for move-between-projects and editor save (replace / save-copy),
// using the REAL storageFs functions in a throwaway sandbox.
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapline-ops-'))
app.setPath('userData', path.join(tmp, 'userData'))

async function main(): Promise<void> {
  const { getStore } = await import('../src/main/store')
  const { ensureRoot, saveCaptureBuffer, moveScreenshotFile, writeEditedImage, projectDir, uniqueFolderName } =
    await import('../src/main/storageFs')

  const root = path.join(tmp, 'storage')
  fs.mkdirSync(root, { recursive: true })
  const store = getStore()
  store.updateSettings({ storageRoot: root, onboarded: true })
  ensureRoot()

  const pA = store.createProject({ name: 'Alpha', folderName: uniqueFolderName(root, 'Alpha') })
  projectDir(pA)
  const pB = store.createProject({ name: 'Beta', folderName: uniqueFolderName(root, 'Beta') })
  projectDir(pB)

  const buf = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png'))
  const shot = saveCaptureBuffer(buf, { mode: 'region', project: pA }, store.getSettings())!
  store.addScreenshot(shot)
  const oldPath = shot.filePath
  const inA = fs.existsSync(oldPath) && path.dirname(oldPath) === path.join(root, pA.folderName)

  // Move A -> B (what dragging a thumbnail onto a project does)
  const newPath = moveScreenshotFile(shot, pB)
  store.updateScreenshot(shot.id, { projectId: pB.id, filePath: newPath, fileName: path.basename(newPath) })
  const movedToB = fs.existsSync(newPath) && path.dirname(newPath) === path.join(root, pB.folderName)
  const goneFromA = !fs.existsSync(oldPath)

  // Editor saves
  const moved = store.getScreenshot(shot.id)!
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64')
  const rep = writeEditedImage(moved, dataUrl, true)
  const replacedSame = rep.filePath === moved.filePath && !rep.isNew && fs.existsSync(rep.filePath)
  const cp = writeEditedImage(moved, dataUrl, false)
  const copyNew = cp.isNew && cp.filePath !== moved.filePath && /-edited/.test(cp.filePath) && fs.existsSync(cp.filePath)

  const pass = inA && movedToB && goneFromA && replacedSame && copyNew
  console.log('--- SNAPLINE OPS TEST ---')
  console.log('saved into Alpha:       ', inA)
  console.log('moved into Beta:        ', movedToB, '->', path.basename(newPath))
  console.log('old path removed:       ', goneFromA)
  console.log('edit "replace" overwrote:', replacedSame)
  console.log('edit "save copy" made:  ', copyNew, '->', path.basename(cp.filePath))
  console.log('RESULT:', pass ? 'PASS ✓' : 'FAIL ✗')

  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(main).catch((e) => {
  console.error('TEST ERROR', e)
  app.exit(2)
})
