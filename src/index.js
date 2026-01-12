'use strict'

const { downloadTrack, cleanupTempDir, fetchPlaylistTracks, isSoundCloudUrl, isTidalUrl } = require('./downloader')
const { analyzeTrackQuality, qualityDebug } = require('./quality')
const { buildCaption, appendQuality } = require('./captions')
const { createTaskQueue } = require('./queue')
const { isIdhsSupportedLink, resolveLinkViaIdhs } = require('./idhs')
const utils = require('./utils')
const messages = require('./messages')
const config = require('./config')

module.exports = {
  // downloads
  downloadTrack,
  smartDownload: require('./downloader').smartDownload,
  cleanupTempDir,
  fetchPlaylistTracks,
  isSoundCloudUrl,
  isTidalUrl,
  searchTidalTrack: require('./tidal').searchTrack,
  // quality
  analyzeTrackQuality,
  qualityDebug,
  // captions / messages
  buildCaption,
  appendQuality,
  messages,
  // queue
  createTaskQueue,
  // idhs
  isIdhsSupportedLink,
  resolveLinkViaIdhs,
  // misc utils
  utils,
  // config
  config
}
