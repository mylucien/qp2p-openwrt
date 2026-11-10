'use strict';
'require view';
'require poll';
'require dom';
'require ui';
'require qp2p.ctl as ctl';

return view.extend({
	load: function () {
		return ctl.refresh().then(function (res) {
			return res;
		});
	},

	render: function (res) {
		var self = this;
		var state = (res && res.state) || {};

		this.rawText = (res && res.raw) || (res && res.error) || '';

		this.tbody = E('tbody', {});

		this.summary = E('span', { 'style': 'opacity:.7' }, '');

		var table = E('table', {
			'class': 'table',
			'style': 'margin:0 var(--section-inset, 1.25rem);' +
				'width:calc(100% - 2 * var(--section-inset, 1.25rem))'
		}, [
			E('thead', {}, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, '名称'),
					E('th', { 'class': 'th' }, '虚拟地址'),
					E('th', { 'class': 'th' }, '状态'),
					E('th', { 'class': 'th' }, '延迟'),
					E('th', { 'class': 'th' }, '候选地址'),
					E('th', { 'class': 'th', 'style': 'width:8em' }, '操作')
				])
			]),
			this.tbody
		]);

		this.fill(state.peers || []);

		var view = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '在线成员'),
			E('div', {
				'style': 'display:flex;align-items:center;gap:1em;flex-wrap:wrap;' +
					'margin:0 var(--section-inset, 1.25rem) .8em'
			}, [
				this.summary,
				E('div', { 'style': 'flex:1' }),
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, 'handleRefresh')
				}, '刷新')
			]),
			table,
			E('p', {
				'class': 'cbi-value-description',
				'style': 'margin:1em var(--section-inset, 1.25rem) var(--section-inset, 1.25rem)'
			},
				'「延迟」来自日志里的直连记录 —— 命令行没有输出结构化状态，' +
				'所以只有真的直连成功过、并且日志还没被刷掉的节点才会显示数字。')
		]);

		this.pollFn = function () { return self.reload(true); };
		poll.add(this.pollFn, 30);

		return view;
	},

	fill: function (peers) {
		var rows = [];
		var linked = 0;

		peers.forEach(function (p) {
			var direct = (p.rtt != null);

			if (direct)
				linked++;

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, p.name),
				E('td', { 'class': 'td', 'style': 'font-family:monospace' }, p.ip || '—'),
				E('td', { 'class': 'td' }, p.state || '—'),
				E('td', { 'class': 'td' }, direct ? (p.rtt + ' ms') : '—'),
				E('td', { 'class': 'td' }, String(p.cands == null ? '—' : p.cands)),
				E('td', { 'class': 'td' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': function () {
							ui.addNotification(null, E('p', {},
								'在 SSH 里执行：ping ' + p.ip), 'info');
						}
					}, 'ping')
				])
			]));
		});

		if (!rows.length) {
			rows.push(E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td', 'colspan': 6 },
					'没有其它成员。把「概览」里的令牌发给别的设备，它们 join 之后就会出现在这里。')
			]));
		}

		dom.content(this.tbody, rows);

		if (this.summary)
			this.summary.textContent = '共 ' + peers.length + ' 台 · 已直连 ' + linked +
				(peers.length > linked ? (' · ' + (peers.length - linked) + ' 台还在重试') : '');
	},

	reload: function (silent) {
		var self = this;

		return ctl.refresh().then(function (res) {
			var state = (res && res.state) || {};

			self.rawText = (res && res.raw) || (res && res.error) || '';
			self.fill(state.peers || []);

			if (!silent && res && res.ok == 0)
				ctl.show('刷新失败', { code: 1, stdout: '', stderr: res.error || '未知错误' });
		});
	},

	handleRefresh: function () {
		return this.reload(false);
	},

	destroy: function () {
		if (this.pollFn) {
			poll.remove(this.pollFn);
			this.pollFn = null;
		}
	}
});
