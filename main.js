const {launch: puppeteerLaunch} = require('puppeteer-core')
const {launch, getStream} = require('puppeteer-stream')
const fs = require('fs')
const child_process = require('child_process')
const process = require('process')
const path = require('path')
const express = require('express')
const morgan = require('morgan')
const {loadAutomationRules, runAutomationForUrl} = require('./src/automation-runner')
require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l)',
})

// --------------------- Type definition ---------------------------

/** @typedef {import('puppeteer-core').Browser} Browser */

// ---------------------------------------------------------------------

// --- suppress harmless first-run extension error, but still restart ---
const EXT_ID = 'jjndjgheafjngoipoacpjgeicjeomjli'

process.on('unhandledRejection', reason => {
  const msg = String(reason?.message || reason || '')
  if (msg.includes('net::ERR_BLOCKED_BY_CLIENT') && msg.includes(`chrome-extension://${EXT_ID}/options.html`)) {
    console.log('[Info] Restarting following first-run puppeteer-stream extension installation')
    process.exit(1) // still exit so supervisor restarts
    return
  }
  console.error('Unhandled rejection:', reason)
  process.exit(1)
})
// ---------------------------------------------------------------------

// Parse command line arguments
const argv = require('yargs')
  .option('videoBitrate', {
    alias: 'v',
    description: 'Video bitrate in bits per second',
    type: 'number',
    default: 6000000,
  })
  .option('audioBitrate', {
    alias: 'a',
    description: 'Audio bitrate in bits per second',
    type: 'number',
    default: 256000,
  })
  .option('frameRate', {
    alias: 'f',
    description: 'Minimum frame rate',
    type: 'number',
    default: 30,
  })
  .option('port', {
    alias: 'p',
    description: 'Port number for the server',
    type: 'number',
    default: 5589,
  })
  .option('width', {
    alias: 'w',
    description: 'Video width in pixels (e.g., 1920 for 1080p)',
    type: 'number',
    default: 1920,
  })
  .option('height', {
    alias: 'h',
    description: 'Video height in pixels (e.g., 1080 for 1080p)',
    type: 'number',
    default: 1080,
  })
  .option('minimizeWindow', {
    alias: 'm',
    description: 'Minimize window on start',
    type: 'boolean',
    default: false,
  })
  .option('rules', {
    alias: 'r',
    type: 'string',
    describe: 'Path or URL to the automation rules JSON file',
    default: 'https://raw.githubusercontent.com/BryantS11/cc4c-rules/refs/heads/main/automation.json',
  })
  .option('rulesRefreshTimer', {
    alias: 't',
    type: 'number',
    default: 15,
    describe: 'Minutes before rules are pulled from remote url',
  })
  .scriptName('cc4c')
  .usage('Usage: $0 [options]')
  .example('$0 -v 6000000 -a 192000 -f 30 -w 1920 -h 1080', 'Capture at 6Mbps video, 192kbps audio, 30fps, 1920x1080')
  .example(
    '$0 --videoBitrate 8000000 --audioBitrate 320000 --frameRate 60 --width 1920 --height 1080',
    'High quality capture at 8Mbps and 60fpsm 1920x1080'
  )
  .wrap(null) // Don't wrap help text
  .help()
  .alias('help', '?')
  .version(false) // Disable version number in help
  .parseSync() // Parse to JS, non Async // Give Types

// Display settings
console.log('Selected settings:')
console.log(`Video Bitrate: ${argv.videoBitrate} bps (${argv.videoBitrate / 1000000}Mbps)`)
console.log(`Audio Bitrate: ${argv.audioBitrate} bps (${argv.audioBitrate / 1000}kbps)`)
console.log(`Minimum Frame Rate: ${argv.frameRate} fps`)
console.log(`Port: ${argv.port}`)
console.log(`Resolution: ${argv.width}x${argv.height}`)
console.log(`Rules URL: ${argv.rules}`)
console.log(`Rules Refresh Timer (minutes): ${argv.rulesRefreshTimer}`)

const encodingParams = {
  videoBitsPerSecond: argv.videoBitrate,
  audioBitsPerSecond: argv.audioBitrate,
  minFrameRate: argv.frameRate,
  maxFrameRate: 60,
  mimeType: 'video/webm;codecs=H264',
}

