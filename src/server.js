const express = require('express')
const { downloadTrack } = require('./downloader')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.post('/download', async (req, res) => {
  const { url, source, token } = req.body

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' })
  }

  console.log(`Received download request for: ${url}`)

  try {
    const result = await downloadTrack(url, { source, token })
    
    // In a real server scenario, we might want to stream the file back 
    // or return a download link. For now, we'll return the path and metadata
    // assuming the client (GUI) can access the filesystem or we add a file serving endpoint.
    
    // If the GUI is remote, we need to serve the file.
    // Let's add a file serving endpoint and return a URL to it.
    
    const fileId = path.basename(result.tempDir) // Use temp dir name as ID for simplicity
    // We need to keep track of this mapping or just serve from the temp dir structure
    
    // For this MVP, let's just return the local path if running locally, 
    // but also provide a download URL if running remotely.
    
    const downloadUrl = `/files/${fileId}/${result.filename}`
    
    // We need to mount the temp dir to serve files. 
    // Since temp dirs are dynamic, we might need a dynamic router or a shared download dir.
    // Let's assume we can serve the specific temp dir.
    
    app.use(`/files/${fileId}`, express.static(result.tempDir))

    res.json({
      success: true,
      metadata: result.metadata,
      localPath: result.path,
      downloadUrl: `http://localhost:${PORT}${downloadUrl}`
    })

  } catch (error) {
    console.error('Download failed:', error)
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Keson Core Server running on port ${PORT}`)
})
