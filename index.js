/**
 * DeepSeek 余额胶囊 — Host half.
 *
 * Reads the signed-in DeepSeek account wallet balance through the Host
 * `deepseekAccount` service and streams it to the Web pill over Server-Sent
 * Events, so the Client never needs an API key and never polls.
 *
 * Refresh moments: a new stream subscriber, a manual `POST` from the pill, and
 * the end of every Agent turn (`agent/status` -> `idle`).
 */

export const inject = ['webServer', 'deepseekAccount']

const STREAM_PATH = '/dsh-balance-pill/stream'

function toNumber(value) {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function sumWallets(wallets, currency) {
  return round2(
    wallets
      .filter((wallet) => wallet.currency === currency)
      .reduce((total, wallet) => total + toNumber(wallet.balance), 0),
  )
}

export function apply(ctx, config) {
  const warnBelow = Number.isFinite(Number(config?.warnBelow)) ? Number(config.warnBelow) : 10
  const dangerBelow = Number.isFinite(Number(config?.dangerBelow)) ? Number(config.dangerBelow) : 5

  const subscribers = new Set()
  const agentListeners = new Map()

  let snapshot = { phase: 'loading', updatedAt: 0, warnBelow, dangerBelow }
  let inflight = null
  let debounceTimer = null
  let keepaliveTimer = null

  function publish() {
    if (subscribers.size === 0) return
    const frame = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
    for (const response of [...subscribers]) {
      try {
        response.write(frame)
      } catch {
        subscribers.delete(response)
      }
    }
  }

  async function collect() {
    const client = {
      version: '1',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }

    let account = null
    try {
      account = await ctx.deepseekAccount.getState()
    } catch {
      account = null
    }
    const links = account?.links ?? {}
    const base = { links, warnBelow, dangerBelow, updatedAt: Date.now() }

    try {
      const balance = await ctx.deepseekAccount.getBalance(client)
      if (balance === null) {
        snapshot = { ...base, phase: 'signed-out' }
        return
      }
      if (balance.status !== 'ready') {
        snapshot = { ...base, phase: 'error', message: '平台没有返回余额' }
        return
      }

      const rechargeWallets = balance.value ?? []
      const bonusWallets = balance.bonusWallets ?? []
      const allWallets = [...rechargeWallets, ...bonusWallets]
      const currencies = [...new Set(allWallets.map((wallet) => wallet.currency))]
      const currency = currencies.includes('CNY') ? 'CNY' : (currencies[0] ?? 'CNY')
      const total = round2(
        allWallets
          .filter((wallet) => wallet.currency === currency)
          .reduce((sum, wallet) => sum + toNumber(wallet.balance), 0),
      )
      const others = currencies
        .filter((entry) => entry !== currency)
        .map((entry) => ({
          currency: entry,
          total: round2(
            allWallets
              .filter((wallet) => wallet.currency === entry)
              .reduce((sum, wallet) => sum + toNumber(wallet.balance), 0),
          ),
        }))

      snapshot = {
        ...base,
        phase: 'ready',
        currency,
        total,
        recharge: sumWallets(rechargeWallets, currency),
        bonus: sumWallets(bonusWallets, currency),
        available: total > 0,
        others,
      }
    } catch (error) {
      snapshot = {
        ...base,
        phase: 'error',
        message: String(error?.message ?? error ?? '未知错误'),
      }
    }
  }

  function refresh() {
    if (inflight === null) {
      inflight = collect()
        .catch((error) => {
          snapshot = {
            phase: 'error',
            message: String(error?.message ?? error ?? '未知错误'),
            updatedAt: Date.now(),
            warnBelow,
            dangerBelow,
          }
        })
        .finally(() => {
          inflight = null
          publish()
        })
    }
    return inflight
  }

  function scheduleRefresh() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void refresh()
    }, 1200)
  }

  function onAgentStatus(payload) {
    if (payload?.status === 'idle') scheduleRefresh()
  }

  function handleStream(req, res) {
    if (req.method === 'POST') {
      res.statusCode = 204
      res.end()
      void refresh()
      return
    }
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('method not allowed')
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    subscribers.add(res)

    const drop = () => {
      subscribers.delete(res)
    }
    req.on('close', drop)
    res.on('close', drop)

    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
    void refresh()
  }

  ctx.effect(() => {
    const offRoute = ctx.webServer.register({
      kind: 'exact',
      path: STREAM_PATH,
      handler: handleStream,
    })

    keepaliveTimer = setInterval(() => {
      for (const response of [...subscribers]) {
        try {
          response.write(': ping\n\n')
        } catch {
          subscribers.delete(response)
        }
      }
    }, 25000)

    const offStatus = ctx.on('agent/status', onAgentStatus)
    const offCreated = ctx.on('agent/created', (payload) => {
      const agent = payload?.agent
      if (!agent?.ctx) return
      const off = agent.ctx.on('agent/status', onAgentStatus)
      agentListeners.set(agent, off)
    })
    const offDisposed = ctx.on('agent/disposed', (payload) => {
      const agent = payload?.agent
      const off = agentListeners.get(agent)
      if (off) {
        off()
        agentListeners.delete(agent)
      }
    })
    const offReload = ctx.on('app-boot/config-reload', () => {
      void refresh()
    })

    return () => {
      offRoute()
      offStatus()
      offCreated()
      offDisposed()
      offReload()
      for (const off of agentListeners.values()) off()
      agentListeners.clear()
      if (keepaliveTimer !== null) clearInterval(keepaliveTimer)
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      for (const response of subscribers) {
        try {
          response.end()
        } catch {
          // already gone
        }
      }
      subscribers.clear()
    }
  })
}