const viewport = {
  width: argv.width,
  height: argv.height,
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

var currentBrowser, dataDir, lastPage
/**
 * Gets the current Puppeteer browser instance.
 * @returns {Promise<Browser>} The current Puppeteer browser.
 */
const getCurrentBrowser = async () => {
  if (!currentBrowser || !currentBrowser.isConnected()) {
    currentBrowser = await launch(
      {
        launch: opts => {
          if (process.env.DOCKER) {
            opts.args = opts.args.concat([
              '--use-gl=angle',
              '--use-angle=gl-egl',
              '--enable-features=VaapiVideoDecoder,VaapiVideoEncoder',
              '--ignore-gpu-blocklist',
              '--enable-zero-copy',
              '--enable-drdc',
              '--no-sandbox',
            ])
          }
          console.log('Launching Browser, Opts', opts)
          return puppeteerLaunch(opts)
        },
      },
      {
        executablePath: getExecutablePath(),
        pipe: true, // more robust to keep browser connection from disconnecting
        headless: false,
        defaultViewport: null, // no viewport emulation
        userDataDir: path.join(dataDir, 'chromedata'),
        args: [
          '--no-first-run', // Skip first run wizards
          '--hide-crash-restore-bubble',
          '--allow-running-insecure-content', // Sling has both https and http
          '--autoplay-policy=no-user-gesture-required',
          '--disable-blink-features=AutomationControlled', // mitigates bot detection
          '--hide-scrollbars', // Hide scrollbars on captured pages
          '--window-size=' + viewport.width + ',' + viewport.height, // Set viewport resolution
          '--disable-notifications', // Mimic real user behavior
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-background-media-suspend',
          '--disable-backgrounding-occluded-windows',
        ],
        ignoreDefaultArgs: [
          '--enable-automation',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-component-update',
          '--disable-component-extensions-with-background-pages',
          '--enable-blink-features=IdleDetection',
          '--mute-audio',
        ],
      }
    )

    currentBrowser.on('close', () => {
      currentBrowser = null
      console.log('Browser closed')
    })

    currentBrowser.on('targetcreated', target => {
      console.log('New target page created:', target.url())
    })

    currentBrowser.on('targetchanged', target => {
      console.log('Target page changed:', target.url())
    })

    currentBrowser.on('targetdestroyed', target => {
      console.log('Browser page closed:', target.url())
    })

    currentBrowser.on('disconnected', () => {
      console.log('Browser disconnected')
    })
  }

  return currentBrowser
}

const getExecutablePath = () => {
  if (process.env.CHROME_BIN) {
    return process.env.CHROME_BIN
  }

  let executablePath
  if (process.platform === 'linux') {
    try {
      executablePath = child_process.execSync('which chromium-browser').toString().split('\n').shift()
    } catch (e) {
      // NOOP
    }

    if (!executablePath) {
      executablePath = child_process.execSync('which chromium').toString().split('\n').shift()
      if (!executablePath) {
        throw new Error('Chromium not found (which chromium)')
      }
    }
  } else if (process.platform === 'darwin') {
    executablePath = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ].find(fs.existsSync)
  } else if (process.platform === 'win32') {
    executablePath = [
      `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`,
      `C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`,
      path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
    ].find(fs.existsSync)
  } else {
    throw new Error('Unsupported platform: ' + process.platform)
  }

  return executablePath
}

