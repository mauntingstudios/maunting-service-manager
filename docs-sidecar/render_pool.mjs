import { Worker } from "node:worker_threads";

const WORKER_DATEI = new URL("./render_worker.mjs", import.meta.url)

function renderError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createRenderPool({
  size = 2,
  timeoutMs = 10_000,
  maxQueue = 20,
  workerUrl = WORKER_DATEI,
} = {}) {
  const queue = []
  const slots = Array.from({ length: size }, () => ({
    worker: null,
    current: null,
    restarting: false,
  }))
  let naechsteId = 0
  let geschlossen = false

  function verwerfen(task, error) {
    if (task.timer) clearTimeout(task.timer)
    task.reject(error)
  }

  function starten(slot) {
    if (geschlossen || slot.worker || slot.restarting) return
    const worker = new Worker(workerUrl)
    slot.worker = worker
    worker.on("message", (antwort) => {
      const task = slot.current
      if (!task || task.id !== antwort.id) return
      slot.current = null
      if (antwort.error) {
        const error = new Error(antwort.error.message)
        error.code = antwort.error.code
        verwerfen(task, error)
      } else {
        if (task.timer) clearTimeout(task.timer)
        task.resolve(antwort.result)
      }
      verteilen()
    })
    worker.on("error", (error) => {
      if (!slot.current) return
      const task = slot.current
      slot.current = null
      verwerfen(task, error)
      slot.restarting = true
    })
    worker.on("exit", (code) => {
      if (slot.worker !== worker) return
      slot.worker = null
      slot.restarting = false
      if (slot.current) {
        const task = slot.current
        slot.current = null
        verwerfen(task, renderError(`Render-Worker beendet (${code})`, "DOC_RENDER_WORKER_FAILED"))
      }
      if (!geschlossen) {
        starten(slot)
        verteilen()
      }
    })
  }

  function verteilen() {
    if (geschlossen) return
    for (const slot of slots) {
      if (!queue.length || slot.current || slot.restarting) continue
      starten(slot)
      if (!slot.worker) continue
      const task = queue.shift()
      clearTimeout(task.timer)
      slot.current = task
      task.timer = setTimeout(() => {
        if (slot.current !== task) return
        slot.current = null
        verwerfen(task, renderError("Render-Zeitlimit überschritten", "DOC_RENDER_TIMEOUT"))
        slot.restarting = true
        void slot.worker?.terminate()
      }, timeoutMs)
      const { state, ...payload } = task.payload
      const kopie = Uint8Array.from(state)
      slot.worker.postMessage(
        { id: task.id, ...payload, state: kopie },
        [kopie.buffer],
      )
    }
  }

  for (const slot of slots) starten(slot)

  return {
    run(payload) {
      if (geschlossen) {
        return Promise.reject(renderError("Render-Pool ist geschlossen", "DOC_RENDER_UNAVAILABLE"))
      }
      if (queue.length >= maxQueue) {
        return Promise.reject(renderError("Render-Pool ist ausgelastet", "DOC_RENDER_BUSY"))
      }
      return new Promise((resolve, reject) => {
        const task = {
          id: ++naechsteId,
          payload,
          resolve,
          reject,
          timer: null,
        }
        task.timer = setTimeout(() => {
          const index = queue.indexOf(task)
          if (index === -1) return
          queue.splice(index, 1)
          verwerfen(task, renderError("Render-Warteschlange abgelaufen", "DOC_RENDER_TIMEOUT"))
        }, timeoutMs)
        queue.push(task)
        verteilen()
      })
    },
    async close() {
      geschlossen = true
      for (const task of queue.splice(0)) {
        verwerfen(task, renderError("Render-Pool geschlossen", "DOC_RENDER_UNAVAILABLE"))
      }
      await Promise.all(
        slots.map(async (slot) => {
          const task = slot.current
          slot.current = null
          if (task) verwerfen(task, renderError("Render-Pool geschlossen", "DOC_RENDER_UNAVAILABLE"))
          if (slot.worker) await slot.worker.terminate()
          slot.worker = null
        }),
      )
    },
  }
}
