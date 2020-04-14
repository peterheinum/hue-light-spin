require('dotenv').config({ path: __dirname + '../../.env' })
const axios = require('axios')
const fs = require('fs')
const path = require('path')

const { get } = require('lodash')
const { eventHub } = require('../utils/eventHub')
const { isEqual } = require('../utils/helpers')

const auth = {
  access_token: '',
  refresh_token: '',
  timestamp: 0
}

const headers = () => ({
  headers: {
    'Authorization': 'Bearer ' + auth.access_token,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
})

let syncInterval
let pingInterval

const track = {
  //Meta data
  id: '',
  artist: {},
  album: {},
  meta: {},

  //Time & Sync
  tick: 0,
  tock: 0,
  initial_track_progress: 0,
  progress_ms: 0,
  duration_ms: 0,
  is_playing: false,
  duration_ms: 0,
  current_sync_id: '',

  //Vibe
  danceability: 0,
  energy: 0,
  key: 0,
  loudness: 0,
  mode: 0,
  speechiness: 0,
  acousticness: 0,
  instrumentalness: 0,
  liveness: 0,
  tempo: 0,

  //Analytics
  bars: [],
  beats: [],
  tatums: [],
  sections: [],
  segments: [],
}

const intervalTypes = ['tatums', 'segments', 'beats', 'bars', 'sections']

const activeInterval = {
  bars: {},
  beats: {},
  tatums: {},
  sections: {},
  segments: {},
}

const lastIndex = {
  bars: 0,
  beats: 0,
  tatums: 0,
  sections: 0,
  segments: 0
}

let syncTime = 0
eventHub.on('addSyncTime', () => {
  syncTime += 50
})

eventHub.on('removeSyncTime', () => {
  syncTime -= 50
})



const resetVariables = () => {
  clearInterval(syncInterval)
  Object.assign(activeInterval, {
    bars: {},
    beats: {},
    tatums: {},
    sections: {},
    segments: {},
  })

  Object.assign(lastIndex, {
    bars: 0,
    beats: 0,
    tatums: 0,
    sections: 0,
    segments: 0
  })

  Object.assign(track, {
    //Meta data
    id: '',
    artist: {},
    album: {},
    meta: {},

    //Time & Sync
    tick: 0,
    tock: 0,
    initial_track_progress: 0,
    progress_ms: 0,
    duration_ms: 0,
    is_playing: false,
    duration_ms: 0,
    current_sync_id: '',

    //Vibe
    danceability: 0,
    energy: 0,
    key: 0,
    loudness: 0,
    mode: 0,
    speechiness: 0,
    acousticness: 0,
    instrumentalness: 0,
    liveness: 0,
    tempo: 0,

    //Analytics
    bars: [],
    beats: [],
    tatums: [],
    sections: [],
    segments: [],
  })
}

const getData = obj => get(obj, 'data')

const removeLastS = ([...str]) => str.reverse().slice(1, str.length).reverse().join('')

const authIsValid = () => {
  const { timestamp } = auth
  return timestamp === 0
    ? false
    : Date.now() - timestamp < 3600000
}

const checkIfNewSong = data => {
  const { item, is_playing } = data
  if (!is_playing) return

  if (get(item, 'id') != track.current_sync_id) {
    return data
  }

  return Promise.reject('song is not new')
}

const reset = data => {
  resetVariables()
  return data
}

const getCurrentlyPlaying = () => {
  console.log('get currently playing')
  if (!authIsValid()) {
    console.log('Auth invalid needs new auth')
    return Promise.reject({ error: 'expired-auth' })
  }

  const url = 'https://api.spotify.com/v1/me/player'
  const options = { url, ...headers() }
  const tick = Date.now()

  return new Promise((resolve, reject) => {
    const resolveWithTick = data => resolve({ ...data, tick })

    axios(options)
      .then(getData)
      .then(resolveWithTick)
      .catch(reject)
  })
}

const extractMetaData = data => {
  const { item, progress_ms, is_playing, tick } = data
  if (!item || !is_playing) {
    return Promise.reject({ error: 'not-playing' })
  }

  const { id, album, artists, duration_ms } = item

  if (is_playing && id !== track.current_sync_id) {
    Object.assign(track, {
      id,
      tick,
      album,
      artists,
      duration_ms,
      progress_ms,
      is_playing,
      current_sync_id: id
    })
  }
}

const getSongVibe = () => {
  const url = `https://api.spotify.com/v1/audio-features/${get(track, 'id')}`
  const options = { url, ...headers() }
  return new Promise((resolve, reject) => {
    axios(options)
      .then(getData)
      .then(resolve)
      .catch(reject)
  })
}

const extractVibeData = data => {
  Object.assign(track, data)
  console.log('vibe data \n', data)
}

const getSongContext = () => {
  const url = `https://api.spotify.com/v1/audio-analysis/${get(track, 'id')}`
  const options = { url, ...headers() }
  return new Promise((resolve, reject) => {
    axios(options)
      .then(getData)
      .then(resolve)
      .catch(reject)
  })
}

const extractAudioAnalysis = data => {
  const { meta, bars, beats, tatums, sections, segments } = data
  Object.assign(track, { meta, bars, beats, tatums, sections, segments })
}





const fixSync = () => {
  const { tick, progress_ms } = track
  const tock = Date.now() - tick
  const initial_track_progress = progress_ms + tock
  const initial_progress_ms = Date.now()
  Object.assign(track, {
    progress_ms: progress_ms + tock + 500,
    initial_track_progress,
    initial_progress_ms
  })
}

const formatFirstInterval = () => {
  intervalTypes.forEach(t => {
    const type = track[t]
    type[0].duration = type[0].start + type[0].duration
    type[0].start = 0
    type[type.length - 1].duration = (track.duration_ms / 1000) - type[type.length - 1].start
    type.forEach(interval => {
      if (interval.loudness_max_time) {
        interval.loudness_max_time = interval.loudness_max_time * 1000
      }

      interval.start = interval.start * 1000
      interval.duration = interval.duration * 1000
    })
  })
}

const setActiveInterval = () => {
  const determineInterval = (type) => {
    const analysis = track[type]
    const progress = track.progress_ms + syncTime
    for (let i = 0; i < analysis.length; i++) {
      if (i === (analysis.length - 1)) return i
      if (analysis[i].start < progress && progress < analysis[i + 1].start) return i
    }
  }

  intervalTypes.forEach(type => {
    const index = determineInterval(type)
    if (!isEqual(track[type][index], activeInterval[type]) && lastIndex[type] < index) {
      activeInterval[type] = track[type][index]
      lastIndex[type] = index
      eventHub.emit(removeLastS(type), [activeInterval[type], index])
    }
  })
}

const startSongSync = () => {
  formatFirstInterval()
  fixSync()

  syncInterval = setInterval(() => {
    track.progress_ms = (Date.now() - get(track, 'initial_progress_ms')) + get(track, 'initial_track_progress')
    setActiveInterval()
    // console.log(millisToMinutesAndSeconds(track.progress_ms))
  }, 10)
}
const handleSyncErrors = error => {
  console.log(error)
}

function millisToMinutesAndSeconds(millis) {
  var minutes = Math.floor(millis / 60000);
  var seconds = ((millis % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}


const sync = () => {
  getCurrentlyPlaying()
  .then(checkIfNewSong)
    .then(reset)
    .then(extractMetaData)
    .then(getSongVibe)
    .then(extractVibeData)
    .then(getSongContext)
    .then(extractAudioAnalysis)
    .then(startSongSync)
    .catch(handleSyncErrors)
}

eventHub.on('startPingInterval', () => {
  if (authIsValid()) {
    pingInterval = setInterval(() => sync(), 5000)
  }
})

eventHub.on('authRecieved', recievedAuth => {
  const timestamp = Date.now()
  Object.assign(auth, { ...recievedAuth, timestamp })
  fs.writeFileSync(path.resolve(`${__dirname}/../utils/spotifyAuth`), JSON.stringify({ auth, timestamp }))
  eventHub.emit('startPingInterval')
  eventHub.emit('quickStart')
})

//UTILITIES MADE FOR FASTER DEVELOPMENT
const quickStart = () => {
  const filePath = path.resolve(`${__dirname}/../utils/spotifyAuth`)
  const json = fs.readFileSync(filePath)
  if (!json.toString()) return

  const { auth: _auth, timestamp } = JSON.parse(json) ? JSON.parse(json) : {}
  if (!timestamp) return
  if (Date.now() - timestamp < 3600000) {
    Object.assign(auth, { ..._auth, timestamp })
    eventHub.emit('startPingInterval')
    eventHub.emit('quickStart')
  }
}

eventHub.on('quickStart', extraEvent => {
  const { getGroups } = require('../services/groupHandler')
  const { startStream, getGroupsAndStopStreams } = require('../services/socket')
  const globalState = require('../utils/globalState')

  console.log('quickStart')
  getGroups().then(groups => {

    globalState.currentGroup = groups[1]

    getGroupsAndStopStreams()
      .then(startStream)
      .then(() => require('./lights'))
      .then(() => extraEvent && eventHub.emit('letsgo'))
  })
})

const initie = () => {
  eventHub.emit('quickStart', true)

}

quickStart()
initie()