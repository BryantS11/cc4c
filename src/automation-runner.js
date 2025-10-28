'use strict'

const fetch = global.fetch || require('node-fetch')
const {URL} = require('url')

// --------------------- Type definition ---------------------------
/** @typedef {import('puppeteer-core').Page} Page */

// ---------------------------------------------------------------------

/* ------------------------------------------------------
   Global state for automation
------------------------------------------------------ */
let automationRules = []
let macros = []

/* ------------------------------------------------------
   Load rules + macros from remote JSON (e.g. GitHub)
------------------------------------------------------ */
/**
 * Fetch Automation Rules
 * @param {string} url Rules URL
 */
async function loadAutomationRules(url) {
  try {
    const res = await fetch(url)
    const data = await res.json()

    macros = data.macros || []
    automationRules = data.rules || data

    console.log(`[Automation] Loaded from: ${url}`)
    console.log(`[Automation] Loaded ${automationRules.length} rules, ${macros.length} macros`)
  } catch (err) {
    console.error('[Automation] Failed to load automation rules:', err)
  }
}

/* ------------------------------------------------------
   Contextual helpers
------------------------------------------------------ */
function interpolateArgs(args = [], context) {
  if (!Array.isArray(args)) args = [args]
  const result = args.map(a => resolveTemplate(a, context))
  if (process.env.debug) console.log('[Automation] interpolateArgs', args, '=>', result, 'with context', context)
  return result
}

/* ------------------------------------------------------
   Safe expression + template evaluation
------------------------------------------------------ */
function safeEval(expr, context = {}) {
  const keys = Object.keys(context)
  const values = Object.values(context)
  try {
    const fn = new Function(...keys, `"use strict"; return (${expr});`)
    return fn(...values)
  } catch (err) {
    console.warn(`[Automation] Eval error in "${expr}": ${err.message}`)
    return undefined
  }
}

function resolveTemplate(str, context = {}) {
  if (typeof str !== 'string') return str
  return str.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
    const val = safeEval(expr.trim(), context)
    return val !== undefined ? val : `{{${expr}}}`
  })
}

function evaluateCondition(condition, context) {
  try {
    return !!safeEval(resolveTemplate(condition, context), context)
  } catch {
    return false
  }
}

/* ------------------------------------------------------
   Main runner logic
------------------------------------------------------ */
/**
 * Run Automation Step
 * @param {Page} page
 */
