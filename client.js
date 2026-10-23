/**
 * DeepSeek 余额胶囊 — Client half.
 *
 * A frame-wide pill in `shell.overlay`. The Host half streams balance
 * snapshots over SSE; this module only renders them and asks for a refresh
 * when the user opens the card or presses the refresh button.
 */

window.__ModuleLoader__.load({
  id: 'dsh-balance-pill',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const STREAM_PATH = '/dsh-balance-pill/stream'
    const TOP_UP_URL = 'https://platform.deepseek.com/top_up'
    const USAGE_URL = 'https://platform.deepseek.com/usage'

    const CSS = `
.bp-root { pointer-events: none; }
.bp-pill {
  position: fixed; right: 16px; bottom: 16px; z-index: 46;
  pointer-events: auto;
  display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));
  background: var(--dsw-alias-bg-overlay, #1c1d20);
  color: var(--dsw-alias-label-primary, #e8e8ea);
  box-shadow: 0 6px 22px rgba(0, 0, 0, .22);
  font: 500 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  cursor: pointer; user-select: none;
  transition: transform .12s ease, border-color .12s ease;
}
.bp-pill:hover { transform: translateY(-1px); border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.5)); }
.bp-pill:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4D6BFE); outline-offset: 2px; }
.bp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-idle-primary, #8b8d93); }
.bp-ok .bp-dot { background: var(--dsw-alias-state-success-primary, #2fbf71); }
.bp-warn .bp-dot { background: var(--dsw-alias-state-warn-primary, #e0a12b); }
.bp-danger .bp-dot { background: var(--dsw-alias-state-error-primary, #e5484d); }
.bp-warn { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e0a12b) 55%, transparent); }
.bp-danger { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 55%, transparent); }
.bp-amount { letter-spacing: .2px; }
.bp-muted { color: var(--dsw-alias-label-secondary, #9a9ba1); font-weight: 500; }

.bp-card {
  position: fixed; right: 16px; bottom: 56px; z-index: 47;
  pointer-events: auto;
  width: 240px; box-sizing: border-box;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));
  background: var(--dsw-alias-bg-overlay, #1c1d20);
  color: var(--dsw-alias-label-primary, #e8e8ea);
  box-shadow: 0 14px 44px rgba(0, 0, 0, .32);
  font: 500 12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.bp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.bp-title { font-size: 12px; font-weight: 600; }
.bp-time { font-size: 10px; color: var(--dsw-alias-label-secondary, #9a9ba1); font-variant-numeric: tabular-nums; }
.bp-total { margin: 10px 0 2px; font-size: 26px; line-height: 1.1; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: .3px; }
.bp-total-note { font-size: 11px; color: var(--dsw-alias-label-secondary, #9a9ba1); }
.bp-rows { margin-top: 12px; display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25)); }
.bp-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bp-row span:last-child { font-variant-numeric: tabular-nums; }
.bp-actions { margin-top: 12px; display: flex; gap: 6px; }
.bp-btn {
  flex: 1 1 auto; height: 26px; padding: 0 8px;
  border-radius: 7px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));
  background: transparent;
  color: var(--dsw-alias-label-primary, #e8e8ea);
  font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.bp-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); }
.bp-btn[disabled] { opacity: .45; cursor: default; }
.bp-btn-primary {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4D6BFE) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4D6BFE) 16%, transparent);
  color: var(--dsw-alias-brand-primary, #4D6BFE);
  font-weight: 600;
}
.bp-btn-primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4D6BFE) 28%, transparent); }
.bp-empty { font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9ba1); }
`

    function formatMoney(amount, currency) {
      const symbol = currency === 'USD' ? '$' : '¥'
      const number = Number(amount)
      return symbol + (Number.isFinite(number) ? number : 0).toFixed(2)
    }

    function toneOf(state) {
      if (!state || state.phase !== 'ready') return 'idle'
      if (state.total <= state.dangerBelow) return 'danger'
      if (state.total <= state.warnBelow) return 'warn'
      return 'ok'
    }

    function timeText(state) {
      if (!state || !state.updatedAt) return ''
      return new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
    }

    function tooltip(state) {
      if (!state) return '正在获取 DeepSeek 余额…'
      if (state.phase === 'signed-out') return '未登录 DeepSeek 账号'
      if (state.phase === 'error') return '暂时无法获取余额，点击展开详情'
      if (state.phase !== 'ready') return '正在获取 DeepSeek 余额…'
      const amount = formatMoney(state.total, state.currency)
      if (state.total <= state.dangerBelow) return `余额 ${amount}，已低于 ${formatMoney(state.dangerBelow, state.currency)}，建议尽快充值`
      if (state.total <= state.warnBelow) return `余额 ${amount}，低于 ${formatMoney(state.warnBelow, state.currency)}，可以考虑充值`
      return `DeepSeek 余额 ${amount}`
    }

    function openUrl(url) {
      if (!url) return
      window.open(url, '_blank', 'noopener,noreferrer')
    }

    function BalancePill() {
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [offline, setOffline] = React.useState(false)
      const rootRef = React.useRef(null)
      const retryRef = React.useRef(null)

      React.useEffect(() => {
        const source = new EventSource(STREAM_PATH)
        const onSnapshot = (event) => {
          try {
            setState(JSON.parse(event.data))
            setOffline(false)
          } catch {
            // ignore a malformed frame
          }
        }
        source.addEventListener('snapshot', onSnapshot)
        source.onopen = () => setOffline(false)
        source.onerror = () => setOffline(true)
        retryRef.current = source
        return () => {
          retryRef.current = null
          source.removeEventListener('snapshot', onSnapshot)
          source.close()
        }
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      const askRefresh = React.useCallback(() => {
        setBusy(true)
        fetch(STREAM_PATH, { method: 'POST' })
          .catch(() => {})
          .finally(() => {
            setTimeout(() => setBusy(false), 600)
          })
      }, [])

      const toggle = () => {
        const next = !open
        setOpen(next)
        if (next) askRefresh()
      }

      const tone = offline ? 'danger' : toneOf(state)
      const ready = state?.phase === 'ready'
      const amountText = ready ? formatMoney(state.total, state.currency) : '—'

      return h('div', { className: 'bp-root', ref: rootRef },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),

        h('button', {
          type: 'button',
          className: `bp-pill bp-${tone}`,
          title: tooltip(state),
          'aria-label': tooltip(state),
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          onClick: toggle,
        },
          h('span', { className: 'bp-dot' }),
          h('span', { className: 'bp-amount' }, amountText),
        ),

        open ? h('div', {
          className: 'bp-card',
          role: 'dialog',
          'aria-label': 'DeepSeek 余额详情',
        },
          h('div', { className: 'bp-head' },
            h('span', { className: 'bp-title' }, 'DeepSeek 余额'),
            h('span', { className: 'bp-time' }, timeText(state)),
          ),

          ready
            ? h('div', { className: 'bp-total' }, formatMoney(state.total, state.currency))
            : h('div', { className: 'bp-total bp-muted' }, '—'),

          state?.phase === 'signed-out'
            ? h('div', { className: 'bp-empty' }, '未登录 DeepSeek 账号')
            : state?.phase === 'error'
              ? h('div', { className: 'bp-empty' }, state.message ? `获取失败：${state.message}` : '暂时无法获取余额')
              : offline
                ? h('div', { className: 'bp-empty' }, '与后台连接断开，稍后自动重试')
                : h('div', { className: 'bp-total-note' }, ready && state.available === false ? '余额不足，当前无法调用' : '账户余额'),

          ready
            ? h('div', { className: 'bp-rows' },
                h('div', { className: 'bp-row' },
                  h('span', { className: 'bp-muted' }, '充值余额'),
                  h('span', null, formatMoney(state.recharge, state.currency)),
                ),
                h('div', { className: 'bp-row' },
                  h('span', { className: 'bp-muted' }, '赠金'),
                  h('span', null, formatMoney(state.bonus, state.currency)),
                ),
                state.others && state.others.length > 0
                  ? state.others.map((wallet) => h('div', { className: 'bp-row', key: wallet.currency },
                      h('span', { className: 'bp-muted' }, `其他钱包（${wallet.currency}）`),
                      h('span', null, formatMoney(wallet.total, wallet.currency)),
                    ))
                  : null,
                h('div', { className: 'bp-row' },
                  h('span', { className: 'bp-muted' }, '状态'),
                  h('span', null, state.available ? '可正常调用' : '余额不足'),
                ),
              )
            : null,

          h('div', { className: 'bp-actions' },
            h('button', {
              type: 'button',
              className: 'bp-btn',
              disabled: busy,
              onClick: askRefresh,
            }, busy ? '刷新中' : '刷新'),
            h('button', {
              type: 'button',
              className: 'bp-btn bp-btn-primary',
              onClick: () => openUrl(state?.links?.topUpUrl || TOP_UP_URL),
            }, '去充值'),
            h('button', {
              type: 'button',
              className: 'bp-btn',
              onClick: () => openUrl(state?.links?.usageUrl || USAGE_URL),
            }, '用量'),
          ),
        ) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-balance-pill',
          order: 90,
        }, BalancePill))
      },
    }
  },
})
