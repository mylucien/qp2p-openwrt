'use strict';
'require view';
'require poll';
'require ui';
'require qp2p.ctl as ctl';

return view.extend({
	load: function () {
		return ctl.log(300);
	},

	render: function (text) {
		var self = this;

		this.pre = E('pre', {
			'style': 'max-height:34em;overflow:auto;white-space:pre-wrap;word-break:break-all;' +
				'font-family:monospace;font-size:90%;line-height:1.5;margin:0;' +
				'background:rgba(0,0,0,.04);padding:.8em;border-radius:4px'
		}, text || '（暂无日志）');

		this.autoscroll = E('input', { 'type': 'checkbox', 'checked': 'checked' });

		var view = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '服务日志'),
			E('div', {
				'style': 'display:flex;align-items:center;gap:1em;flex-wrap:wrap;margin-bottom:.8em'
			}, [
				E('label', { 'style': 'display:flex;align-items:center;gap:.4em' },
					[ this.autoscroll, '自动滚动' ]),
				E('div', { 'style': 'flex:1' }),
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, 'handleRefresh')
				}, '刷新'),
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, 'handleDoctor')
				}, '本地诊断')
			]),
			this.pre,
			E('p', { 'class': 'cbi-value-description', 'style': 'margin-top:1em' },
				'内容来自系统日志（logread，按 qp2p 过滤，最多 300 行）。' +
				'打洞、认证、虚拟网卡和成员变化都会打在这里。')
		]);

		this.pollFn = function () { return self.refreshLog(true); };
		poll.add(this.pollFn, 5);

		return view;
	},

	refreshLog: function (silent) {
		var self = this;

		return ctl.log(300).then(function (text) {
			if (!self.pre)
				return;

			if (self.pre.textContent === text)
				return;

			self.pre.textContent = text || '（暂无日志）';

			if (self.autoscroll.checked)
				self.pre.scrollTop = self.pre.scrollHeight;
		});
	},

	handleRefresh: function () {
		return this.refreshLog(false);
	},

	handleDoctor: function () {
		return ctl.exec('doctor').then(function (res) {
			ctl.show('本地诊断', res);
		});
	},

	destroy: function () {
		if (this.pollFn) {
			poll.remove(this.pollFn);
			this.pollFn = null;
		}
	}
});
