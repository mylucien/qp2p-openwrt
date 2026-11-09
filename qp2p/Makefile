# SPDX-License-Identifier: MIT
#
# qp2p —— 直接使用上游 GitHub Releases 里的静态二进制，不在 OpenWrt 里编 Rust。
#
# 版本策略：解析 Makefile 时向 GitHub API 取当前最新 release，结果缓存 30 分钟。
#   - 好处：上游发了新版，重新编译就自动跟上，不用改这里的版本号
#   - 代价：同一次源码编两次可能得到不同版本；离线（或 API 挂了）无法编译
#   - 只缓存到 $(TOPDIR)/tmp/ 下，清 tmp 或等 30 分钟就会重新取
#
# 架构：上游只产出两个 linux 静态目标（x86_64 / aarch64），本包按 $(ARCH) 选择。

include $(TOPDIR)/rules.mk

PKG_NAME:=qp2p
PKG_LICENSE:=MIT
PKG_MAINTAINER:=lucien

QP2P_REPO:=mylucien/qp2p
QP2P_API:=https://api.github.com/repos/$(QP2P_REPO)/releases?per_page=20
QP2P_TAG_CACHE:=$(TOPDIR)/tmp/.qp2p-latest-tag

# 取最新的 tag（去掉前导 v），缓存 30 分钟，避免 make 每次解析都打网络。
#
# 两处坑：
#   1. 不能用 /releases/latest —— 它跳过预发布，而 CI 每次 push 发的都是预发布
#   2. /releases 的返回顺序看着像按 tag 排，不是按时间；真正最新的一条未必在最前面
# 所以取一页（20 条），按 published_at 自己排一遍再取最后一条。
QP2P_TAG_FULL:=$(strip $(shell \
	if [ -s "$(QP2P_TAG_CACHE)" ] && [ -z "$$(find "$(QP2P_TAG_CACHE)" -mmin +30 2>/dev/null)" ]; then \
		cat "$(QP2P_TAG_CACHE)"; \
	else \
		mkdir -p "$(TOPDIR)/tmp" 2>/dev/null; \
		curl -fsSL --max-time 25 "$(QP2P_API)" 2>/dev/null \
			| awk ' \
				/"tag_name":/     { t = $$0; sub(/^.*"tag_name": *"/, "", t); sub(/".*$$/, "", t) } \
				/"published_at":/ { p = $$0; sub(/^.*"published_at": *"/, "", p); sub(/".*$$/, "", p); \
				                    if (p ~ /^[0-9]/) print p "\t" t }' \
			| sort | tail -n1 | cut -f2 \
			| sed 's/^v//' \
			| tee "$(QP2P_TAG_CACHE)" 2>/dev/null; \
	fi))

# tag 形如 0.1.2+57：+ 后面是 CI 的构建号，不算版本号的一部分（资产名里也没有它），
# 但要塞进 PKG_RELEASE，否则两次构建的 ipk 版本完全一样，opkg 不会升级。
PKG_VERSION:=$(if $(QP2P_TAG_FULL),$(word 1,$(subst +, ,$(QP2P_TAG_FULL))),0.0.0)
PKG_RELEASE:=$(if $(word 2,$(subst +, ,$(QP2P_TAG_FULL))),$(word 2,$(subst +, ,$(QP2P_TAG_FULL))),1)

ifneq ($(filter aarch64%,$(ARCH)),)
  QP2P_ARCH:=aarch64
else ifeq ($(ARCH),x86_64)
  QP2P_ARCH:=x86_64
endif

PKG_SOURCE:=$(if $(QP2P_ARCH),qp2p-$(PKG_VERSION)-linux-$(QP2P_ARCH)-static,qp2p-$(PKG_VERSION)-unsupported)
PKG_SOURCE_URL:=https://github.com/$(QP2P_REPO)/releases/download/v$(QP2P_TAG_FULL)/
# 版本每次构建都可能变，哈希没法钉死；校验放在 Build/Prepare 里对着 SHA256SUMS.txt 做。
PKG_HASH:=skip
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

