/**
 * dsh-agent-rules — 设置页「规则与记忆」面板（Client 半侧）。
 *
 * 注册 settings.section，读 Host 的 /dsh-agent-rules 接口，维护一份全局规则列表。
 * 规则落进 ~/.dsh/AGENTS.md 的托管块，由 DSH 内置指令加载器在会话首次请求注入。
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-rules',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const API = '/dsh-agent-rules'
    const SECTION_ID = 'agent-rules'

    const CSS = [
      '.ar-root{max-width:860px;padding:4px 0 28px;font-size:13px;color:var(--dsw-alias-label-primary,currentColor)}',
      '.ar-title{font-size:15px;font-weight:600;letter-spacing:.01em;margin:0 0 12px}',
      '.ar-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));margin:0 0 18px}',
      '.ar-tab{padding:6px 14px;border-radius:7px 7px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));border:1px solid transparent;border-bottom:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
      '.ar-tab.is-on{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-color:var(--dsw-alias-border-l1,rgba(128,128,128,.22));color:var(--dsw-alias-label-primary,currentColor);font-weight:500;position:relative;top:1px}',
      '.ar-label{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));margin:0 0 8px;opacity:.85}',
      '.ar-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06));overflow:hidden;margin:0 0 20px}',
      '.ar-head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16))}',
      '.ar-head .ar-h{font-size:13px;font-weight:600}',
      '.ar-head .ar-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));opacity:.85}',
      '.ar-grow{flex:1}',
      '.ar-srow{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}',
      '.ar-srow:first-child{border-top:none}',
      '.ar-ic{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:7px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.1));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));opacity:.72;margin-top:1px}',
      '.ar-sbody{flex:1;min-width:0}',
      '.ar-sname{font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}',
      '.ar-shint{font-size:11.5px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));opacity:.8;margin-top:2px;line-height:1.6}',
      '.ar-sstate{font-size:11px;flex:none;display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));white-space:nowrap;margin-top:2px}',
      '.ar-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.25}',
      '.ar-dot.is-on{opacity:.85}',
      '.ar-row{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}',
      '.ar-row:first-child{border-top:none}',
      '.ar-row.is-off .ar-text{opacity:.42}',
      '.ar-text{flex:1;min-width:0;font-size:12.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;cursor:text}',
      '.ar-btn{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:transparent;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));border-radius:6px;padding:3px 8px;font-size:11.5px;cursor:pointer;line-height:1.5}',
      '.ar-btn:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,currentColor)}',
      '.ar-btn.is-primary{background:var(--dsw-alias-label-primary,currentColor);color:var(--dsw-alias-bg-layer-1,#12131a);border-color:transparent;font-weight:500}',
      '.ar-btn:disabled{opacity:.4;cursor:default}',
      '.ar-acts{display:flex;gap:6px;flex:none;align-items:center;margin-top:1px}',
      '.ar-ico{border:none;background:transparent;padding:3px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));cursor:pointer;opacity:.6;display:flex;border-radius:5px}',
      '.ar-ico:hover{opacity:1;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.14))}',
      '.ar-empty{padding:22px 14px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));opacity:.7}',
      '.ar-edit{padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}',
      '.ar-ta{width:100%;box-sizing:border-box;min-height:62px;resize:vertical;font-family:inherit;font-size:12.5px;line-height:1.65;padding:9px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));color:inherit;outline:none}',
      '.ar-ta:focus{border-color:var(--dsw-alias-label-secondary,rgba(128,128,128,.6))}',
      '.ar-editfoot{display:flex;gap:8px;align-items:center;margin-top:8px}',
      '.ar-msg{font-size:11.5px;padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14));color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}',
      '.ar-msg.is-err{color:#d9534f}',
      '.ar-note{font-size:11.5px;line-height:1.75;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));opacity:.78;margin:-8px 0 18px}',
    ].join('\n')

    const IconDoc = () =>
      h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M9.6 1.9H4.5a1 1 0 0 0-1 1v10.2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.8z' }),
        h('path', { d: 'M9.6 1.9v3h3' }),
        h('path', { d: 'M5.8 8.2h4.4M5.8 10.4h4.4' }),
      )

    const IconGear = () =>
      h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 8, cy: 8, r: 2.1 }),
        h('path', {
          d: 'M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2',
        }),
      )

    const IconTrash = () =>
      h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M2.8 4.3h10.4M6.2 4.3V3a.9.9 0 0 1 .9-.9h1.8a.9.9 0 0 1 .9.9v1.3' }),
        h('path', { d: 'M4.2 4.3l.6 8.3a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.3' }),
      )

    const IconPlus = () =>
      h(
        'svg',
        { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M8 3.2v9.6M3.2 8h9.6' }),
      )

    function formatBytes(size) {
      const n = Number(size) || 0
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    function sourceRow(key, name, hint, stateText, on) {
      return h(
        'div',
        { className: 'ar-srow', key },
        h('span', { className: 'ar-ic' }, h(IconDoc)),
        h('div', { className: 'ar-sbody' },
          h('div', { className: 'ar-sname', title: hint.title || name }, name),
          h('div', { className: 'ar-shint' }, hint.text)),
        h('span', { className: 'ar-sstate' },
          h('span', { className: 'ar-dot' + (on ? ' is-on' : '') }),
          stateText),
      )
    }

    function RulesPanel() {
      const [snap, setSnap] = React.useState(null)
      const [draft, setDraft] = React.useState([])
      const [editingId, setEditingId] = React.useState('')
      const [editText, setEditText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')

      function accept(next) {
        if (!next || next.ok !== true) return
        setSnap(next)
        setDraft(Array.isArray(next.rules) ? next.rules : [])
      }

      function load() {
        setError('')
        fetch(API, { headers: { Accept: 'application/json' } })
          .then((res) => res.json())
          .then((json) => {
            if (!json || json.ok !== true) throw new Error((json && json.error) || '读取失败')
            accept(json)
          })
          .catch((err) => setError('读取规则失败：' + String(err && err.message ? err.message : err)))
      }

      React.useEffect(() => {
        load()
      }, [])

      function post(op, extra) {
        setBusy(true)
        setError('')
        return fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ op }, extra || {})),
        })
          .then((res) => res.json())
          .then((json) => {
            if (!json || json.ok !== true) throw new Error((json && json.error) || '保存失败')
            accept(json)
            return json
          })
          .catch((err) => {
            setError('保存失败：' + String(err && err.message ? err.message : err))
            throw err
          })
          .finally(() => setBusy(false))
      }

      function commit(next, done) {
        setDraft(next)
        return post('save', { rules: next })
          .then((json) => {
            const active = next.filter((rule) => rule.enabled !== false).length
            setNotice('已写入 AGENTS.md · ' + active + ' 条生效 · 新对话开始时注入')
            if (done) done()
          })
          .catch(() => {
            load()
          })
      }

      function startNew() {
        setNotice('')
        setError('')
        setEditingId('new')
        setEditText('')
      }

      function startEdit(rule) {
        setNotice('')
        setError('')
        setEditingId(rule.id)
        setEditText(rule.text)
      }

      function cancelEdit() {
        setEditingId('')
        setEditText('')
      }

      function submitEdit() {
        const text = editText.trim()
        if (!text) {
          setError('规则内容不能为空')
          return
        }
        if (editingId === 'new') {
          commit(draft.concat([{ id: '', text, enabled: true }]), cancelEdit)
          return
        }
        commit(draft.map((rule) => (rule.id === editingId ? Object.assign({}, rule, { text }) : rule)), cancelEdit)
      }

      function removeRule(id) {
        setNotice('')
        commit(draft.filter((rule) => rule.id !== id))
      }

      function toggleRule(rule) {
        setNotice('')
        commit(draft.map((item) => (item.id === rule.id ? Object.assign({}, item, { enabled: item.enabled === false }) : item)))
      }

      function importRules() {
        setNotice('')
        post('import')
          .then((json) => {
            const n = Number(json.imported) || 0
            setNotice(n ? '从 AGENTS.md 导入了 ' + n + ' 条手写内容' : 'AGENTS.md 里没有可导入的手写内容')
          })
          .catch(() => {})
      }

      const files = (snap && snap.files) || {}
      const limits = (snap && snap.limits) || { maxRules: 200, maxRuleChars: 2000 }
      const agents = files.agents || { exists: false, size: 0, manualBytes: 0 }
      const shared = files.shared || { exists: false, size: 0 }
      const claude = files.claude || { exists: false, size: 0 }
      const activeCount = draft.filter((rule) => rule.enabled !== false).length

      const children = [
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'ar-title', key: 'title' }, '规则与记忆'),
        h('div', { className: 'ar-tabs', key: 'tabs' },
          h('span', { className: 'ar-tab is-on' }, '本地')),
        h('div', { className: 'ar-label', key: 'lb1' }, '上下文来源'),
        h('div', { className: 'ar-card', key: 'src' },
          sourceRow(
            'agents',
            '~/.dsh/AGENTS.md',
            { text: '本面板写在这里 · DSH 内置指令加载器读取', title: (snap && snap.paths && snap.paths.agents) || '' },
            agents.exists ? formatBytes(agents.size) + (agents.manualBytes ? ' · 手写 ' + formatBytes(agents.manualBytes) : '') : '未创建',
            agents.exists,
          ),
          sourceRow(
            'shared',
            '~/.agents/AGENTS.md',
            { text: '共享 agents 根 · 与上面同内容时自动去重', title: (snap && snap.paths && snap.paths.shared) || '' },
            shared.exists ? formatBytes(shared.size) : '未创建',
            shared.exists,
          ),
          sourceRow(
            'claude',
            'CLAUDE.md（项目目录）',
            { text: '全局只加载 AGENTS.md；CLAUDE.md 仅在会话工作目录逐级查找', title: (snap && snap.paths && snap.paths.claude) || '' },
            claude.exists ? '用户全局已存在' : '按项目目录生效',
            false,
          ),
        ),
        h('div', { className: 'ar-label', key: 'lb2' }, '规则'),
        h('div', { className: 'ar-card', key: 'rules' },
          h('div', { className: 'ar-head' },
            h('div', { className: 'ar-grow' },
              h('div', { className: 'ar-h' }, '全局规则 ' + draft.length + ' 条' + (activeCount !== draft.length ? '（启用 ' + activeCount + '）' : '')),
              h('div', { className: 'ar-hint' }, '上限 ' + limits.maxRules + ' 条 · 单条 ' + limits.maxRuleChars + ' 字符')),
            h('button', { className: 'ar-btn', onClick: startNew, disabled: busy, type: 'button' },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(IconPlus), '添加规则'))),
          editingId === 'new'
            ? h('div', { className: 'ar-edit' },
                h('textarea', {
                  className: 'ar-ta',
                  value: editText,
                  placeholder: '写一条要长期生效的规则，例如：所有回答先给结论，再给依据。',
                  onChange: (event) => setEditText(event.target.value),
                  autoFocus: true,
                }),
                h('div', { className: 'ar-editfoot' },
                  h('button', { className: 'ar-btn is-primary', onClick: submitEdit, disabled: busy, type: 'button' }, busy ? '保存中…' : '保存'),
                  h('button', { className: 'ar-btn', onClick: cancelEdit, disabled: busy, type: 'button' }, '取消')))
            : null,
          draft.length === 0 && editingId !== 'new'
            ? h('div', { className: 'ar-empty' }, '还没有规则。加一条，它会出现在每个新对话的上下文里。')
            : draft.map((rule) =>
                editingId === rule.id
                  ? h('div', { className: 'ar-edit', key: rule.id },
                      h('textarea', {
                        className: 'ar-ta',
                        value: editText,
                        onChange: (event) => setEditText(event.target.value),
                        autoFocus: true,
                      }),
                      h('div', { className: 'ar-editfoot' },
                        h('button', { className: 'ar-btn is-primary', onClick: submitEdit, disabled: busy, type: 'button' }, busy ? '保存中…' : '保存'),
                        h('button', { className: 'ar-btn', onClick: cancelEdit, disabled: busy, type: 'button' }, '取消'),
                        h('span', { style: { flex: 1 } }),
                        h('button', { className: 'ar-btn', onClick: () => removeRule(rule.id), disabled: busy, type: 'button' }, '删除')))
                  : h('div', { className: 'ar-row' + (rule.enabled === false ? ' is-off' : ''), key: rule.id },
                      h('span', { className: 'ar-ic' }, h(IconDoc)),
                      h('div', { className: 'ar-text', onClick: () => startEdit(rule), title: '点击编辑' }, rule.text),
                      h('span', { className: 'ar-acts' },
                        h('button', {
                          className: 'ar-ico',
                          onClick: () => toggleRule(rule),
                          disabled: busy,
                          type: 'button',
                          title: rule.enabled === false ? '当前已停用，点击启用' : '点击停用（保留文本，不写入 AGENTS.md）',
                        },
                          h('span', { className: 'ar-dot' + (rule.enabled === false ? '' : ' is-on') })),
                        h('button', { className: 'ar-ico', onClick: () => startEdit(rule), disabled: busy, type: 'button', title: '编辑' }, h(IconGear)),
                        h('button', { className: 'ar-ico', onClick: () => removeRule(rule.id), disabled: busy, type: 'button', title: '删除' }, h(IconTrash)))),
              ),
          error ? h('div', { className: 'ar-msg is-err' }, error) : null,
          !error && notice ? h('div', { className: 'ar-msg' }, notice) : null,
        ),
        h('div', { className: 'ar-note', key: 'note' },
          '保存即写入 ~/.dsh/AGENTS.md 的托管块，块外你自己写的内容不会被覆盖。',
          h('br'),
          '规则在会话第一次请求时随工作区指令注入，所以保存后开一个新的对话就能看到效果；当前对话不会追溯生效。',
          agents.manualBytes
            ? h('span', { key: 'imp' },
                h('br'),
                '检测到 AGENTS.md 里有手写内容，可以 ',
                h('button', { className: 'ar-btn', onClick: importRules, disabled: busy, type: 'button', style: { marginLeft: 2 } }, '导入成规则'),
                ' 统一管理。')
            : null),
      ]

      return h('div', { className: 'ar-root' }, children.filter(Boolean))
    }

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.slots ?? (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
      if (!slots) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: SECTION_ID, order: 24, label: '规则与记忆' },
          () => h(RulesPanel),
        ),
      )
    }

    exports.SECTION_ID = SECTION_ID
    exports.RulesPanel = RulesPanel
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
