'use strict'

const { spawn } = require('node:child_process')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const messages = require('./messages')

async function downloadTrack(url, options = {}) {
  const { token, source } = options
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keson-dl-'))
  
  try {
    const result = await runMusicDl(url, tmpDir, source, token)
    if (!result.success) {
      throw new Error(result.error || 'Unknown error during download')
    }
    
    return {
      tempDir: tmpDir,
      path: result.file_path,
      filename: path.basename(result.file_path),
      metadata: result.metadata
    }
  } catch (error) {
    await cleanupTempDir(tmpDir)
    throw error
  }
}

function runMusicDl(url, outputDir, source, token) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'musicdl_wrapper.py')
    const args = [scriptPath, url, '--output-dir', outputDir]
    
    if (source) {
      args.push('--source', source)
    }
    if (token) {
      args.push('--token', token)
    }

    const pythonProcess = spawn('python3.11', args)
    
    let stdoutData = ''
    let stderrData = ''

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString()
    })

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString()
    })

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`musicdl process exited with code ${code}: ${stderrData}`))
        return
      }

      try {
        const result = JSON.parse(stdoutData)
        resolve(result)
      } catch (err) {
        reject(new Error(`Failed to parse musicdl output: ${err.message}. Output: ${stdoutData}`))
      }
    })
  })
}

async function cleanupTempDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true })
}

module.exports = {
  downloadTrack,
  cleanupTempDir
}