# menuconfig 走 ncurses，构建机 LANG 不是 UTF-8 时中文会显示成乱码，
# 所以 TITLE / description 只放 ASCII；面向用户的中文都在 LuCI 页面里。
define Package/qp2p
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=VPN
  TITLE:=qp2p mesh VPN client (prebuilt static binary)
  URL:=https://github.com/$(QP2P_REPO)
  DEPENDS:=+kmod-tun +ip-full
endef

define Package/qp2p/description
 qp2p lets machines without a public IP open a direct, end-to-end encrypted
 link through a lightweight rendezvous worker; payload traffic never passes
 through the server. Requires root for the TUN device.
endef

# 完整性校验放在 files/verify-sums 里，不写在这个 define 里。
# 原因：include/package.mk 的 Build/CoreTargets 会被 $(eval $(call ...)) 再解析
# 一遍，这里的 $$ 到 shell 时只剩一层，又被 make 当变量吃掉一层 —— 实测
# `echo "$$want"` 到 shell 变成 `echo "ant"`。脚本文件不经过 make 展开。
define Build/Prepare
	@[ -n "$(QP2P_TAG_FULL)" ] || { \
		echo "ERROR: 取不到 $(QP2P_REPO) 的最新 release（GitHub API 不通或限流）。"; \
		echo "       手动指定版本再编译：make package/qp2p/compile QP2P_TAG_FULL=0.1.2"; \
		exit 1; }
	@[ -n "$(QP2P_ARCH)" ] || { \
		echo "ERROR: 架构 $(ARCH) 没有对应的静态二进制（上游只发 x86_64 / aarch64）。"; \
		exit 1; }
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) $(DL_DIR)/$(PKG_SOURCE) $(PKG_BUILD_DIR)/qp2p
	chmod 0755 $(PKG_BUILD_DIR)/qp2p
	@echo "qp2p: release v$(QP2P_TAG_FULL) → $(PKG_SOURCE)"
	@rm -f $(PKG_BUILD_DIR)/SHA256SUMS.txt
	@if curl -fsSL --compressed --retry 3 --retry-delay 2 --max-time 30 -o \
			$(PKG_BUILD_DIR)/SHA256SUMS.txt "$(PKG_SOURCE_URL)SHA256SUMS.txt"; then \
		sh $(CURDIR)/files/verify-sums $(PKG_BUILD_DIR)/SHA256SUMS.txt \
			$(PKG_BUILD_DIR)/qp2p "$(PKG_SOURCE)" || exit 1; \
	else \
		echo "WARNING: 取不到 SHA256SUMS.txt（网络错误或 404），本次跳过校验"; \
	fi
endef

# 这个包没有源码，只有已经下好的二进制。不清空编译步骤的话，默认实现会去
# $(PKG_BUILD_DIR) 里找 Makefile，然后报 "No targets specified and no makefile found"。
define Build/Compile
endef

define Package/qp2p/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/qp2p $(1)/usr/bin/qp2p

	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/usr/libexec $(1)/etc/uci-defaults
	$(INSTALL_CONF) ./files/qp2p.config $(1)/etc/config/qp2p
	$(INSTALL_BIN) ./files/qp2p.init $(1)/etc/init.d/qp2p
	$(INSTALL_BIN) ./files/qp2p-ctl $(1)/usr/libexec/qp2p-ctl
	$(INSTALL_BIN) ./files/50_qp2p $(1)/etc/uci-defaults/50_qp2p

	# 预留给 /etc/qp2p（身份、证书、令牌），权限在 uci-defaults 里收紧到 0700
	$(INSTALL_DIR) $(1)/etc/qp2p
endef

define Package/qp2p/conffiles
/etc/config/qp2p
endef

$(eval $(call BuildPackage,qp2p))
