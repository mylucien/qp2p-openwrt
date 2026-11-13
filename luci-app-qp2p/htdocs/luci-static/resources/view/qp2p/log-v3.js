'use strict';
'require view';
'require poll';
'require dom';
'require ui';
'require qp2p.ctl-v2 as ctl';

/*
 * 日志页（设计稿 v2）：工具条 + 自动滚动 + 按级别着色的日志行
 *
 * v3 修「自动滚动到底部」无效：
 *   - render() 里 DOM 还没挂到文档上，那时设 scrollTop 拿不到 scrollHeight，
 *     所以首次渲染后必须延迟到挂载完成再滚；
 *   - 旧版把滚动绑在「日志文本变化」的分支里，日志不增长就永远不滚，
 *     勾选框切了也没反应。改成每次轮询都按勾选状态滚一次；
 *   - 全量重建 DOM 会清掉滚动位置，未勾选时先存后还原，否则没法停着看旧日志。
 */

var INSET = 'var(--section-inset,1.25rem)';

function logLines(text) {
	return String(text || '').split('\n').filter(function (l) { return l; })
		.map(function (line) {
			var color = '';

			if (/失败|超时|连不上|错误|error/i.test(line))
				color = '#fb6340';
			else if (/已就绪|成功|已上线|直连已建立|✓/i.test(line))
				color = '#1d9766';

			return E('div', {
				'style': 'padding:2px 0;white-space:pre-wrap;word-break:break-all;' +
					'font-family:monospace;font-size:12.5px;line-height:1.5;color:' +
					(color || 'inherit')
			}, line);
		});
}

return view.extend({
	load: function () {
		return ctl.log(300);
	},

	/* 勾选时滚到底。连设三次：立刻、下一帧、再下一帧，
	   防止字体加载 / 长行换行造成二次重排后又露出半截。 */
	scrollToBottom: function () {
		var box = this.box;

		if (!box || !this.autoscroll || !this.autoscroll.checked)
			return;

		var set = function () { box.scrollTop = box.scrollHeight; };

		set();
		if (window.requestAnimationFrame) {
			window.requestAnimationFrame(function () {
				window.requestAnimationFrame(set);
			});
		} else {
			window.setTimeout(set, 50);
		}
	},

	render: function (text) {
		var self = this;

		this.text = text || '';
		this.autoscroll = E('input', { 'type': 'checkbox' });
		this.autoscroll.checked = true;
		this.autoscroll.addEventListener('change', function () {
			if (self.autoscroll.checked)
				self.scrollToBottom();
		});

		this.box = E('div', {
			'style': 'background:rgba(0,0,0,.035);border:1px solid rgba(0,0,0,.06);' +
				'border-radius:6px;padding:.8em 1em;max-height:34em;overflow:auto'
		}, this.text
			? logLines(this.text)
			: E('div', { 'style': 'font-size:12px;opacity:.6' }, '（暂无日志）'));

		var view = E('div', { 'class': 'cbi-section' }, [
			E('h3', {
				'style': 'margin:0;padding:1em ' + INSET + ' .7em;font-size:15px;font-weight:600'
			}, [
				'服务日志',
				E('span', { 'style': 'float:right;font-size:12px;font-weight:400' }, [
					E('button', {
						'class': 'btn cbi-button',
						'click': ui.createHandlerFn(this, 'handleRefresh')
					}, '刷新'),
					' ',
					E('button', {
						'class': 'btn cbi-button',
						'click': ui.createHandlerFn(this, 'handleDoctor')
					}, '本地诊断')
				])
			]),
			E('div', {
				'style': 'display:flex;align-items:center;gap:1em;flex-wrap:wrap;' +
					'padding:0 ' + INSET + ' .8em;font-size:13px'
			}, [
				E('label', { 'style': 'display:flex;align-items:center;gap:.4em' },
					[ this.autoscroll, '自动滚动到底部' ]),
				E('div', { 'style': 'flex:1' }),
				E('span', { 'style': 'font-size:12px;opacity:.6' },
					'来源：logread，按 qp2p 过滤（最多 300 行）')
			]),
			E('div', { 'style': 'padding:0 ' + INSET }, this.box)
		]);

		/* render() 返回的 DOM 要等框架 append 之后才有 scrollHeight */
		window.setTimeout(function () { self.scrollToBottom(); }, 0);

		this.pollFn = function () { return self.refreshLog(); };
		poll.add(this.pollFn, 5);

		return view;
	},

	refreshLog: function () {
		var self = this;

		return ctl.log(300).then(function (text) {
			if (!self.box)
				return;

			text = text || '';

			if (text !== self.text) {
				/* dom.content() 会清空重建，scrollTop 归零；
				   没勾自动滚动时把阅读位置还回去，别每 5 秒弹回顶部 */
				var keep = self.autoscroll.checked ? null : self.box.scrollTop;

				self.text = text;
				dom.content(self.box, text
					? logLines(text)
					: E('div', { 'style': 'font-size:12px;opacity:.6' }, '（暂无日志）'));

				if (keep !== null)
					self.box.scrollTop = keep;
			}

			/* 日志有没有变化都要按勾选状态滚，勾选框才不会「点了没反应」 */
			self.scrollToBottom();
		});
	},

	handleRefresh: function () {
		return this.refreshLog();
	},

	handleDoctor: function () {
		return ctl.exec('doctor').then(function (res) {
			return ctl.showResult('本地诊断', res);
		});
	},

	destroy: function () {
		if (this.pollFn) {
			poll.remove(this.pollFn);
			this.pollFn = null;
		}
	}
});