async function main() {
  dataDir = process.cwd()
  switch (process.platform) {
    case 'darwin':
      dataDir = path.join(process.env.HOME, 'Library', 'Application Support', 'ChromeCapture')
      break
    case 'win32':
      dataDir = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ChromeCapture')
      break
  }
  // Rules
  let rulesSource = argv.rules
  await loadAutomationRules(rulesSource)

  // Optional auto-refresh
  setInterval(async () => {
    console.log('[Automation] Refreshing rules...')
    await loadAutomationRules(rulesSource)
  }, argv.rulesRefreshTimer * 60 * 1000)
  //

  const app = express()

  const df = require('dateformat')
  morgan.token('mydate', function (req) {
    return df(new Date(), 'yyyy/mm/dd HH:MM:ss.l')
  })
  app.use(morgan('[:mydate] :method :url from :remote-addr responded :status in :response-time ms'))

  app.get('/', (req, res) => {
    res.send(
      `<html>
  <title>Chrome Capture for Channels</title>
  <h2>Chrome Capture for Channels</h2>
  <p>Usage: <code>/stream?url=URL</code> or <code>/stream/&lt;name></code></p>
  <pre>
  #EXTM3U

  #EXTINF:-1 channel-id="windy",Windy
  chrome://${req.get('host')}/stream/windy

  #EXTINF:-1 channel-id="weatherscan",Weatherscan
  chrome://${req.get('host')}/stream/weatherscan
  </pre>
  </html>`
    )
  })

  app.get('/debug', async (req, res) => {
    res.send(`<html>
    <script>
    async function videoClick(e) {
      e.target.focus()
      let x = ((e.clientX-e.target.offsetLeft) * e.target.videoWidth)/e.target.clientWidth
      let y = ((e.clientY-e.target.offsetTop) * e.target.videoHeight)/e.target.clientHeight
      console.log('video click', x, y)
      await fetch('/debug/click/'+x+'/'+y)
    }
    async function videoKeyPress(e) {
      console.log('video keypress', e.key)
      await fetch('/debug/keypress/'+e.key)
    }
    document.addEventListener('keypress', videoKeyPress)
    </script>
    <video style="width: 100%; height: 100%" onKeyPress="videoKeyPress(event)" onClick="videoClick(event)" src="/stream?waitForVideo=false&url=${encodeURIComponent(
      req.query.url || 'https://google.com'
    )}" autoplay muted />
    </html>`)
  })

  app.get('/debug/click/:x/:y', async (req, res) => {
    let browser = await getCurrentBrowser()
    let pages = await browser.pages()
    if (pages.length == 0) {
      res.send('false')
      return
    }
    let page = pages[pages.length - 1]
    await page.mouse.click(parseInt(req.params.x), parseInt(req.params.y))
    res.send('true')
  })

  app.get('/debug/keypress/:key', async (req, res) => {
    let browser = await getCurrentBrowser()
    let pages = await browser.pages()
    if (pages.length == 0) {
      res.send('false')
      return
    }
    let page = pages[pages.length - 1]
    await page.keyboard.press(req.params.key)
    res.send('true')
  })

  app.get('/stream{/:name}', async (req, res) => {
    var u = req.query.url
    let name = req.params.name
    if (name) {
      u = {
        nbc: 'https://www.nbc.com/live?brand=nbc&callsign=nbc',
        cnbc: 'https://www.nbc.com/live?brand=cnbc&callsign=cnbc',
        msnbc: 'https://www.nbc.com/live?brand=msnbc&callsign=msnbc',
        nbcnews: 'https://www.nbc.com/live?brand=nbc-news&callsign=nbcnews',
        bravo: 'https://www.nbc.com/live?brand=bravo&callsign=bravo_east',
        bravop: 'https://www.nbc.com/live?brand=bravo&callsign=bravo_west',
        e: 'https://www.nbc.com/live?brand=e&callsign=e_east',
        ep: 'https://www.nbc.com/live?brand=e&callsign=e_west',
        golf: 'https://www.nbc.com/live?brand=golf&callsign=golf',
        oxygen: 'https://www.nbc.com/live?brand=oxygen&callsign=oxygen_east',
        oxygenp: 'https://www.nbc.com/live?brand=oxygen&callsign=oxygen_west',
        syfy: 'https://www.nbc.com/live?brand=syfy&callsign=syfy_east',
        syfyp: 'https://www.nbc.com/live?brand=syfy&callsign=syfy_west',
        usa: 'https://www.nbc.com/live?brand=usa&callsign=usa_east',
        usap: 'https://www.nbc.com/live?brand=usa&callsign=usa_west',
        universo: 'https://www.nbc.com/live?brand=nbc-universo&callsign=universo_east',
        universop: 'https://www.nbc.com/live?brand=nbc-universo&callsign=universo_west',
        necn: 'https://www.nbc.com/live?brand=necn&callsign=necn',
        nbcsbayarea: 'https://www.nbc.com/live?brand=rsn-bay-area&callsign=nbcsbayarea',
        nbcsboston: 'https://www.nbc.com/live?brand=rsn-boston&callsign=nbcsboston',
        nbcscalifornia: 'https://www.nbc.com/live?brand=rsn-california&callsign=nbcscalifornia',
        nbcschicago: 'https://www.nbc.com/live?brand=rsn-chicago&callsign=nbcschicago',
        nbcsphiladelphia: 'https://www.nbc.com/live?brand=rsn-philadelphia&callsign=nbcsphiladelphia',
        nbcswashington: 'https://www.nbc.com/live?brand=rsn-washington&callsign=nbcswashington',
        weatherscan: 'https://v2.weatherscan.net/',
        windy: 'https://windy.com',
        gpu: 'chrome://gpu',
      }[name]
    }

    await handleStreamRequest(req, res, u)
  })

  async function handleStreamRequest(req, res, u) {
    /** @param {Browser} browser */
    async function setupPage(browser) {
      // Create a new page
      var newPage = await browser.newPage()

      // Stabilize it
      await newPage.setBypassCSP(true) // Sometimes needed for puppeteer-stream
      await delay(1000) // Wait for the page to be stable

      // Now try to enable stream capabilities
      if (newPage.getStream) {
        console.log('Stream capabilities already present')
      } else {
        console.log('Need to initialize stream capabilities')
        // Here you might need to reinitialize puppeteer-stream
      }

      // Show browser error messages, but for Sling filter out Sling Mixed Content warnings
      newPage.on('console', msg => {
        const text = msg.text()
        // Filter out messages containing "Mixed Content"
        if (!text.includes('Mixed Content')) {
          // UNCOMMENT THIS LINE TO SEE ALL BROWSER MESSAGES
          //console.log(text);
        }
      })

      return newPage
    }

    var browser, page
    try {
      browser = await getCurrentBrowser()
      page = await setupPage(browser)
    } catch (e) {
      console.log('failed to start browser page', u, e)
      res.status(500).send(`failed to start browser page: ${e}`)
      return
    }

    try {
      const stream = await getStream(page, {
        video: true,
        audio: true,
        videoBitsPerSecond: encodingParams.videoBitsPerSecond,
        audioBitsPerSecond: encodingParams.audioBitsPerSecond,
        mimeType: encodingParams.mimeType,
        videoConstraints: {
          mandatory: {
            // Fix: Type MediaTrackConstraints
            height: viewport.height,
            width: viewport.width,
            frameRate: {
              min: encodingParams.minFrameRate,
              max: encodingParams.maxFrameRate,
            },
          },
        },
      })

      // Handle stream events
      stream.on('error', err => {
        console.log('Stream error:', err)
      })

      stream.on('end', () => {
        console.log('Stream ended naturally')
      })

      console.log('streaming', u)
      stream.pipe(res)

      // Handle response events - close event is expected
      req.on('close', async err => {
        console.log('received close event on request')
        stream.destroy()
        await page.close()
        console.log('finished', u)
      })

      res.on('error', async err => {
        console.log('error on response:', err)
        stream.destroy()
        await page.close()
      })

      res.on('finish', async err => {
        console.log('Response finished')
        stream.destroy()
        await page.close()
      })
    } catch (e) {
      console.log('failed to start stream', u, e)
      res.status(500).send(`failed to start stream: ${e}`)
      await page.close()
      return
    }

    try {
      // go to the page
      await page.goto(u)

      //  get some additional info about the page
      const uiSize = await page.evaluate(() => {
        // Give uiSize type of { height: number; width: number; }
        return {
          height: window.outerHeight - window.innerHeight,
          width: window.outerWidth - window.innerWidth,
        }
      })
      const session = await page.createCDPSession() // page.target() is deprecated
      const {windowId} = await session.send('Browser.getWindowForTarget')

      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          height: viewport.height + uiSize.height,
          width: viewport.width + uiSize.width,
        },
      })
      if (argv.minimizeWindow) {
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            windowState: 'minimized',
          },
        })
      }
    } catch (e) {
      console.log('failed to goto page and setup window', u, e)
    }

    // Run Rules
    await runAutomationForUrl(page, req)
  }

  const server = app.listen(argv.port, () => {
    console.log('Chrome Capture server listening on port', argv.port)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