async function runStep(page, step, req, context = {}) {
  if (!step) return

  const {action, args = [], use, if: condition, loop, try: trySteps, catch: catchSteps} = step
  const ctx = {...context, query: req.query, params: req.params || {}, headers: req.headers, args}

  // Conditional execution
  if (condition && !evaluateCondition(condition, ctx)) {
    console.log(`[Automation] Skipped step due to condition: ${condition}`)
    return
  }

  // Try/catch block
  if (trySteps) {
    try {
      for (const sub of trySteps) await runStep(page, sub, req, ctx)
    } catch (err) {
      console.warn(`[Automation] Error in try block: ${err.message}`)
      if (catchSteps) {
        for (const sub of catchSteps) await runStep(page, sub, req, {...ctx, error: err})
      }
    }
    return
  }

  // Loop
  if (loop) {
    const {type, condition: loopCond, count, each, steps} = loop

    if (type === 'for' && count) {
      for (let i = 0; i < safeEval(resolveTemplate(count, ctx)); i++) {
        const loopCtx = {...ctx, i}
        for (const sub of steps) await runStep(page, sub, req, loopCtx)
      }
    } else if (type === 'while' && loopCond) {
      let guard = 0
      while (evaluateCondition(loopCond, ctx) && guard++ < 500) {
        for (const sub of steps) await runStep(page, sub, req, ctx)
      }
    } else if (type === 'foreach' && each) {
      const arr = safeEval(resolveTemplate(each, ctx)) || []
      for (let i = 0; i < arr.length; i++) {
        const loopCtx = {...ctx, item: arr[i], i}
        for (const sub of steps) await runStep(page, sub, req, loopCtx)
      }
    }
    return
  }

  // Macros
  if (use) {
    const macro = macros.find(m => m.name === use)
    if (!macro) return console.warn(`[Automation] Unknown macro: ${use}`)

    const passedArgs = interpolateArgs(args, ctx)
    console.log(`[Automation] Running macro "${use}" with args`, passedArgs)

    for (const sub of macro.steps) {
      const macroCtx = {...ctx, args: passedArgs}
      await runStep(page, sub, req, macroCtx)
    }
    return
  }

  // Execute actions
  const processedArgs = interpolateArgs(args, ctx)

  try {
    switch (action) {
      case 'goto':
        await page.goto(processedArgs[0], {waitUntil: 'domcontentloaded'})
        break
      case 'waitForSelector':
        await page.waitForSelector(processedArgs[0], {timeout: 15000})
        break
      case 'waitForFunction':
        // processedArgs[0] = function string, processedArgs[1] = timeout (optional)
        await page.waitForFunction(processedArgs[0], {timeout: Number(processedArgs[1]) || 15000})
        break
      case 'conditional':
        // processedArgs[0] = JS expression to evaluate
        // If it evaluates to false, skip or throw
        const result = await page.evaluate(processedArgs[0])
        if (!result) {
          console.log(`[Automation] Conditional check failed: ${processedArgs[0]}`)
        }
        break
      case 'mouseClick':
        const [x, y, options] = processedArgs
        console.log(`Clicking: ${Number(x)}, ${Number(y)}, ${options}`)
        await page.mouse.click(Number(x), Number(y), options || {})
        break
      case 'keyboardType':
        const textToType = processedArgs[0] // already interpolated
        console.log(`Keyboard Typing: ${textToType}`)
        await page.keyboard.type(textToType)
        break
      case 'keyboardPress':
        const keyToPress = processedArgs[0]
        console.log(`Keyboard Pressing: ${keyToPress}`)
        await page.keyboard.press(keyToPress)
        break
      case 'evaluate':
        // Run arbitrary JS in page context
        await page.evaluate(processedArgs[0])
        break
      case 'screenshot':
        await page.screenshot({path: processedArgs[0] || 'screenshot.png'})
        break
      case 'delay':
        console.log(`Delaying: ${Number(processedArgs[0]) || 1000} `)
        await new Promise(r => setTimeout(r, Number(processedArgs[0]) || 1000))
        break
      case 'loop':
        // loop over sub-steps
        const loopCount = Number(processedArgs[0]) || 1
        for (let i = 0; i < loopCount; i++) {
          if (step.steps && Array.isArray(step.steps)) {
            for (const sub of step.steps) {
              await runStep(page, sub, req, ctx)
            }
          }
        }
        break
      default:
        console.warn(`[Automation] Unknown action: ${action}`)
    }
  } catch (err) {
    console.error(`[Automation] Step failed (${action}):`, err.message)
  }
}

/* ------------------------------------------------------
   Find and execute rule for URL with hostname/wildcard/regex support
------------------------------------------------------ */
async function runAutomationForUrl(page, req) {
  const inputUrl = req.query.url || ''
  if (!inputUrl) {
    console.warn('[Automation] No ?url= provided')
    return
  }

  let hostname
  try {
    hostname = new URL(inputUrl).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    console.warn(`[Automation] Invalid URL: ${inputUrl}`)
    return
  }

  let matchedRule = null

  for (const rule of automationRules) {
    if (!rule.site) continue
    const site = rule.site.trim()

    // Regex-based site pattern: starts and ends with "/"
    if (site.startsWith('/') && site.endsWith('/')) {
      try {
        const regex = new RegExp(site.slice(1, -1), 'i')
        if (regex.test(hostname)) {
          matchedRule = rule
          break
        }
      } catch (err) {
        console.warn(`[Automation] Invalid regex in site: ${site}`)
      }
      continue
    }

    // Wildcard match
    if (site.startsWith('*.')) {
      const domain = site.slice(2).toLowerCase()
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        matchedRule = rule
        break
      }
      continue
    }

    // Normal match (nbc.com, peacocktv.com, etc.)
    const normalizedSite = site.replace(/^www\./, '').toLowerCase()
    if (hostname === normalizedSite || hostname.endsWith(`.${normalizedSite}`)) {
      matchedRule = rule
      break
    }
  }

  if (!matchedRule) {
    console.log(`[Automation] No matching rule for ${hostname}`)
    return
  }

  console.log(`[Automation] Executing rule for ${matchedRule.site}`)
  for (const step of matchedRule.steps) {
    await runStep(page, step, req)
  }
}

/* ------------------------------------------------------
   Exports
------------------------------------------------------ */
module.exports = {
  loadAutomationRules,
  runAutomationForUrl,
}
